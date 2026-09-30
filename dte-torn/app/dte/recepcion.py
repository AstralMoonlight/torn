"""Recepción de documentos de proveedores: leer el sobre y responder el acuse.

Funciones puras, igual que `builder` y `signer`: reciben bytes y devuelven
bytes o datos. Guardar, responder por correo y hablar con el registro del SII
vive en `recibidos.py`.

Lo que dice el SII (`formato_ic.pdf`, 2005): quien recibe un `EnvioDTE` debe
responder un `RespuestaDTE` con `RecepcionEnvio` por cada envío, diciendo si lo
recibió conforme (0) o por qué no (1 schema, 2 firma, 3 RUT receptor, 90
repetido, 91 ilegible, 99 otros), y el resultado de cada DTE. Aceptar o
reclamar con efecto legal no va por XML: es el Registro de Aceptación o
Reclamo (Ley 20.956), en `sii_client.ClienteRegistro`.
"""

from __future__ import annotations

import base64
import hashlib
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import xmlsec
from lxml import etree

from app.core.certificados import CertificadoCargado
from app.dte.builder import NS, XSI, serializar
from app.dte.pdf import leer_dte
from app.dte.rut import normalizar_rut
from app.dte.signer import FirmaInvalidaError, _firmar, _verificar, hora_sii

_XSD = Path(__file__).resolve().parent / "xsd"
_DS = xmlsec.constants.DSigNs

#: Un sobre con cientos de documentos pesa unos pocos MB. Esto corta un adjunto
#: absurdo antes de parsearlo.
MAX_SOBRE = 10_000_000

# Estados del envío (`EstadoRecepEnv`).
CONFORME, ERROR_SCHEMA, ERROR_FIRMA, RUT_NO_CORRESPONDE, REPETIDO, ILEGIBLE, OTROS = 0, 1, 2, 3, 90, 91, 99
GLOSAS_ENVIO = {
    CONFORME: "Envío recibido conforme",
    ERROR_SCHEMA: "Envío rechazado: error de schema",
    ERROR_FIRMA: "Envío rechazado: error de firma",
    RUT_NO_CORRESPONDE: "Envío rechazado: RUT receptor no corresponde",
    REPETIDO: "Envío rechazado: archivo repetido",
    ILEGIBLE: "Envío rechazado: archivo ilegible",
    OTROS: "Envío rechazado: otros",
}
# Estados de cada DTE (`EstadoRecepDTE`).
DTE_OK, DTE_ERROR_FIRMA, DTE_RUT_EMISOR, DTE_RUT_RECEPTOR, DTE_REPETIDO, DTE_OTROS = 0, 1, 2, 3, 4, 99

#: Sin DTD ni entidades ni red: un XML de un tercero no puede leer archivos
#: locales ni hacer pedidos (XXE).
_PARSER = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)


class NoEsEnvioDteError(ValueError):
    """El XML se leyó, pero no es un `EnvioDTE` (un acuse, un recibo, otra cosa)."""


@lru_cache(maxsize=1)
def esquema_envio() -> etree.XMLSchema:
    """El `EnvioDTE_v10.xsd` oficial, que incluye `DTE_v10.xsd`."""
    return etree.XMLSchema(etree.parse(str(_XSD / "dte" / "EnvioDTE_v10.xsd")))


@lru_cache(maxsize=1)
def esquema_respuesta() -> etree.XMLSchema:
    return etree.XMLSchema(etree.parse(str(_XSD / "intercambio" / "RespuestaEnvioDTE_v10.xsd")))


# ------------------------------------------------------------------ lectura --


