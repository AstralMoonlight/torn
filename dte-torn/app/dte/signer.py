"""Timbre electrónico (TED) y firma XMLDSig del DTE (issue #20).

Hay dos firmas distintas y no se deben confundir:

1. **El timbre (`<TED>`)**: el `<DD>` se firma con RSA-SHA1 usando la llave
   privada que viene **dentro del CAF**. Es lo que va en el código de barras
   PDF417 impreso y lo que prueba que el folio fue autorizado por el SII.
2. **La firma del documento (`<Signature>`)**: XMLDSig sobre el `<Documento>`,
   con el certificado digital de la empresa (o de su representante).

El esquema de firma del SII fija los algoritmos: C14N **inclusivo**,
`rsa-sha1` y digest `sha1`. No son negociables aunque hoy sean anticuados.

Funciones puras: reciben el árbol, el CAF y el certificado ya abiertos, y
devuelven bytes. Quién abre el certificado (y lo audita), dónde se guarda el
resultado y en qué estado queda el documento es cosa de la capa `tasks/`.
"""

from __future__ import annotations

import base64
import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from lxml import etree

# Después de lxml, nunca antes: ver `app/__init__.py`.
import xmlsec  # noqa: E402

from app.core.certificados import CertificadoCargado
from app.dte.builder import DECLARACION, NS, XSI, serializar
from app.dte.caf import CafParseado

ZONA_CHILE = ZoneInfo("America/Santiago")


def hoy_chile() -> date:
    """La fecha de hoy en Chile. Los contenedores corren en UTC: `date.today()`
    da mañana desde las 20-21 h, y el SII rechaza un timbre anterior al documento."""
    return datetime.now(ZONA_CHILE).date()

#: `<RSR>` es obligatorio y de al menos un carácter, pero una boleta a
#: consumidor final no tiene razón social de receptor. Es texto libre: una boleta
#: real de producción (2026-09-23) de otro proveedor usa "sin cliente".
RSR_SIN_RECEPTOR = "CONSUMIDOR FINAL"

_ENTRE_TAGS = re.compile(rb">\s+<")
_SIN_COMILLAS = str.maketrans("", "", "\"'")


class FirmaInvalidaError(Exception):
    """El documento firmado no pasó la verificación posterior a la firma.

    Se levanta en vez de devolver bytes que el SII rechazaría: el folio ya está
    asignado, pero todavía no se envió nada.
    """


@dataclass(slots=True, frozen=True)
class DocumentoFirmado:
    """Resultado de firmar: lo que se guarda en S3 y lo que se imprime."""

    #: El `<DTE>` firmado, en ISO-8859-1. Se persiste tal cual y nunca se
    #: regenera.
    xml: bytes
    #: El `<TED>` tal como quedó en `xml`. Es el contenido del PDF417.
    ted: bytes
    sha256: str
    tipo_dte: int
    folio: int


def hora_sii(momento: datetime) -> str:
    """Formato de fecha y hora que usa el SII, en hora de Chile y sin zona."""
    return momento.astimezone(ZONA_CHILE).strftime("%Y-%m-%dT%H:%M:%S")


def aplanar(xml: bytes) -> bytes:
    """Quita el espacio en blanco **entre** etiquetas, no dentro del texto.

    El SII define la firma del timbre sobre el `<DD>` "aplanado". El CAF viene
    del SII con saltos de línea entre sus nodos; al aplanarlo, lo que se firma y
    lo que queda escrito en el documento son exactamente los mismos bytes.

    Confirmado con una boleta real de producción (2026-09-23): su `<DD>` está
    aplanado con el CAF incluido, y su timbre verifica sobre esos bytes tal cual.
    """
    return _ENTRE_TAGS.sub(b"><", xml.strip())


def _campo(valor: str, largo: int, si_vacio: str) -> bytes:
    """Prepara un campo de texto del `<DD>`.

    Se cortan antes de escapar (el largo máximo es del texto, no del XML) y se
    quitan las comillas: `lxml` las escribe literales al serializar, mientras
    que algunas descripciones del timbre piden `&quot;`. Sin comillas no hay
    ambigüedad entre lo que se firma y lo que queda escrito. El `<DD>` es un
    resumen de 40 caracteres; perderlas no cambia nada.
    """
    limpio = valor.translate(_SIN_COMILLAS).strip()[:largo] or si_vacio
    return escape(limpio).encode("latin-1")


