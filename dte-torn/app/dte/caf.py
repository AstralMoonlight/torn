"""Carga y lectura del CAF (Código de Autorización de Folios).

El CAF es el archivo que entrega el SII cuando autoriza un rango de folios.
Tiene dos partes que importan:

- El nodo `<CAF>` (`<DA>` + `<FRMA>`), que va **literal** dentro del `<TED>` de
  cada documento que use esos folios. Reserializarlo -aunque el XML resultante
  sea equivalente- cambia los bytes y el SII rechaza el timbre.
- `<RSASK>`, la llave privada con la que se firma el `<DD>` del timbre. Es un
  secreto: quien la tenga puede timbrar folios de esa empresa.

Por eso el archivo se guarda completo y cifrado, y el nodo `<CAF>` se recupera
cortando los bytes originales en vez de volver a serializar el árbol.
"""

from __future__ import annotations

import base64
import uuid
from dataclasses import dataclass
from datetime import date
from xml.sax.saxutils import escape

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from lxml import etree
from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import aad, abrir, sellar, version_actual
from app.dte.rut import normalizar_rut
from app.models import CAF, Ambiente, AuditLog, EstadoCAF, Tenant

OPERACION_CARGA = "CARGA_CAF"

#: Tipos de DTE que este servicio sabe emitir.
TIPOS_DTE_VALIDOS = frozenset({33, 34, 39, 41, 43, 46, 52, 56, 61, 110, 111, 112})



class CafInvalidoError(Exception):
    """El archivo no es un CAF utilizable."""


class CafDeOtroEmisorError(CafInvalidoError):
    """El CAF está autorizado a un RUT distinto del tenant.

    Cargarlo sería emitir documentos con folios de otra empresa, firmados en su
    nombre. Es el error más grave que puede cometer esta pantalla, así que va
    con excepción propia.
    """


class RangoSolapadoError(CafInvalidoError):
    """El rango se cruza con otro CAF ya cargado del mismo tipo.

    El SII no autoriza rangos solapados: si pasa, es el mismo archivo subido dos
    veces o el archivo equivocado. Aceptarlo permitiría emitir dos documentos
    con el mismo folio.
    """


@dataclass(slots=True)
class CafParseado:
    """Lo que se puede leer de un CAF sin tocar la base de datos."""

    rut_emisor: str
    razon_social: str | None
    tipo_dte: int
    folio_desde: int
    folio_hasta: int
    fecha_autorizacion: date | None
    #: El nodo `<CAF>` tal como viene en el archivo, byte a byte.
    nodo_caf: bytes
    #: La llave privada del timbre, en PEM.
    llave_ted_pem: bytes

    def __repr__(self) -> str:
        """Sin la llave privada: este objeto termina en trazas."""
        return (
            f"<CafParseado rut={self.rut_emisor} tipo={self.tipo_dte} "
            f"rango={self.folio_desde}-{self.folio_hasta}>"
        )


def _texto(raiz: etree._Element, ruta: str) -> str | None:
    nodo = raiz.find(ruta)
    return nodo.text.strip() if nodo is not None and nodo.text else None


def _entero(raiz: etree._Element, ruta: str, campo: str) -> int:
    valor = _texto(raiz, ruta)
    if valor is None:
        raise CafInvalidoError(f"El CAF no trae {campo} ({ruta})")
    try:
        return int(valor)
    except ValueError as exc:
        raise CafInvalidoError(f"{campo} no es un número: {valor!r}") from exc


def _recortar_nodo_caf(xml: bytes) -> bytes:
    """Extrae el nodo `<CAF>` cortando los bytes originales.

    No se usa `etree.tostring` a propósito: volver a serializar el subárbol
    cambia comillas, espacios y orden de atributos. El SII valida la firma
    `<FRMA>` sobre los bytes exactos de `<DA>`, y el `<CAF>` completo viaja
    dentro del `<TED>`, así que cualquier diferencia invalida el timbre.
    """
    inicio = xml.find(b"<CAF")
    fin = xml.rfind(b"</CAF>")
    if inicio == -1 or fin == -1:
        raise CafInvalidoError("El archivo no contiene un nodo <CAF>")
    return xml[inicio : fin + len(b"</CAF>")]


def _validar_par_de_llaves(llave_pem: bytes, raiz: etree._Element) -> None:
    """Comprueba que la llave privada corresponde a la pública del `<DA>`.

    Un CAF editado a mano, o mezclado con otro, produce timbres que el SII
    rechaza uno por uno. Mejor detectarlo al cargarlo que documento a documento.
    """
    try:
        llave = serialization.load_pem_private_key(llave_pem, password=None)
    except Exception as exc:  # noqa: BLE001
        raise CafInvalidoError("La llave privada del CAF (RSASK) no se puede leer") from exc

    if not isinstance(llave, rsa.RSAPrivateKey):
        raise CafInvalidoError("La llave del CAF no es RSA")

    modulo_b64 = _texto(raiz, ".//DA/RSAPK/M")
    if modulo_b64 is None:
        return  # algunos CAF no traen RSAPK; el resto de la validación basta

    modulo = int.from_bytes(base64.b64decode(modulo_b64), "big")
    if llave.public_key().public_numbers().n != modulo:
        raise CafInvalidoError(
            "La llave privada del CAF no corresponde a su llave pública; "
            "el archivo está alterado o mezclado con otro"
        )


