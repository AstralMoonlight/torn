"""Generadores de archivos del SII para los tests.

Un CAF de verdad no se puede versionar: trae la llave privada con la que se
timbran folios reales. Estos generadores producen archivos con la misma
estructura y llaves de juguete, para poder probar el parseo, el guardado y —más
adelante— la firma del TED sin depender de un archivo secreto en el repositorio.
"""

from __future__ import annotations

import base64
import datetime as dt

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from app.core.certificados import OID_RUT_SII

CLAVE_PFX = "clave-de-prueba"


def _b64_entero(valor: int) -> str:
    ancho = (valor.bit_length() + 7) // 8
    return base64.b64encode(valor.to_bytes(ancho, "big")).decode("ascii")


def caf_xml(
    rut: str = "76543210-9",
    razon_social: str = "EMPRESA DE PRUEBA SPA",
    tipo_dte: int = 33,
    desde: int = 1000,
    hasta: int = 1100,
    fecha: str = "2026-09-01",
    llave: rsa.RSAPrivateKey | None = None,
    llave_publica_de: rsa.RSAPrivateKey | None = None,
) -> bytes:
    """Arma un CAF con la estructura que entrega el SII.

    Args:
        llave: Llave privada a poner en `<RSASK>`. Se genera una si no se pasa.
        llave_publica_de: Si se entrega, la pública del `<DA>` sale de **esta**
            llave y no de la privada. Sirve para probar el caso del CAF alterado
            o mezclado con otro.

    Returns:
        El XML en ISO-8859-1, como viene del SII.
    """
    # 1024 bits: es el tamaño que usa el SII para las llaves del timbre, y de
    # paso hace los tests rápidos.
    privada = llave or rsa.generate_private_key(public_exponent=65537, key_size=1024)
    publica = (llave_publica_de or privada).public_key().public_numbers()

    sk_pem = privada.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    pk_pem = (
        (llave_publica_de or privada)
        .public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("ascii")
    )

    # `<FRMA>` es la firma del SII sobre el `<DA>`. No se valida en este
    # servicio —haría falta la llave pública del SII— así que va un relleno.
    frma = base64.b64encode(b"firma-del-sii-de-mentira").decode("ascii")

    xml = f"""<?xml version="1.0" encoding="ISO-8859-1"?>
<AUTORIZACION>
<CAF version="1.0">
<DA>
<RE>{rut}</RE>
<RS>{razon_social}</RS>
<TD>{tipo_dte}</TD>
<RNG><D>{desde}</D><H>{hasta}</H></RNG>
<FA>{fecha}</FA>
<RSAPK><M>{_b64_entero(publica.n)}</M><E>{_b64_entero(publica.e)}</E></RSAPK>
<IDK>100</IDK>
</DA>
<FRMA algoritmo="SHA1withRSA">{frma}</FRMA>
</CAF>
<RSASK>{sk_pem}</RSASK>
<RSAPUBK>{pk_pem}</RSAPUBK>
</AUTORIZACION>
"""
    return xml.encode("ISO-8859-1")


def pfx(
    rut: str | None = "76543210-9",
    dias_validez: int = 365,
    desde_dias: int = -1,
    password: str = CLAVE_PFX,
) -> bytes:
    """Arma un .pfx de juguete, con el RUT donde lo pone el SII."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Titular de Prueba")])
    ahora = dt.datetime.now(dt.timezone.utc)

    builder = (
        x509.CertificateBuilder()
        .subject_name(nombre)
        .issuer_name(nombre)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(ahora + dt.timedelta(days=desde_dias))
        .not_valid_after(ahora + dt.timedelta(days=dias_validez))
    )
    if rut is not None:
        # El RUT va envuelto en DER como IA5String (tag 0x16) dentro del
        # otherName, que es como lo emite el SII.
        der = b"\x16" + bytes([len(rut)]) + rut.encode("ascii")
        builder = builder.add_extension(
            x509.SubjectAlternativeName([x509.OtherName(OID_RUT_SII, der)]),
            critical=False,
        )

    cert = builder.sign(key, hashes.SHA256())
    return pkcs12.serialize_key_and_certificates(
        name=b"prueba",
        key=key,
        cert=cert,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(
            password.encode("utf-8")
        ),
    )