@dataclass
class DteLeido:
    """Un DTE del sobre. `estado` es el `EstadoRecepDTE`."""

    tipo_dte: int
    folio: int
    fecha_emision: date
    rut_emisor: str
    rut_receptor: str
    razon_social_emisor: str
    monto_neto: int
    monto_exento: int
    monto_iva: int
    monto_total: int
    detalle: dict[str, Any]
    xml: bytes
    estado: int = DTE_OK
    glosa: str = "DTE recibido OK"

    def resultado(self) -> dict[str, Any]:
        """Lo que va al `RecepcionDTE` del acuse (y se guarda con el envío)."""
        return {
            "tipo_dte": self.tipo_dte, "folio": self.folio, "fecha_emision": self.fecha_emision.isoformat(),
            "rut_emisor": self.rut_emisor, "rut_receptor": self.rut_receptor,
            "monto_total": self.monto_total, "estado": self.estado, "glosa": self.glosa,
        }


@dataclass
class EnvioLeido:
    estado: int
    glosa: str
    rut_emisor: str | None = None
    razon_social_emisor: str | None = None
    rut_receptor: str | None = None
    envio_dte_id: str | None = None
    digest: str | None = None
    #: La firma del sobre verificó con el certificado que trae.
    firma_valida: bool = False
    documentos: list[DteLeido] = field(default_factory=list)


def _entero(texto: str | None) -> int:
    return int(texto) if texto and texto.strip().lstrip("-").isdigit() else 0


def _leer_dte(nodo: etree._Element, rut_emisor_envio: str | None, rut_receptor: str) -> DteLeido:
    xml = serializar(nodo)
    d = leer_dte(xml)
    doc = {
        "emisor": d.emisor,
        "receptor": d.receptor,
        "forma_pago": d.forma_pago,
        "fecha_vencimiento": d.fecha_vencimiento,
        "lineas": [asdict(linea) for linea in d.lineas],
        "descuentos": d.descuentos,
        "referencias": d.referencias,
    }
    leido = DteLeido(
        tipo_dte=d.tipo, folio=d.folio, fecha_emision=date.fromisoformat(d.fecha_emision),
        rut_emisor=normalizar_rut(d.emisor.get("RUTEmisor", "")),
        rut_receptor=normalizar_rut(d.receptor.get("RUTRecep", "")),
        razon_social_emisor=d.emisor.get("RznSoc", "")[:200],
        monto_neto=_entero(d.totales.get("MntNeto")), monto_exento=_entero(d.totales.get("MntExe")),
        monto_iva=_entero(d.totales.get("IVA")), monto_total=_entero(d.totales.get("MntTotal")),
        detalle=doc, xml=xml,
    )
    if leido.rut_receptor != rut_receptor:
        leido.estado, leido.glosa = DTE_RUT_RECEPTOR, f"El DTE es para el RUT {leido.rut_receptor}"
    elif rut_emisor_envio and leido.rut_emisor != rut_emisor_envio:
        leido.estado, leido.glosa = DTE_RUT_EMISOR, "El RUT emisor del DTE no es el del envío"
    return leido


def _pem(firma: etree._Element) -> bytes:
    """El certificado que trae la firma, en PEM."""
    b64 = firma.findtext(f".//{{{_DS}}}X509Certificate")
    if not b64:
        raise FirmaInvalidaError("La firma no trae su certificado (X509Certificate)")
    der = base64.b64decode("".join(b64.split()))
    lineas = [base64.b64encode(der)[i:i + 64] for i in range(0, len(base64.b64encode(der)), 64)]
    return b"-----BEGIN CERTIFICATE-----\n" + b"\n".join(lineas) + b"\n-----END CERTIFICATE-----\n"


def raiz_de(xml: bytes) -> str:
    """Nombre local del elemento raíz, o "" si no se puede leer."""
    try:
        return etree.QName(etree.fromstring(xml, _PARSER)).localname
    except etree.XMLSyntaxError:
        return ""