def construir_dd(documento: etree._Element, caf: CafParseado, momento: datetime) -> bytes:
    """Arma el `<DD>` del timbre a partir del documento ya construido.

    Lee del árbol y no de los datos de entrada: el timbre tiene que coincidir
    con lo que dice el documento, no con lo que alguien quiso que dijera.
    """

    def texto(tag: str) -> str:
        return documento.findtext(f".//{{{NS}}}{tag}") or ""

    return b"".join(
        [
            b"<DD>",
            b"<RE>" + texto("RUTEmisor").encode("latin-1") + b"</RE>",
            b"<TD>" + texto("TipoDTE").encode("latin-1") + b"</TD>",
            b"<F>" + texto("Folio").encode("latin-1") + b"</F>",
            b"<FE>" + texto("FchEmis").encode("latin-1") + b"</FE>",
            b"<RR>" + texto("RUTRecep").encode("latin-1") + b"</RR>",
            b"<RSR>" + _campo(texto("RznSocRecep"), 40, RSR_SIN_RECEPTOR) + b"</RSR>",
            b"<MNT>" + texto("MntTotal").encode("latin-1") + b"</MNT>",
            b"<IT1>" + _campo(texto("NmbItem"), 40, "Item") + b"</IT1>",
            aplanar(caf.nodo_caf),
            b"<TSTED>" + hora_sii(momento).encode("latin-1") + b"</TSTED>",
            b"</DD>",
        ]
    )


def firmar_dd(dd: bytes, caf: CafParseado) -> str:
    """Firma el `<DD>` con la llave del CAF: RSA con SHA1, en base64."""
    llave = serialization.load_pem_private_key(caf.llave_ted_pem, password=None)
    assert isinstance(llave, rsa.RSAPrivateKey)
    firma = llave.sign(dd, padding.PKCS1v15(), hashes.SHA1())
    return base64.b64encode(firma).decode("ascii")


def timbrar(documento: etree._Element, caf: CafParseado, momento: datetime) -> bytes:
    """Agrega el `<TED>` al final del `<Documento>` y devuelve sus bytes."""
    dd = construir_dd(documento, caf, momento)
    ted = (
        b'<TED version="1.0">'
        + dd
        + b'<FRMT algoritmo="SHA1withRSA">'
        + firmar_dd(dd, caf).encode("ascii")
        + b"</FRMT></TED>"
    )
    # Se parsea con el namespace del documento declarado, para que al quedar
    # dentro del `<DTE>` sus nodos —incluido el CAF— sean del namespace del SII.
    # La declaración de encoding no es opcional: sin ella lxml asume UTF-8 y
    # cualquier tilde en latin-1 revienta el parseo.
    con_ns = ted.replace(b"<TED ", f'<TED xmlns="{NS}" '.encode(), 1)
    documento.append(etree.fromstring(DECLARACION + con_ns))
    return ted


def _firmar(
    padre: etree._Element,
    cert: CertificadoCargado,
    uri: str,
    nodo_id: etree._Element | None = None,
    envuelta: bool = False,
) -> None:
    """XMLDSig con los algoritmos que fija el esquema del SII.

    Args:
        padre: Donde se agrega el `<Signature>`.
        uri: Referencia firmada: `#ID` de un nodo, o `""` para todo el documento.
        nodo_id: Nodo cuyo atributo `ID` hay que registrar para resolver la URI.
        envuelta: True si la firma queda dentro de lo firmado (necesita el
            transform enveloped-signature). En el DTE y el sobre queda afuera.
    """
    firma = xmlsec.template.create(padre, xmlsec.Transform.C14N, xmlsec.Transform.RSA_SHA1)
    padre.append(firma)
    ref = xmlsec.template.add_reference(firma, xmlsec.Transform.SHA1, uri=uri)
    if envuelta:
        xmlsec.template.add_transform(ref, xmlsec.Transform.ENVELOPED)
    info = xmlsec.template.ensure_key_info(firma)
    xmlsec.template.add_key_value(info)
    xmlsec.template.x509_data_add_certificate(xmlsec.template.add_x509_data(info))

    ctx = xmlsec.SignatureContext()
    if nodo_id is not None:
        ctx.register_id(nodo_id, "ID")
    llave = xmlsec.Key.from_memory(cert.llave_pem, xmlsec.KeyFormat.PEM)
    llave.load_cert_from_memory(cert.cert_pem, xmlsec.KeyFormat.PEM)
    ctx.key = llave
    ctx.sign(firma)


