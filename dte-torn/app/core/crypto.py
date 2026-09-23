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
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

#: Plaintext del canario. Ver `verificar_llave_maestra`.
_CANARY_CLARO = b"dte-torn/canary"

#: UUID fijo que hace de "tenant" del canario. No existe en `tenants`; solo se
#: usa como salt de la derivación para no depender de que haya empresas creadas.
_CANARY_TENANT = uuid.UUID("00000000-0000-0000-0000-000000000001")

#: GCM con nonce de 96 bits, que es el tamaño para el que está especificado.
_NONCE_BYTES = 12


class LlaveDesconocidaError(Exception):
    """El registro fue cifrado con una versión de llave que no está cargada."""

    def __init__(self, key_version: int) -> None:
        super().__init__(
            f"key_version {key_version} desconocida; la actual es {version_actual()}. "
            "Si se rotó la llave maestra, la anterior tiene que seguir cargada en "
            "DTE_MASTER_KEYS_ANTERIORES para poder leer lo que se cifró con ella."
        )
        self.key_version = key_version


class DescifradoError(Exception):
    """El blob no se pudo descifrar o fue alterado.

    AES-GCM no distingue entre 'llave equivocada' y 'texto cifrado modificado':
    las dos cosas rompen la etiqueta de autenticación. Tampoco conviene
    distinguirlas hacia afuera.
    """


def version_actual() -> int:
    """Versión de llave con la que se cifra lo nuevo.

    Se persiste en cada fila (`key_version`) para que rotar la llave maestra sea
    leer lo viejo con la llave vieja, no re-cifrar la base a ciegas.
    """
    return get_settings().master_key_version


def _llave_maestra(key_version: int) -> bytes:
    llave = get_settings().llave_maestra_de(key_version)
    if llave is None:
        raise LlaveDesconocidaError(key_version)
    return llave


def derivar_llave(tenant_id: uuid.UUID, key_version: int | None = None) -> bytes:
    """Deriva la llave de 32 bytes de un tenant.

    Args:
        tenant_id: UUID del tenant, que actúa como salt.
        key_version: Versión de la llave maestra con la que derivar.

    Returns:
        32 bytes de llave, determinísticos para ese tenant y esa versión.
    """
    key_version = version_actual() if key_version is None else key_version
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
    key_version: int | None = None,
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
    key_version: int | None = None,
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


# ---------------------------------------------------------------- canario ---
#
# El incidente probable con la llave maestra no es que alguien la robe: es un
# redeploy con la variable vacía, renombrada o apuntando a otro secreto. El
# servicio arrancaría sin quejarse, cifraría lo nuevo con una llave distinta y
# dejaría ilegible todo lo anterior. Nadie se entera hasta la primera venta.
#
# El canario cierra eso: una fila con un texto conocido, cifrado con la llave
# vigente. Al arrancar se vuelve a abrir. Si no abre, la llave cambió y el
# proceso no parte. Un servicio caído se nota en un minuto; uno cifrando con la
# llave equivocada se nota cuando ya es tarde.


class LlaveMaestraCambiadaError(Exception):
    """La llave maestra configurada no es la que cifró los datos existentes.

    Casi siempre significa `DTE_MASTER_KEY` mal puesta en el despliegue. Es
    recuperable: poner la llave correcta. Lo que no es recuperable es haber
    seguido operando con la equivocada.
    """

    def __init__(self, key_version: int) -> None:
        super().__init__(
            f"No hay llave que abra los datos cifrados con la versión {key_version}. "
            "NO se debe operar así: esos certificados y CAF quedarían ilegibles. "
            "Revisar DTE_MASTER_KEY (si es la versión vigente) o "
            "DTE_MASTER_KEYS_ANTERIORES (si es una versión previa que quedó fuera "
            "tras una rotación) antes de volver a levantar el servicio."
        )
        self.key_version = key_version


def _canary_aad(key_version: int) -> bytes:
    return f"canary|v{key_version}".encode()


async def verificar_llave_maestra(session: AsyncSession) -> str:
    """Comprueba que la llave configurada es la que cifró lo que ya está guardado.

    La primera vez no hay nada con qué comparar y se siembra el canario.

    Args:
        session: Sesión con transacción abierta (`control_session`).

    Returns:
        `"sembrado"` la primera vez para esa versión, `"ok"` después.

    Raises:
        LlaveMaestraCambiadaError: La llave no corresponde.
    """
    from sqlalchemy import select
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.models import CryptoCanary

    version = version_actual()
    datos = _canary_aad(version)
    nonce, cifrado = sellar(_CANARY_TENANT, _CANARY_CLARO, datos, version)

    # ON CONFLICT: si dos workers arrancan a la vez, siembra uno y el otro
    # verifica contra lo sembrado.
    sembrado = (
        await session.execute(
            pg_insert(CryptoCanary)
            .values(key_version=version, nonce=nonce, cifrado=cifrado)
            .on_conflict_do_nothing(index_elements=["key_version"])
            .returning(CryptoCanary.key_version)
        )
    ).scalar_one_or_none()

    # Cada fila del canario es una versión de llave que alguna vez cifró datos.
    # Se comprueban todas, no solo la vigente: rotar y olvidar la llave anterior
    # en `DTE_MASTER_KEYS_ANTERIORES` deja ilegible lo viejo, y sin esto el
    # servicio arrancaría igual para fallar recién en la primera firma.
    filas = (await session.execute(select(CryptoCanary))).scalars().all()

    for fila in filas:
        try:
            abierto = abrir(
                _CANARY_TENANT,
                fila.nonce,
                fila.cifrado,
                _canary_aad(fila.key_version),
                fila.key_version,
            )
        except (DescifradoError, LlaveDesconocidaError) as exc:
            raise LlaveMaestraCambiadaError(fila.key_version) from exc
        if abierto != _CANARY_CLARO:
            raise LlaveMaestraCambiadaError(fila.key_version)

    return "sembrado" if sembrado is not None else "ok"