def leer_envio(xml: bytes, rut_receptor: str) -> EnvioLeido:
    """Lee y valida un `EnvioDTE` que llegó a la casilla de `rut_receptor`.

    Nunca levanta por un problema del archivo: lo informa en `estado`, que es lo
    que el acuse le dice al proveedor. Solo levanta `NoEsEnvioDteError`, para
    que quien lee la casilla ignore acuses y otros XML que no son documentos.

    Los documentos se leen aunque el sobre tenga un problema de schema o de
    firma: el SII ya los tiene y corren los 8 días para reclamarlos, así que
    esconderlos dejaría a la empresa sin ver una factura que igual le cuenta.
    La firma inválida queda a la vista (`firma_valida`).
    """
    rut_receptor = normalizar_rut(rut_receptor)
    if len(xml) > MAX_SOBRE:
        return EnvioLeido(ILEGIBLE, f"El archivo pesa {len(xml)} bytes; el máximo es {MAX_SOBRE}")
    try:
        raiz = etree.fromstring(xml, _PARSER)
    except etree.XMLSyntaxError as exc:
        return EnvioLeido(ILEGIBLE, f"XML ilegible: {exc}"[:256])
    if etree.QName(raiz).localname != "EnvioDTE":
        raise NoEsEnvioDteError(f"El XML es un <{etree.QName(raiz).localname}>, no un <EnvioDTE>")

    set_dte = raiz.find(f"{{{NS}}}SetDTE")
    caratula = set_dte.find(f"{{{NS}}}Caratula") if set_dte is not None else None
    if caratula is None:
        return EnvioLeido(ERROR_SCHEMA, "El envío no trae <SetDTE> con <Caratula>")

    def dato(tag: str) -> str:
        return (caratula.findtext(f"{{{NS}}}{tag}") or "").strip()

    firma = raiz.find(f"{{{_DS}}}Signature")
    envio = EnvioLeido(
        estado=CONFORME, glosa=GLOSAS_ENVIO[CONFORME],
        rut_emisor=normalizar_rut(dato("RutEmisor")) or None,
        rut_receptor=normalizar_rut(dato("RutReceptor")) or None,
        envio_dte_id=(set_dte.get("ID") or "")[:80] or None,
    )
    if firma is not None:
        envio.digest = (firma.findtext(f".//{{{_DS}}}DigestValue") or "").strip()[:100] or None

    esquema = esquema_envio()
    errores = None if esquema.validate(raiz) else esquema.error_log.last_error
    try:
        if firma is None:
            raise FirmaInvalidaError("El envío no está firmado")
        _verificar(firma, set_dte, _pem(firma), "del envío")
        envio.firma_valida = True
    except (FirmaInvalidaError, ValueError, xmlsec.Error) as exc:
        envio.estado, envio.glosa = ERROR_FIRMA, f"{GLOSAS_ENVIO[ERROR_FIRMA]}: {exc}"[:256]
    if errores:
        envio.estado, envio.glosa = ERROR_SCHEMA, f"{GLOSAS_ENVIO[ERROR_SCHEMA]}: línea {errores.line}: {errores.message}"[:256]
    if envio.rut_receptor != rut_receptor:
        envio.estado = RUT_NO_CORRESPONDE
        envio.glosa = f"{GLOSAS_ENVIO[RUT_NO_CORRESPONDE]}: el envío es para {envio.rut_receptor or 'nadie'}"[:256]
        return envio

    for nodo in set_dte.findall(f"{{{NS}}}DTE"):
        try:
            envio.documentos.append(_leer_dte(nodo, envio.rut_emisor, rut_receptor))
        except (ValueError, KeyError) as exc:
            # Sin tipo, folio o fecha no hay cómo informarlo en el acuse: queda en la glosa.
            envio.glosa = f"{envio.glosa}. Un DTE no se pudo leer: {exc}"[:256]
    if envio.documentos:
        envio.razon_social_emisor = envio.documentos[0].razon_social_emisor
    elif envio.estado == CONFORME:
        envio.estado, envio.glosa = OTROS, "El envío no trae documentos legibles"
    return envio


def sha256(xml: bytes) -> str:
    return hashlib.sha256(xml).hexdigest()


# ---------------------------------------------------------------- respuesta --