def verificar_firma_dte(dte: etree._Element, cert_pem: bytes) -> None:
    """Verifica la firma XMLDSig de un `<DTE>` donde sea que esté en el árbol.

    Sirve tanto para el DTE suelto como para el que ya está dentro de un
    `<EnvioDTE>`: el C14N se calcula en el contexto en que está el nodo.

    Raises:
        FirmaInvalidaError: La firma no corresponde al contenido.
    """
    documento = dte.find(f"{{{NS}}}Documento")
    firma = dte.find(f"{{{xmlsec.constants.DSigNs}}}Signature")
    if documento is None or firma is None:
        raise FirmaInvalidaError("El DTE no tiene <Documento> o <Signature>")

    _verificar(firma, documento, cert_pem, "del DTE")


def firmar_dte(
    dte: etree._Element,
    caf: CafParseado,
    cert: CertificadoCargado,
    momento: datetime | None = None,
) -> DocumentoFirmado:
    """Timbra y firma un `<DTE>` construido por `builder.construir_dte`.

    Muta el árbol recibido. Antes de devolver, relee los bytes finales y
    comprueba que la firma verifica y que el timbre quedó escrito tal como se
    firmó: si la serialización alterara algo, se sabe acá y no en el SII.

    Args:
        dte: El `<DTE>` sin timbre ni firma.
        caf: El CAF del rango al que pertenece el folio, ya descifrado.
        cert: El certificado ya abierto (y auditado) por `cargar_certificado`.
        momento: Hora de timbre y firma. Por defecto, ahora.

    Raises:
        FirmaInvalidaError: El resultado no pasó la verificación.
    """
    momento = momento or datetime.now(ZONA_CHILE)
    documento = dte.find(f"{{{NS}}}Documento")

    tipo_dte = int(documento.findtext(f".//{{{NS}}}TipoDTE"))
    folio = int(documento.findtext(f".//{{{NS}}}Folio"))
    if not caf.folio_desde <= folio <= caf.folio_hasta or tipo_dte != caf.tipo_dte:
        raise FirmaInvalidaError(
            f"El folio {folio} tipo {tipo_dte} no pertenece al CAF "
            f"{caf.tipo_dte} {caf.folio_desde}-{caf.folio_hasta}"
        )

    fecha = documento.findtext(f".//{{{NS}}}FchEmis")
    if fecha and date.fromisoformat(fecha) > momento.astimezone(ZONA_CHILE).date():
        # El SII lo marca en las muestras impresas: "Fecha Firma del TED debe ser
        # mayor o igual a la fecha del documento".
        raise FirmaInvalidaError(f"La fecha del documento ({fecha}) es posterior a la del timbre ({momento:%Y-%m-%d})")

    ted = timbrar(documento, caf, momento)
    tmst = etree.SubElement(documento, f"{{{NS}}}TmstFirma")
    tmst.text = hora_sii(momento)

    # Sin Transforms: la firma queda fuera del `<Documento>`, así que no hace
    # falta el enveloped-signature, y el C14N por defecto es el inclusivo.
    _firmar(dte, cert, f"#{documento.get('ID')}", nodo_id=documento)
    xml = serializar(dte)

    # Verificación sobre los bytes finales, no sobre el árbol en memoria.
    releido = etree.fromstring(xml)
    verificar_firma_dte(releido, cert.cert_pem)
    if ted not in xml:
        raise FirmaInvalidaError(
            "El timbre quedó escrito distinto de como se firmó; el SII lo rechazaría"
        )

    return DocumentoFirmado(
        xml=xml,
        ted=ted,
        sha256=hashlib.sha256(xml).hexdigest(),
        tipo_dte=tipo_dte,
        folio=folio,
    )


# ------------------------------------------------------------------ semilla --


def firmar_semilla(semilla: str, cert: CertificadoCargado) -> bytes:
    """Arma y firma el `<getToken>` con el que se pide el token al SII.

    A diferencia del DTE, acá la firma va **dentro** de lo firmado (URI vacía,
    todo el documento), así que lleva el transform enveloped-signature.
    """
    raiz = etree.Element("getToken")
    item = etree.SubElement(raiz, "item")
    etree.SubElement(item, "Semilla").text = semilla
    _firmar(raiz, cert, "", envuelta=True)
    return etree.tostring(raiz, encoding="UTF-8", xml_declaration=True)


# -------------------------------------------------------------------- sobre --

#: RUT del SII: es el receptor de todo envío.
RUT_SII = "60803000-K"

_SOBRES = {
    "DTE": ("EnvioDTE", "EnvioDTE_v10.xsd"),
    "BOLETA": ("EnvioBOLETA", "EnvioBOLETA_v11.xsd"),
}


