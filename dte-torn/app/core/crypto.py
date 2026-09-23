"""Cifrado de los secretos de cada tenant.

Sobre de dos capas:

1. Una llave maestra de 32 bytes que vive **fuera** de la base de datos
   (`DTE_MASTER_KEY`, del entorno o de un gestor de secretos).
2. De ella se deriva, con HKDF-SHA256 y el `tenant_id` como salt, una llave
   distinta por tenant. Nunca hay una sola llave compartida: comprometer el
   material cifrado de una empresa no compromete el de otra.

El cifrado es AES-256-GCM, que además autentica. El AAD amarra cada blob a su
tenant y a su fila concreta, así que un blob movido de un registro a otro —o de
un tenant a otro— no descifra, aunque la llave maestra sea la misma.

Nada de esto protege contra un atacante que ya tenga la llave maestra **y** la
base de datos. Protege contra el escenario realista: un dump de la base, un
backup filtrado, un `SELECT` de más.
"""

from __future__ import annotations

import os
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings

#: Versión de llave con la que se cifra hoy. Se persiste en cada fila
#: (`key_version`) para que rotar la llave maestra sea leer las filas viejas con
#: la llave vieja, no una migración de datos a ciegas.
KEY_VERSION_ACTUAL = 1

#: GCM con nonce de 96 bits, que es el tamaño para el que está especificado.
_NONCE_BYTES = 12


class LlaveDesconocidaError(Exception):
    """El registro fue cifrado con una versión de llave que ya no está cargada."""

    def __init__(self, key_version: int) -> None:
        super().__init__(
            f"key_version {key_version} desconocida; la actual es {KEY_VERSION_ACTUAL}. "
            "Si se rotó la llave maestra, hay que cargar también la anterior."
        )
        self.key_version = key_version


class DescifradoError(Exception):
    """El blob no se pudo descifrar o fue alterado.

    AES-GCM no distingue entre 'llave equivocada' y 'texto cifrado modificado':
    las dos cosas rompen la etiqueta de autenticación. Tampoco conviene
    distinguirlas hacia afuera.
    """


def _llave_maestra(key_version: int) -> bytes:
    if key_version != KEY_VERSION_ACTUAL:
        raise LlaveDesconocidaError(key_version)
    return get_settings().master_key_bytes


def derivar_llave(tenant_id: uuid.UUID, key_version: int = KEY_VERSION_ACTUAL) -> bytes:
    """Deriva la llave de 32 bytes de un tenant.

    Args:
        tenant_id: UUID del tenant, que actúa como salt.
        key_version: Versión de la llave maestra con la que derivar.

    Returns:
        32 bytes de llave, determinísticos para ese tenant y esa versión.
    """
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=tenant_id.bytes,
        info=f"dte-torn/tenant-key/v{key_version}".encode(),
    )
    return hkdf.derive(_llave_maestra(key_version))


def aad(tenant_id: uuid.UUID, tabla: str, registro_id: uuid.UUID) -> bytes:
    """Construye el dato autenticado que amarra un blob a su fila.

    Va firmado pero no cifrado: si alguien copia `pfx_cifrado` de una fila a
    otra, o de un tenant a otro, el AAD deja de calzar y el descifrado falla.
    """
    return f"{tenant_id}|{tabla}|{registro_id}".encode()


def sellar(
    tenant_id: uuid.UUID,
    claro: bytes,
    datos_autenticados: bytes,
    key_version: int = KEY_VERSION_ACTUAL,
) -> tuple[bytes, bytes]:
    """Cifra `claro` con la llave del tenant.

    Args:
        tenant_id: Dueño del secreto.
        claro: Bytes a cifrar.
        datos_autenticados: El AAD, normalmente de `aad()`.
        key_version: Versión de llave a usar.

    Returns:
        `(nonce, cifrado)`. Los dos hay que guardarlos; el nonce no es secreto
        pero **no se puede repetir** con la misma llave, por eso es aleatorio y
        nunca un contador.
    """
    nonce = os.urandom(_NONCE_BYTES)
    cifrado = AESGCM(derivar_llave(tenant_id, key_version)).encrypt(
        nonce, claro, datos_autenticados
    )
    return nonce, cifrado


def abrir(
    tenant_id: uuid.UUID,
    nonce: bytes,
    cifrado: bytes,
    datos_autenticados: bytes,
    key_version: int = KEY_VERSION_ACTUAL,
) -> bytes:
    """Descifra lo que produjo `sellar`.

    Raises:
        DescifradoError: Llave equivocada, AAD distinto o blob alterado.
        LlaveDesconocidaError: `key_version` no corresponde a ninguna llave cargada.
    """
    try:
        return AESGCM(derivar_llave(tenant_id, key_version)).decrypt(
            nonce, cifrado, datos_autenticados
        )
    except InvalidTag as exc:
        raise DescifradoError(
            "No se pudo descifrar: llave, AAD o contenido no corresponden"
        ) from exc