def parsear_caf(xml: bytes) -> CafParseado:
    """Lee un CAF y valida su estructura, sin tocar la base de datos.

    Raises:
        CafInvalidoError: XML mal formado o con campos faltantes o incoherentes.
    """
    try:
        raiz = etree.fromstring(xml)
    except etree.XMLSyntaxError as exc:
        raise CafInvalidoError(f"El CAF no es XML válido: {exc}") from exc

    rut = _texto(raiz, ".//DA/RE")
    if not rut:
        raise CafInvalidoError("El CAF no trae el RUT del emisor (DA/RE)")

    tipo_dte = _entero(raiz, ".//DA/TD", "el tipo de documento")
    if tipo_dte not in TIPOS_DTE_VALIDOS:
        raise CafInvalidoError(f"Tipo de documento no soportado: {tipo_dte}")

    desde = _entero(raiz, ".//DA/RNG/D", "el folio inicial")
    hasta = _entero(raiz, ".//DA/RNG/H", "el folio final")
    if desde > hasta:
        raise CafInvalidoError(f"Rango inválido: {desde} > {hasta}")
    if desde < 1:
        raise CafInvalidoError(f"El folio inicial no puede ser {desde}")

    llave_pem = _texto(raiz, ".//RSASK")
    if not llave_pem:
        raise CafInvalidoError("El CAF no trae la llave privada del timbre (RSASK)")
    llave_bytes = llave_pem.encode("ascii")
    _validar_par_de_llaves(llave_bytes, raiz)

    autorizacion = _texto(raiz, ".//DA/FA")

    return CafParseado(
        rut_emisor=normalizar_rut(rut),
        razon_social=_texto(raiz, ".//DA/RS"),
        tipo_dte=tipo_dte,
        folio_desde=desde,
        folio_hasta=hasta,
        fecha_autorizacion=date.fromisoformat(autorizacion) if autorizacion else None,
        nodo_caf=_recortar_nodo_caf(xml),
        llave_ted_pem=llave_bytes,
    )


async def guardar_caf(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    xml: bytes,
    fecha_vencimiento: date | None = None,
    subido_por: str | None = None,
) -> CAF:
    """Valida un CAF contra el tenant y lo guarda cifrado, byte a byte.

    `fecha_vencimiento` llega por parámetro y no se deduce del archivo: el CAF
    no trae fecha de expiración. La vigencia de los folios es una regla del SII
    que depende del tipo de documento, y adivinarla acá sería inventar un dato
    tributario. Sin ella, el CAF no vence.

    El CAF queda en el ambiente actual del tenant: sus folios son de ese ambiente.

    Raises:
        CafDeOtroEmisorError: El RUT del CAF no es el del tenant.
        RangoSolapadoError: El rango se cruza con otro CAF ya cargado.
        CafInvalidoError: El archivo no es un CAF utilizable.
    """
    caf = parsear_caf(xml)

    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one()
    if caf.rut_emisor != normalizar_rut(tenant.rut_emisor):
        raise CafDeOtroEmisorError(
            f"El CAF está autorizado a {caf.rut_emisor} y este emisor es "
            f"{normalizar_rut(tenant.rut_emisor)}"
        )

    solapado = (
        await session.execute(
            select(CAF.id).where(
                CAF.tenant_id == tenant_id,
                CAF.ambiente == tenant.ambiente,
                CAF.tipo_dte == caf.tipo_dte,
                # Dos rangos se cruzan salvo que uno termine antes de que el
                # otro empiece.
                and_(CAF.folio_desde <= caf.folio_hasta, CAF.folio_hasta >= caf.folio_desde),
            )
        )
    ).scalar_one_or_none()
    if solapado is not None:
        raise RangoSolapadoError(
            f"El rango {caf.folio_desde}-{caf.folio_hasta} del tipo {caf.tipo_dte} "
            "se cruza con un CAF ya cargado. ¿Es el mismo archivo subido dos veces?"
        )

    caf_id = uuid.uuid4()
    nonce, cifrado = sellar(tenant_id, xml, aad(tenant_id, CAF.__tablename__, caf_id))

    fila = CAF(
        id=caf_id,
        tenant_id=tenant_id,
        tipo_dte=caf.tipo_dte,
        ambiente=tenant.ambiente,
        folio_desde=caf.folio_desde,
        folio_hasta=caf.folio_hasta,
        # El puntero sin estrenar es `desde - 1`: el primer folio que se emite
        # es `desde`, no 1.
        ultimo_folio_usado=caf.folio_desde - 1,
        xml_cifrado=cifrado,
        nonce=nonce,
        key_version=version_actual(),
        fecha_autorizacion=caf.fecha_autorizacion,
        fecha_vencimiento=fecha_vencimiento,
        estado=EstadoCAF.ACTIVO,
    )
    session.add(fila)
    await session.flush()

    session.add(
        AuditLog(
            tenant_id=tenant_id,
            operacion=OPERACION_CARGA,
            resultado="OK",
            actor=subido_por,
            detalle={
                "tipo_dte": caf.tipo_dte,
                "desde": caf.folio_desde,
                "hasta": caf.folio_hasta,
                "folios": caf.folio_hasta - caf.folio_desde + 1,
            },
        )
    )
    await session.flush()
    return fila


