"""Documentos de proveedores: guardar lo recibido, acusar recibo, aceptar o reclamar.

El paso a paso, como `pipeline` para lo emitido:

1. `guardar_envio`: un `EnvioDTE` (de la casilla o subido a mano) se lee, se
   guarda en S3 tal cual y sus documentos quedan en `documentos_recibidos`. Es
   idempotente por el hash del archivo.
2. `acusar`: el `RespuestaDTE` firmado vuelve al correo del proveedor. Con
   reintentos, como el intercambio de lo emitido.
3. `actualizar_registro`: pregunta al SII cuándo recibió el documento (desde ahí
   corren los 8 días) y qué eventos tiene, hasta que vence el plazo.
4. `registrar_accion`: la persona acepta o reclama, y va al SII en línea.

Y del lado emisor, `eventos_emitido` sigue si el cliente aceptó o reclamó una
factura nuestra.
"""

from __future__ import annotations

import smtplib
import traceback
import uuid
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from lxml import etree
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core.almacen import Almacen
from app.core.buzon import CorreoRecibido
from app.core.certificados import CertificadoCargado, cargar_certificado
from app.db import control_session, tenant_session
from app.dte import recepcion
from app.dte.builder import NS
from app.dte.rut import normalizar_rut
from app.dte.pipeline import ESPERA_REINTENTO, MAX_INTENTOS, PERMANENTES, Contexto, _ahora, _espera
from app.dte.signer import ZONA_CHILE
from app.dte.sii_client import REGISTRO_OK, ClienteRegistro, SiiError
from app.models import (
    AccionRegistro,
    Ambiente,
    AuditLog,
    DeadLetter,
    Document,
    DocumentoRecibido,
    EnvioRecibido,
    EstadoAcuse,
    TIPOS_CON_REGISTRO,
    Tenant,
)

A = EstadoAcuse

#: Días corridos para aceptar o reclamar, desde que el SII recibió el documento.
PLAZO_REGISTRO = timedelta(days=8)
#: Entre consultas al registro mientras corre el plazo.
ESPERA_REGISTRO = timedelta(hours=6)
#: Una factura propia se sigue hasta esto después de emitida (8 días y margen).
SEGUIMIENTO_EMITIDO = timedelta(days=10)
RECLAMOS = frozenset({AccionRegistro.RCD, AccionRegistro.RFP, AccionRegistro.RFT})


class RegistroRechazadoError(Exception):
    """El SII no registró la acción (plazo vencido, reclamo previo, ...)."""

    def __init__(self, codigo: int, descripcion: str) -> None:
        super().__init__(descripcion)
        self.codigo = codigo


def clave_recibido(tenant_id: uuid.UUID, sha256: str) -> str:
    return f"{tenant_id}/recibidos/envios/{sha256}.xml"


def clave_dte_recibido(tenant_id: uuid.UUID, d: recepcion.DteLeido, sha256: str) -> str:
    return f"{tenant_id}/recibidos/dte/{d.rut_emisor}/{d.tipo_dte}/{d.folio}/{sha256}.xml"


def plazo(doc: DocumentoRecibido) -> datetime:
    """Hasta cuándo se puede aceptar o reclamar.

    Sin la fecha del SII se cuenta desde que llegó el correo, que es después de
    que el SII lo recibió: ese plazo queda más largo que el real. Por eso la
    fecha del SII se consulta apenas llega el documento, y la pantalla dice
    "aproximado" mientras no esté.
    """
    return (doc.fecha_recepcion_sii or doc.created_at) + PLAZO_REGISTRO


def estado_registro(eventos: list[dict] | None, accion: str | None) -> str | None:
    """RECLAMADO, ACEPTADO o None, según los eventos del SII y lo que se registró acá."""
    codigos = {e.get("codigo") for e in eventos or []} | ({accion} if accion else set())
    if codigos & RECLAMOS:
        return "RECLAMADO"
    if codigos & {AccionRegistro.ACD, AccionRegistro.ERM}:
        return "ACEPTADO"
    return None


# ------------------------------------------------------------------ guardar --


