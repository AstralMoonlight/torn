"""Que lxml y xmlsec compartan una sola libxml2.

Los wheels precompilados de ambos traen su propia copia estática de libxml2.
Con las dos cargadas en el mismo proceso, firmar un árbol creado por lxml
termina en **segfault**, no en excepción: el proceso se muere sin traza y sin
que ningún `try/except` lo note. Por eso el Dockerfile los compila desde fuente
contra la libxml2 del sistema.

Este test es la comprobación de que ese pin sigue siendo válido. Si alguien sube
`lxml` o `xmlsec` en requirements.txt y el par deja de ser compatible, esto se
cae (o mata al proceso de pytest, que también es una señal). Correrlo en el host
no prueba nada: lo que se está verificando es la imagen.
"""

from __future__ import annotations

import datetime as dt

import lxml.etree as etree
import xmlsec
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

PLANTILLA = (
    b'<?xml version="1.0" encoding="ISO-8859-1"?>'
    b"<Documento><Detalle>Ni\xf1o</Detalle></Documento>"
)


def _llave_y_cert() -> tuple[bytes, bytes]:
    """Genera un par autofirmado de juguete, solo para este test."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "prueba")])
    ahora = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(nombre)
        .issuer_name(nombre)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(ahora - dt.timedelta(days=1))
        .not_valid_after(ahora + dt.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    pem_key = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return pem_key, cert.public_bytes(serialization.Encoding.PEM)


def test_firma_y_verifica_un_arbol_de_lxml() -> None:
    """Firmar con xmlsec un árbol de lxml y volver a verificarlo."""
    pem_key, pem_cert = _llave_y_cert()

    raiz = etree.fromstring(PLANTILLA)
    firma = xmlsec.template.create(
        raiz,
        xmlsec.Transform.EXCL_C14N,
        xmlsec.Transform.RSA_SHA256,
    )
    raiz.append(firma)
    ref = xmlsec.template.add_reference(firma, xmlsec.Transform.SHA256, uri="")
    xmlsec.template.add_transform(ref, xmlsec.Transform.ENVELOPED)
    xmlsec.template.ensure_key_info(firma)

    ctx = xmlsec.SignatureContext()
    ctx.key = xmlsec.Key.from_memory(pem_key, xmlsec.KeyFormat.PEM)
    ctx.key.load_cert_from_memory(pem_cert, xmlsec.KeyFormat.PEM)
    ctx.sign(firma)

    # Si llegamos acá con una firma no vacía, las dos librerías conviven.
    valor = firma.find(".//{http://www.w3.org/2000/09/xmldsig#}SignatureValue")
    assert valor is not None and valor.text

    ctx_verifica = xmlsec.SignatureContext()
    ctx_verifica.key = xmlsec.Key.from_memory(pem_key, xmlsec.KeyFormat.PEM)
    ctx_verifica.verify(firma)


#: Declaración que el SII espera, con comillas dobles. `lxml` emite comillas
#: simples (`<?xml version='1.0' ...?>`) y no hay opción para cambiarlo, así que
#: el cuerpo se serializa sin declaración y esta se antepone a mano.
DECLARACION = b'<?xml version="1.0" encoding="ISO-8859-1"?>\n'


def test_serializacion_iso_8859_1() -> None:
    """El DTE va en ISO-8859-1, no en UTF-8, y se maneja como bytes.

    Pasar por `str` en el camino es la forma más fácil de invalidar una firma:
    cambia la declaración y con ella los bytes que se firmaron.
    """
    raiz = etree.fromstring(PLANTILLA)
    cuerpo = etree.tostring(raiz, encoding="ISO-8859-1", xml_declaration=False)
    salida = DECLARACION + cuerpo

    assert isinstance(salida, bytes)
    assert salida.startswith(b'<?xml version="1.0" encoding="ISO-8859-1"?>')
    # La eñe viaja como un solo byte 0xF1, no como los dos de UTF-8.
    assert b"\xf1" in salida and "Niño".encode("utf-8") not in salida