def firmar_sobre(
    documentos: list[DocumentoFirmado],
    *,
    canal: str,
    rut_emisor: str,
    rut_envia: str,
    fecha_resolucion: str,
    numero_resolucion: int,
    cert: CertificadoCargado,
    momento: datetime | None = None,
) -> bytes:
    """Mete DTE ya firmados en un `<EnvioDTE>` o `<EnvioBOLETA>` y firma el sobre.

    Los DTE entran **como bytes**, tal como salieron de `firmar_dte`: no se
    vuelven a construir ni a serializar por su cuenta. Antes de devolver se
    verifica la firma del sobre y la de cada DTE ya dentro de él, que es donde
    las verifica el SII.

    Args:
        canal: "DTE" o "BOLETA".
        rut_emisor: RUT de la empresa.
        rut_envia: RUT de quien firma el envío: el titular del certificado, que
            en general es una persona natural distinta de la empresa.
        fecha_resolucion: Fecha de la resolución del SII (AAAA-MM-DD).
        numero_resolucion: Número de resolución; 0 en certificación.

    Raises:
        FirmaInvalidaError: El sobre firmado no verifica.
    """
    if canal not in _SOBRES:
        raise ValueError(f"Canal desconocido: {canal!r}")
    if not documentos:
        raise ValueError("Un sobre necesita al menos un documento")

    raiz, xsd = _SOBRES[canal]
    momento = momento or datetime.now(ZONA_CHILE)

    conteo: dict[int, int] = {}
    for doc in documentos:
        conteo[doc.tipo_dte] = conteo.get(doc.tipo_dte, 0) + 1
    subtotales = b"".join(
        f"<SubTotDTE><TpoDTE>{tipo}</TpoDTE><NroDTE>{n}</NroDTE></SubTotDTE>".encode()
        for tipo, n in sorted(conteo.items())
    )
    caratula = (
        b'<Caratula version="1.0">'
        + f"<RutEmisor>{rut_emisor}</RutEmisor>"
        f"<RutEnvia>{rut_envia}</RutEnvia>"
        f"<RutReceptor>{RUT_SII}</RutReceptor>"
        f"<FchResol>{fecha_resolucion}</FchResol>"
        f"<NroResol>{numero_resolucion}</NroResol>"
        f"<TmstFirmaEnv>{hora_sii(momento)}</TmstFirmaEnv>".encode()
        + subtotales
        + b"</Caratula>"
    )
    cuerpos = b"".join(doc.xml.split(b"?>", 1)[1].strip() for doc in documentos)
    sobre = (
        DECLARACION
        + f'<{raiz} xmlns="{NS}" xmlns:xsi="{XSI}" '
        f'xsi:schemaLocation="{NS} {xsd}" version="1.0">'.encode()
        + b'<SetDTE ID="SetDoc">'
        + caratula
        + cuerpos
        + b"</SetDTE>"
        + f"</{raiz}>".encode()
    )

    arbol = etree.fromstring(sobre)
    set_dte = arbol.find(f"{{{NS}}}SetDTE")
    _firmar(arbol, cert, "#SetDoc", nodo_id=set_dte)
    xml = serializar(arbol)

    verificar_sobre(etree.fromstring(xml), cert.cert_pem)
    return xml


def _verificar(firma: etree._Element, nodo_id: etree._Element, cert_pem: bytes, que: str) -> None:
    ctx = xmlsec.SignatureContext()
    ctx.register_id(nodo_id, "ID")
    ctx.key = xmlsec.Key.from_memory(cert_pem, xmlsec.KeyFormat.CERT_PEM)
    try:
        ctx.verify(firma)
    except xmlsec.Error as exc:
        raise FirmaInvalidaError(f"La firma {que} no verifica: {exc}") from exc


def verificar_sobre(sobre: etree._Element, cert_pem: bytes) -> None:
    """Verifica la firma del sobre y la de cada DTE, en el contexto del sobre.

    Raises:
        FirmaInvalidaError: Alguna de las firmas no corresponde.
    """
    set_dte = sobre.find(f"{{{NS}}}SetDTE")
    firma = sobre.find(f"{{{xmlsec.constants.DSigNs}}}Signature")
    if set_dte is None or firma is None:
        raise FirmaInvalidaError("El sobre no tiene <SetDTE> o <Signature>")
    _verificar(firma, set_dte, cert_pem, "del sobre")
    for dte in set_dte.findall(f"{{{NS}}}DTE"):
        verificar_firma_dte(dte, cert_pem)