async def guardar_envio(
    almacen: Almacen,
    tenant: Tenant,
    xml: bytes,
    *,
    origen: str,
    nombre_archivo: str,
    correo_origen: str | None = None,
    asunto: str | None = None,
) -> tuple[EnvioRecibido, list[DocumentoRecibido], bool]:
    """Guarda un `EnvioDTE` recibido. Devuelve el envío, los documentos nuevos y
    si el archivo era nuevo (False: ya estaba, no se acusa de nuevo).

    Raises:
        recepcion.NoEsEnvioDteError: el XML no es un envío de documentos.
    """
    sha = recepcion.sha256(xml)
    async with tenant_session(tenant.id) as s:
        existente = (await s.execute(select(EnvioRecibido).where(EnvioRecibido.xml_sha256 == sha))).scalar_one_or_none()
    if existente is not None:
        return existente, [], False

    leido = recepcion.leer_envio(xml, tenant.rut_emisor)
    await almacen.guardar(clave_recibido(tenant.id, sha), xml)
    claves = {}
    for d in leido.documentos:
        if d.estado == recepcion.DTE_OK:
            claves[id(d)] = (clave_dte_recibido(tenant.id, d, recepcion.sha256(d.xml)), recepcion.sha256(d.xml))
            await almacen.guardar(claves[id(d)][0], d.xml)

    ahora = _ahora()
    con_registro = tenant.ambiente != Ambiente.DEV
    try:
        async with tenant_session(tenant.id) as s:
            ya = set((await s.execute(select(
                DocumentoRecibido.rut_emisor, DocumentoRecibido.tipo_dte, DocumentoRecibido.folio,
            ))).all()) if leido.documentos else set()
            for d in leido.documentos:
                if d.estado == recepcion.DTE_OK and (d.rut_emisor, d.tipo_dte, d.folio) in ya:
                    d.estado, d.glosa = recepcion.DTE_REPETIDO, "DTE ya recibido en otro envío"

            responde = bool(correo_origen) and origen == "CORREO" and tenant.ambiente != Ambiente.DEV
            envio = EnvioRecibido(
                tenant_id=tenant.id, origen=origen, correo_origen=(correo_origen or None) and correo_origen[:150],
                asunto=asunto, nombre_archivo=(nombre_archivo or "envio.xml")[:80],
                rut_emisor=leido.rut_emisor, razon_social_emisor=leido.razon_social_emisor,
                envio_dte_id=leido.envio_dte_id, digest=leido.digest,
                xml_key=clave_recibido(tenant.id, sha), xml_sha256=sha,
                estado=leido.estado, glosa=leido.glosa[:256],
                resultados=[d.resultado() for d in leido.documentos],
                acuse_estado=A.PENDIENTE if responde else A.NO_APLICA,
                acuse_next_at=ahora if responde else None,
            )
            s.add(envio)
            await s.flush()
            nuevos = []
            for d in leido.documentos:
                if d.estado != recepcion.DTE_OK:
                    continue
                clave, sha_dte = claves[id(d)]
                doc = DocumentoRecibido(
                    tenant_id=tenant.id, envio_id=envio.id, tipo_dte=d.tipo_dte, folio=d.folio,
                    rut_emisor=d.rut_emisor, razon_social_emisor=d.razon_social_emisor or d.rut_emisor,
                    fecha_emision=d.fecha_emision, monto_neto=d.monto_neto, monto_exento=d.monto_exento,
                    monto_iva=d.monto_iva, monto_total=d.monto_total, detalle=d.detalle,
                    firma_valida=leido.firma_valida, xml_key=clave, xml_sha256=sha_dte,
                    registro_next_at=ahora if con_registro and d.tipo_dte in TIPOS_CON_REGISTRO else None,
                )
                s.add(doc)
                nuevos.append(doc)
            s.add(AuditLog(tenant_id=tenant.id, operacion="RECEPCION", resultado=str(leido.estado),
                           actor=correo_origen or origen,
                           detalle={"archivo": nombre_archivo, "documentos": len(nuevos), "glosa": leido.glosa}))
    except IntegrityError:
        # Otro proceso guardó el mismo archivo al mismo tiempo.
        async with tenant_session(tenant.id) as s:
            envio = (await s.execute(select(EnvioRecibido).where(EnvioRecibido.xml_sha256 == sha))).scalar_one()
        return envio, [], False
    return envio, nuevos, True