@dataclass(frozen=True)
class DatosAcuse:
    """Lo que dice el acuse de un envío. `resultados`, uno por DTE (`DteLeido.resultado`)."""

    codigo: int
    nombre_archivo: str
    recibido_at: datetime
    envio_dte_id: str | None
    digest: str | None
    rut_emisor: str | None
    rut_receptor: str
    estado: int
    glosa: str
    resultados: list[dict[str, Any]]


def _sub(padre: etree._Element, tag: str, texto: object) -> etree._Element:
    nodo = etree.SubElement(padre, f"{{{NS}}}{tag}")
    nodo.text = str(texto)
    return nodo


def respuesta_recepcion(
    acuse: DatosAcuse,
    *,
    cert: CertificadoCargado,
    correo_contacto: str | None = None,
    momento: datetime,
) -> bytes:
    """`RespuestaDTE` con el `RecepcionEnvio` de un envío, firmado.

    Se construye con lxml nodo a nodo (los textos vienen del proveedor: nada se
    concatena como XML) y se verifica la firma antes de devolverlo.
    """
    raiz = etree.Element(f"{{{NS}}}RespuestaDTE", nsmap={None: NS, "xsi": XSI})
    raiz.set("version", "1.0")
    raiz.set(f"{{{XSI}}}schemaLocation", f"{NS} RespuestaEnvioDTE_v10.xsd")
    resultado = etree.SubElement(raiz, f"{{{NS}}}Resultado")
    resultado.set("ID", f"Resp{acuse.codigo}")

    caratula = etree.SubElement(resultado, f"{{{NS}}}Caratula")
    caratula.set("version", "1.0")
    _sub(caratula, "RutResponde", acuse.rut_receptor)
    _sub(caratula, "RutRecibe", acuse.rut_emisor or "0-0")
    _sub(caratula, "IdRespuesta", acuse.codigo)
    _sub(caratula, "NroDetalles", 1)
    if correo_contacto:
        _sub(caratula, "MailContacto", correo_contacto[:80])
    _sub(caratula, "TmstFirmaResp", hora_sii(momento))

    rec = etree.SubElement(resultado, f"{{{NS}}}RecepcionEnvio")
    _sub(rec, "NmbEnvio", acuse.nombre_archivo[:80])
    _sub(rec, "FchRecep", hora_sii(acuse.recibido_at))
    _sub(rec, "CodEnvio", acuse.codigo)
    _sub(rec, "EnvioDTEID", (acuse.envio_dte_id or "")[:80])
    if acuse.digest:
        _sub(rec, "Digest", acuse.digest)
    if acuse.rut_emisor:
        _sub(rec, "RutEmisor", acuse.rut_emisor)
    _sub(rec, "RutReceptor", acuse.rut_receptor)
    _sub(rec, "EstadoRecepEnv", acuse.estado)
    _sub(rec, "RecepEnvGlosa", acuse.glosa[:256])
    if acuse.resultados:
        _sub(rec, "NroDTE", len(acuse.resultados))
        for r in acuse.resultados:
            dte = etree.SubElement(rec, f"{{{NS}}}RecepcionDTE")
            _sub(dte, "TipoDTE", r["tipo_dte"])
            _sub(dte, "Folio", r["folio"])
            _sub(dte, "FchEmis", r["fecha_emision"])
            _sub(dte, "RUTEmisor", r["rut_emisor"])
            _sub(dte, "RUTRecep", r["rut_receptor"])
            _sub(dte, "MntTotal", r["monto_total"])
            _sub(dte, "EstadoRecepDTE", r["estado"])
            _sub(dte, "RecepDTEGlosa", r["glosa"][:256])

    _firmar(raiz, cert, f"#Resp{acuse.codigo}", nodo_id=resultado)
    xml = serializar(raiz)
    releido = etree.fromstring(xml)
    _verificar(releido.find(f"{{{_DS}}}Signature"), releido.find(f"{{{NS}}}Resultado"), cert.cert_pem, "de la respuesta")
    return xml