async def abrir_caf(session: AsyncSession, caf_id: uuid.UUID, tenant_id: uuid.UUID) -> CafParseado:
    """Descifra un CAF guardado y lo devuelve listo para timbrar.

    Es lo que consume `signer.py`: el nodo `<CAF>` literal para meter en el
    `<TED>` y la llave privada para firmar el `<DD>`.
    """
    fila = (
        await session.execute(
            select(CAF).where(CAF.id == caf_id, CAF.tenant_id == tenant_id)
        )
    ).scalar_one()

    xml = abrir(
        tenant_id,
        fila.nonce,
        fila.xml_cifrado,
        aad(tenant_id, CAF.__tablename__, fila.id),
        fila.key_version,
    )
    return parsear_caf(xml)


# ------------------------------------------------------ CAF de Desarrollador --

#: Folios de cada CAF de prueba. Al agotarse se genera el siguiente rango.
FOLIOS_CAF_PRUEBA = 100_000
ACTOR_CAF_PRUEBA = "desarrollador"


def caf_de_prueba(rut: str, razon_social: str, tipo_dte: int, desde: int, hasta: int) -> bytes:
    """Un CAF con la estructura del SII y una llave propia, para Desarrollador.

    Timbra igual que uno real, pero el SII nunca lo autorizó: `<FRMA>` es un
    relleno, así que un documento timbrado con él no pasaría por el SII.
    """
    from app.dte.signer import hoy_chile  # signer importa este módulo

    llave = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    numeros = llave.public_key().public_numbers()

    def b64(n: int) -> str:
        return base64.b64encode(n.to_bytes((n.bit_length() + 7) // 8, "big")).decode("ascii")

    sk = llave.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()
    ).decode("ascii")
    pk = llave.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode("ascii")
    frma = base64.b64encode(b"CAF de prueba de Torn: no lo autorizo el SII").decode("ascii")
    xml = f"""<?xml version="1.0" encoding="ISO-8859-1"?>
<AUTORIZACION>
<CAF version="1.0">
<DA>
<RE>{rut}</RE>
<RS>{escape(razon_social[:40])}</RS>
<TD>{tipo_dte}</TD>
<RNG><D>{desde}</D><H>{hasta}</H></RNG>
<FA>{hoy_chile().isoformat()}</FA>
<RSAPK><M>{b64(numeros.n)}</M><E>{b64(numeros.e)}</E></RSAPK>
<IDK>100</IDK>
</DA>
<FRMA algoritmo="SHA1withRSA">{frma}</FRMA>
</CAF>
<RSASK>{sk}</RSASK>
<RSAPUBK>{pk}</RSAPUBK>
</AUTORIZACION>
"""
    return xml.encode("ISO-8859-1", errors="xmlcharrefreplace")


async def asegurar_caf_prueba(session: AsyncSession, tenant: Tenant, tipo_dte: int) -> None:
    """Deja un CAF de prueba con folios para `tipo_dte`, si el tenant no tiene.

    Solo para Desarrollador. Debe correr en la transacción que después asigna
    el folio: el lock serializa a dos emisiones que no encuentren CAF a la vez,
    para que no generen dos rangos que se crucen.
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:clave))"),
        {"clave": f"caf-prueba:{tenant.id}:{tipo_dte}"},
    )
    del_tipo = and_(CAF.tenant_id == tenant.id, CAF.ambiente == Ambiente.DEV, CAF.tipo_dte == tipo_dte)
    hay = (
        await session.execute(select(CAF.id).where(del_tipo, CAF.estado == EstadoCAF.ACTIVO).limit(1))
    ).scalar_one_or_none()
    if hay is not None:
        return
    ultimo = (await session.execute(select(func.max(CAF.folio_hasta)).where(del_tipo))).scalar_one() or 0
    xml = caf_de_prueba(
        tenant.rut_emisor, tenant.razon_social, tipo_dte, ultimo + 1, ultimo + FOLIOS_CAF_PRUEBA
    )
    await guardar_caf(session, tenant.id, xml, subido_por=ACTOR_CAF_PRUEBA)
