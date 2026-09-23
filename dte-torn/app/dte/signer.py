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
from datetime import datetime
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

import xmlsec
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from lxml import etree

from app.core.certificados import CertificadoCargado
from app.dte.builder import DECLARACION, NS, serializar
from app.dte.caf import CafParseado

ZONA_CHILE = ZoneInfo("America/Santiago")

#: `<RSR>` es obligatorio y de al menos un carácter, pero una boleta a
#: consumidor final no tiene razón social de receptor.
#: ponytail: valor a confirmar en las pruebas de certificación del SII.
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


def _firmar_documento(dte: etree._Element, documento: etree._Element, cert: CertificadoCargado) -> None:
    """XMLDSig del `<Documento>`, con los algoritmos que fija el esquema del SII."""
    firma = xmlsec.template.create(dte, xmlsec.Transform.C14N, xmlsec.Transform.RSA_SHA1)
    dte.append(firma)
    # Sin Transforms: la firma queda fuera del `<Documento>`, así que no hace
    # falta el enveloped-signature, y el C14N por defecto es el inclusivo.
    xmlsec.template.add_reference(firma, xmlsec.Transform.SHA1, uri=f"#{documento.get('ID')}")
    info = xmlsec.template.ensure_key_info(firma)
    xmlsec.template.add_key_value(info)
    xmlsec.template.x509_data_add_certificate(xmlsec.template.add_x509_data(info))

    ctx = xmlsec.SignatureContext()
    ctx.register_id(documento, "ID")
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

    ctx = xmlsec.SignatureContext()
    ctx.register_id(documento, "ID")
    ctx.key = xmlsec.Key.from_memory(cert_pem, xmlsec.KeyFormat.CERT_PEM)
    try:
        ctx.verify(firma)
    except xmlsec.Error as exc:
        raise FirmaInvalidaError(f"La firma del DTE no verifica: {exc}") from exc


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

    ted = timbrar(documento, caf, momento)
    tmst = etree.SubElement(documento, f"{{{NS}}}TmstFirma")
    tmst.text = hora_sii(momento)

    _firmar_documento(dte, documento, cert)
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