# -------------------------------------------------------------------- acuse --


def mensaje_acuse(*, respuesta: bytes, envio: EnvioRecibido, razon_social: str, rut: str,
                  remitente: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((razon_social, remitente))
    msg["To"] = envio.correo_origen
    msg["Subject"] = f"Acuse de recibo del envío {envio.nombre_archivo} ({rut})"
    msg["Message-ID"] = make_msgid(domain=remitente.rsplit("@", 1)[-1])
    msg.set_content(
        f"{razon_social}, RUT {rut}, acusa recibo del envío {envio.nombre_archivo}: {envio.glosa}.\n\n"
        "Adjuntamos la respuesta en formato XML (RespuestaDTE). Este correo se envía de forma automática."
    )
    msg.add_attachment(respuesta, maintype="application", subtype="xml", filename=f"RespuestaDTE_{envio.codigo}.xml")
    return msg


async def acusar(ctx: Contexto, tenant_id: uuid.UUID, envio_id: uuid.UUID) -> str:
    """Acuse PENDIENTE → ENVIADO: el `RespuestaDTE` firmado al correo del proveedor."""
    if ctx.correo is None:
        return A.PENDIENTE
    async with tenant_session(tenant_id) as s:
        envio = (await s.execute(select(EnvioRecibido).where(EnvioRecibido.id == envio_id))).scalar_one()
        tenant = (await s.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        if envio.acuse_estado != A.PENDIENTE:
            return envio.acuse_estado

    try:
        async with tenant_session(tenant_id) as s:
            cert = await cargar_certificado(s, tenant_id, motivo=f"acuse de recibo {envio.codigo}")
        respuesta = recepcion.respuesta_recepcion(
            recepcion.DatosAcuse(
                codigo=envio.codigo, nombre_archivo=envio.nombre_archivo, recibido_at=envio.recibido_at,
                envio_dte_id=envio.envio_dte_id, digest=envio.digest, rut_emisor=envio.rut_emisor,
                rut_receptor=tenant.rut_emisor, estado=envio.estado, glosa=envio.glosa,
                resultados=envio.resultados,
            ),
            cert=cert, correo_contacto=ctx.correo.remitente, momento=datetime.now(ZONA_CHILE),
        )
        await ctx.almacen.guardar(f"{tenant_id}/recibidos/acuses/{envio.id}.xml", respuesta)
        await ctx.correo.enviar(mensaje_acuse(respuesta=respuesta, envio=envio, razon_social=tenant.razon_social,
                                              rut=tenant.rut_emisor, remitente=ctx.correo.remitente))
    except Exception as exc:  # noqa: BLE001 - todo fallo se registra y decide abajo
        intentos = envio.acuse_intentos + 1
        final = isinstance(exc, (smtplib.SMTPRecipientsRefused,) + PERMANENTES) or intentos >= MAX_INTENTOS
        async with tenant_session(tenant_id) as s:
            await s.execute(update(EnvioRecibido).where(EnvioRecibido.id == envio_id).values(
                acuse_estado=A.ERROR if final else A.PENDIENTE, acuse_intentos=intentos,
                acuse_error=f"{type(exc).__name__}: {exc}"[:2000],
                acuse_next_at=None if final else _ahora() + _espera(ESPERA_REINTENTO, intentos - 1),
            ))
            if final:
                s.add(DeadLetter(tenant_id=tenant_id, cola="acuse",
                                 error=f"No se pudo acusar recibo a {envio.correo_origen}: {exc}"[:4000],
                                 traceback=traceback.format_exc()[:8000], intentos=intentos))
        return A.ERROR if final else A.PENDIENTE

    async with tenant_session(tenant_id) as s:
        await s.execute(update(EnvioRecibido).where(EnvioRecibido.id == envio_id, EnvioRecibido.acuse_estado == A.PENDIENTE)
                        .values(acuse_estado=A.ENVIADO, acuse_at=_ahora(), acuse_error=None, acuse_next_at=None))
        s.add(AuditLog(tenant_id=tenant_id, operacion="ACUSE", resultado="OK", cert_fingerprint=cert.fingerprint_sha256,
                       actor="worker-estado", detalle={"correo": envio.correo_origen, "codigo": envio.codigo}))
    return A.ENVIADO


# ------------------------------------------------------------------ registro --


async def _registro(ctx: Contexto, tenant: Tenant) -> tuple[ClienteRegistro, CertificadoCargado]:
    async with tenant_session(tenant.id) as s:
        cert = await cargar_certificado(s, tenant.id, motivo="registro de aceptación o reclamo")
    return ClienteRegistro(ctx.sii(tenant.ambiente)), cert


async def registrar_accion(ctx: Contexto, tenant: Tenant, doc_id: uuid.UUID, accion: str,
                           actor: str | None) -> DocumentoRecibido:
    """Acepta o reclama en el SII, en línea: la persona ve el resultado al tiro.

    En Desarrollador no se habla con el SII: queda registrado solo acá.

    Raises:
        ValueError: el tipo de documento no pasa por el registro.
        RegistroRechazadoError: el SII no lo registró (y dice por qué).
        SiiError: el SII no respondió.
    """
    accion = AccionRegistro(accion)
    async with tenant_session(tenant.id) as s:
        doc = (await s.execute(select(DocumentoRecibido).where(DocumentoRecibido.id == doc_id))).scalar_one()
    if doc.tipo_dte not in TIPOS_CON_REGISTRO:
        raise ValueError("Este tipo de documento no se acepta ni reclama en el SII")

    eventos = doc.eventos
    if tenant.ambiente != Ambiente.DEV:
        cliente, cert = await _registro(ctx, tenant)
        r = await cliente.registrar(tenant.id, cert, doc.rut_emisor, doc.tipo_dte, doc.folio, accion)
        if r.codigo not in REGISTRO_OK:
            raise RegistroRechazadoError(r.codigo, r.descripcion or f"El SII respondió el código {r.codigo}")
        try:
            eventos = (await cliente.eventos(tenant.id, cert, doc.rut_emisor, doc.tipo_dte, doc.folio)).eventos
        except SiiError:
            pass  # la acción ya quedó; los eventos se refrescan en la próxima consulta

    ahora = _ahora()
    async with tenant_session(tenant.id) as s:
        await s.execute(update(DocumentoRecibido).where(DocumentoRecibido.id == doc_id).values(
            accion=accion, accion_at=ahora, accion_actor=actor, eventos=eventos, eventos_at=ahora,
            registro_error=None,
        ))
        s.add(AuditLog(tenant_id=tenant.id, operacion="REGISTRO", resultado=accion, actor=actor,
                       detalle={"rut_emisor": doc.rut_emisor, "tipo_dte": doc.tipo_dte, "folio": doc.folio}))
        return (await s.execute(select(DocumentoRecibido).where(DocumentoRecibido.id == doc_id))).scalar_one()


async def actualizar_registro(ctx: Contexto, tenant_id: uuid.UUID, doc_id: uuid.UUID) -> str:
    """Fecha de recepción en el SII y eventos de un documento recibido.

    Sigue consultando cada `ESPERA_REGISTRO` hasta un día después del plazo;
    ahí los eventos ya no cambian (salvo una NC del emisor, que no cambia nada acá).
    """
    async with tenant_session(tenant_id) as s:
        doc = (await s.execute(select(DocumentoRecibido).where(DocumentoRecibido.id == doc_id))).scalar_one()
        tenant = (await s.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
    ahora = _ahora()
    if tenant.ambiente == Ambiente.DEV:
        async with tenant_session(tenant_id) as s:
            await s.execute(update(DocumentoRecibido).where(DocumentoRecibido.id == doc_id).values(registro_next_at=None))
        return "DEV"
    valores: dict = {}
    try:
        cliente, cert = await _registro(ctx, tenant)
        fecha = doc.fecha_recepcion_sii or await cliente.fecha_recepcion(
            tenant_id, cert, doc.rut_emisor, doc.tipo_dte, doc.folio)
        r = await cliente.eventos(tenant_id, cert, doc.rut_emisor, doc.tipo_dte, doc.folio)
        valores = {"fecha_recepcion_sii": fecha, "eventos": r.eventos, "eventos_at": ahora, "registro_error": None}
        doc.fecha_recepcion_sii = fecha
        resultado = "OK"
    except SiiError as exc:
        valores = {"registro_error": f"{type(exc).__name__}: {exc}"[:2000]}
        resultado = "ERROR"
    except Exception as exc:  # noqa: BLE001 - sin certificado u otro: se anota y se sigue intentando
        valores = {"registro_error": f"{type(exc).__name__}: {exc}"[:2000]}
        resultado = "ERROR"
    fin = plazo(doc) + timedelta(days=1)
    valores["registro_next_at"] = ahora + ESPERA_REGISTRO if ahora < fin else None
    async with tenant_session(tenant_id) as s:
        await s.execute(update(DocumentoRecibido).where(DocumentoRecibido.id == doc_id).values(**valores))
    return resultado


async def eventos_emitido(ctx: Contexto, tenant_id: uuid.UUID, doc_id: uuid.UUID) -> str:
    """Si el cliente aceptó o reclamó una factura nuestra (33, 34 de producción)."""
    async with tenant_session(tenant_id) as s:
        doc = (await s.execute(select(Document).where(Document.id == doc_id))).scalar_one()
        tenant = (await s.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
    ahora = _ahora()
    valores: dict = {}
    resultado = "OK"
    try:
        async with tenant_session(tenant_id) as s:
            cert = await cargar_certificado(s, tenant_id, motivo=f"eventos {doc.tipo_dte}-{doc.folio}", document_id=doc_id)
        r = await ClienteRegistro(ctx.sii(doc.ambiente)).eventos(tenant_id, cert, tenant.rut_emisor, doc.tipo_dte, doc.folio)
        valores["eventos_receptor"] = r.eventos
    except Exception:  # noqa: BLE001 - se vuelve a intentar en la próxima vuelta
        resultado = "ERROR"
    hasta = datetime.combine(doc.fecha_emision, datetime.min.time(), ZONA_CHILE) + SEGUIMIENTO_EMITIDO
    reclamado = estado_registro(valores.get("eventos_receptor"), None) == "RECLAMADO"
    valores["eventos_next_at"] = None if reclamado or ahora >= hasta else ahora + ESPERA_REGISTRO
    async with tenant_session(tenant_id) as s:
        await s.execute(update(Document).where(Document.id == doc_id).values(**valores))
    return resultado


# ------------------------------------------------------------------- buzón --


async def tenant_por_rut(rut: str) -> Tenant | None:
    async with control_session() as s:
        return (await s.execute(select(Tenant).where(Tenant.rut_emisor == normalizar_rut(rut),
                                                      Tenant.activo.is_(True)))).scalar_one_or_none()


def rut_receptor_de(xml: bytes) -> str | None:
    """El `RutReceptor` de la carátula, sin validar nada más: sirve para saber
    a qué empresa le llegó el sobre antes de leerlo en su nombre."""
    try:
        raiz = etree.fromstring(xml, recepcion._PARSER)
    except etree.XMLSyntaxError:
        return None
    return raiz.findtext(f"{{{NS}}}SetDTE/{{{NS}}}Caratula/{{{NS}}}RutReceptor")


async def procesar_correo(almacen: Almacen, correo: CorreoRecibido) -> list[EnvioRecibido]:
    """Guarda cada `EnvioDTE` adjunto a un correo de la casilla, a nombre de la
    empresa a la que va dirigido. Lo que no es un envío de documentos (acuses de
    clientes, recibos, otros XML) se ignora. Devuelve los envíos nuevos."""
    nuevos = []
    for nombre, xml in correo.adjuntos:
        if recepcion.raiz_de(xml) != "EnvioDTE":
            continue
        rut = rut_receptor_de(xml)
        tenant = await tenant_por_rut(rut) if rut else None
        if tenant is None:
            # Sin empresa no hay certificado con qué firmar un acuse de rechazo.
            continue
        envio, _, nuevo = await guardar_envio(
            almacen, tenant, xml, origen="CORREO", nombre_archivo=nombre,
            correo_origen=correo.responder_a, asunto=correo.asunto,
        )
        if nuevo:
            nuevos.append(envio)
    return nuevos

