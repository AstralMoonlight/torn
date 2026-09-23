"""Carga, cifrado y uso del certificado digital de cada empresa.

El .pfx permite firmar documentos tributarios **en nombre del cliente**, así que
acá manda una regla: cada vez que se abre uno queda una fila en `audit_log`, con
o sin éxito. Si algún día hay que responder "quién firmó qué y cuándo", la
respuesta sale de esa tabla.

El .pfx y su clave se guardan cifrados con la llave derivada del tenant
(`core/crypto.py`). En claro solo existen dentro del proceso que firma, el
tiempo que dura la firma; Python no permite borrarlos de memoria de forma
confiable, y fingir lo contrario sería peor que asumirlo.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import aad, abrir, sellar, version_actual
from app.models import AuditLog, Certificate

#: OID bajo el que el SII pone el RUT del titular en el subjectAltName.
OID_RUT_SII = x509.ObjectIdentifier("1.3.6.1.4.1.8321.1")

#: El RUT viene envuelto en DER dentro del otherName; el tipo de cadena varía
#: entre emisores de certificados (IA5String, PrintableString, UTF8String).
#: En vez de adivinar el tipo, se busca el patrón dentro de los bytes.
_PATRON_RUT = re.compile(rb"(\d{1,8}-[\dkK])")

OPERACION_CARGA = "CARGA_CERT"
OPERACION_ACCESO = "ACCESO_CERT"


class CertificadoInvalidoError(Exception):
    """El .pfx no se pudo abrir: clave incorrecta o archivo corrupto."""


class CertificadoVencidoError(Exception):
    """El certificado está fuera de vigencia.

    Se corta acá y no en el SII: firmar con un certificado vencido produce
    documentos que el SII rechaza, pero el folio ya se gastó.
    """


class SinCertificadoError(Exception):
    """El tenant no tiene certificado activo cargado."""


@dataclass(slots=True)
class CertificadoCargado:
    """Material del certificado, en claro y listo para firmar.

    `llave_pem` y `cert_pem` van en PEM porque es lo que consume `xmlsec`.
    """

    certificate_id: uuid.UUID
    llave_pem: bytes
    cert_pem: bytes
    cadena_pem: list[bytes]
    rut: str | None
    fingerprint_sha256: str
    not_before: datetime | None
    not_after: datetime | None

    def __repr__(self) -> str:
        """Representación sin material sensible.

        El `repr` por defecto de un dataclass imprime todos los campos, y este
        objeto termina en trazas, en Sentry y en logs de excepción. La llave
        privada no puede viajar ahí.
        """
        return (
            f"<CertificadoCargado id={self.certificate_id} rut={self.rut} "
            f"fingerprint={self.fingerprint_sha256[:16]}... vence={self.not_after}>"
        )


def _extraer_rut(cert: x509.Certificate) -> str | None:
    """Saca el RUT del titular del subjectAltName, o del serialNumber."""
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        for nombre in san.value:
            if isinstance(nombre, x509.OtherName) and nombre.type_id == OID_RUT_SII:
                encontrado = _PATRON_RUT.search(nombre.value)
                if encontrado:
                    return encontrado.group(1).decode("ascii")
    except x509.ExtensionNotFound:
        pass

    for atributo in cert.subject.get_attributes_for_oid(NameOID.SERIAL_NUMBER):
        valor = atributo.value
        if isinstance(valor, bytes):
            valor = valor.decode("utf-8", "ignore")
        encontrado = _PATRON_RUT.search(valor.encode("ascii", "ignore"))
        if encontrado:
            return encontrado.group(1).decode("ascii")
    return None


def parsear_pfx(pfx: bytes, password: str) -> CertificadoCargado:
    """Abre un .pfx y extrae llave, certificado y metadatos.

    No toca la base de datos: es una función pura, y por eso se puede probar
    sin levantar nada.

    Raises:
        CertificadoInvalidoError: Clave incorrecta, archivo corrupto o .pfx sin
            llave privada.
    """
    try:
        llave, cert, cadena = pkcs12.load_key_and_certificates(
            pfx, password.encode("utf-8") if password else None
        )
    except Exception as exc:  # cryptography lanza ValueError con mensajes varios
        raise CertificadoInvalidoError(
            "No se pudo abrir el .pfx: clave incorrecta o archivo corrupto"
        ) from exc

    if llave is None or cert is None:
        raise CertificadoInvalidoError(
            "El .pfx no contiene llave privada y certificado"
        )

    return CertificadoCargado(
        certificate_id=uuid.uuid4(),  # lo reemplaza quien lo guarde
        llave_pem=llave.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ),
        cert_pem=cert.public_bytes(serialization.Encoding.PEM),
        cadena_pem=[c.public_bytes(serialization.Encoding.PEM) for c in (cadena or [])],
        rut=_extraer_rut(cert),
        fingerprint_sha256=cert.fingerprint(hashes.SHA256()).hex(),
        not_before=cert.not_valid_before_utc,
        not_after=cert.not_valid_after_utc,
    )


async def guardar_certificado(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    pfx: bytes,
    password: str,
    subido_por: str | None = None,
) -> Certificate:
    """Valida un .pfx, lo cifra y lo deja como el certificado activo del tenant.

    El anterior se desactiva en la misma transacción: `certificates` tiene un
    índice único parcial sobre `activo`, así que no pueden convivir dos.

    Raises:
        CertificadoInvalidoError: El .pfx no abre con esa clave.
        CertificadoVencidoError: Ya está fuera de vigencia.
    """
    material = parsear_pfx(pfx, password)

    if material.not_after and material.not_after < datetime.now(timezone.utc):
        raise CertificadoVencidoError(
            f"El certificado venció el {material.not_after:%Y-%m-%d}"
        )

    cert_id = uuid.uuid4()
    datos = aad(tenant_id, Certificate.__tablename__, cert_id)
    nonce_pfx, pfx_cifrado = sellar(tenant_id, pfx, datos)
    nonce_pwd, pwd_cifrada = sellar(tenant_id, password.encode("utf-8"), datos)

    await session.execute(
        update(Certificate)
        .where(Certificate.tenant_id == tenant_id, Certificate.activo.is_(True))
        .values(activo=False)
    )
    await session.flush()

    fila = Certificate(
        id=cert_id,
        tenant_id=tenant_id,
        pfx_cifrado=pfx_cifrado,
        nonce_pfx=nonce_pfx,
        password_cifrada=pwd_cifrada,
        nonce_password=nonce_pwd,
        key_version=version_actual(),
        subject_rut=material.rut,
        fingerprint_sha256=material.fingerprint_sha256,
        not_before=material.not_before,
        not_after=material.not_after,
        activo=True,
        uploaded_by=subido_por,
    )
    session.add(fila)
    await session.flush()

    session.add(
        AuditLog(
            tenant_id=tenant_id,
            operacion=OPERACION_CARGA,
            resultado="OK",
            cert_fingerprint=material.fingerprint_sha256,
            actor=subido_por,
            detalle={"rut": material.rut, "vence": str(material.not_after)},
        )
    )
    await session.flush()
    return fila


async def cargar_certificado(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    motivo: str,
    document_id: uuid.UUID | None = None,
) -> CertificadoCargado:
    """Descifra el certificado activo del tenant y deja registro del acceso.

    Args:
        session: Sesión con el tenant fijado.
        tenant_id: Tenant dueño del certificado.
        motivo: Para qué se abre. Va al `audit_log`.
        document_id: Documento que motivó el acceso, si lo hay.

    Raises:
        SinCertificadoError: El tenant no tiene certificado activo.
        CertificadoVencidoError: El certificado activo ya venció.
        DescifradoError: El blob no corresponde (ver `core/crypto.py`).
    """
    fila = (
        await session.execute(
            select(Certificate).where(
                Certificate.tenant_id == tenant_id, Certificate.activo.is_(True)
            )
        )
    ).scalar_one_or_none()

    if fila is None:
        raise SinCertificadoError(f"El tenant {tenant_id} no tiene certificado activo")

    datos = aad(tenant_id, Certificate.__tablename__, fila.id)
    try:
        pfx = abrir(tenant_id, fila.nonce_pfx, fila.pfx_cifrado, datos, fila.key_version)
        password = abrir(
            tenant_id, fila.nonce_password, fila.password_cifrada, datos, fila.key_version
        ).decode("utf-8")
        material = parsear_pfx(pfx, password)
    except Exception as exc:
        session.add(
            AuditLog(
                tenant_id=tenant_id,
                document_id=document_id,
                operacion=OPERACION_ACCESO,
                resultado="ERROR",
                cert_fingerprint=fila.fingerprint_sha256,
                actor=motivo,
                detalle={"error": type(exc).__name__},
            )
        )
        await session.flush()
        raise

    material.certificate_id = fila.id

    if material.not_after and material.not_after < datetime.now(timezone.utc):
        raise CertificadoVencidoError(
            f"El certificado del tenant venció el {material.not_after:%Y-%m-%d}"
        )

    session.add(
        AuditLog(
            tenant_id=tenant_id,
            document_id=document_id,
            operacion=OPERACION_ACCESO,
            resultado="OK",
            cert_fingerprint=fila.fingerprint_sha256,
            actor=motivo,
        )
    )
    await session.flush()
    return material
