"""El canario de la llave maestra y la rotación.

El escenario que esto previene no es un ataque: es un redeploy con
`DTE_MASTER_KEY` vacía, renombrada o apuntando a otro secreto. Sin canario el
servicio arranca, cifra lo nuevo con la llave equivocada y deja ilegible todo lo
anterior, y el síntoma aparece recién en la primera venta que necesita firmar.
"""

from __future__ import annotations

import base64
import json
import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import pytest

from app.core.config import get_settings
from app.core.crypto import (
    DescifradoError,
    LlaveDesconocidaError,
    LlaveMaestraCambiadaError,
    aad,
    abrir,
    sellar,
    verificar_llave_maestra,
    version_actual,
)
from app.db import control_session

LLAVE_A = base64.b64encode(b"A" * 32).decode()
LLAVE_B = base64.b64encode(b"B" * 32).decode()


@contextmanager
def _configurada(
    master: str, version: int = 1, anteriores: dict[str, str] | None = None
) -> Iterator[None]:
    """Reconfigura las llaves del proceso y restaura al salir."""
    variables = {
        "DTE_MASTER_KEY": master,
        "DTE_MASTER_KEY_VERSION": str(version),
        "DTE_MASTER_KEYS_ANTERIORES": json.dumps(anteriores or {}),
    }
    previos = {k: os.environ.get(k) for k in variables}
    os.environ.update(variables)
    get_settings.cache_clear()
    try:
        yield
    finally:
        for k, v in previos.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        get_settings.cache_clear()


# --------------------------------------------------------------- canario ----


async def test_se_siembra_la_primera_vez_y_despues_valida(limpiar: None) -> None:
    """Base nueva: siembra. Arranques siguientes: comprueba."""
    with _configurada(LLAVE_A):
        async with control_session() as s:
            assert await verificar_llave_maestra(s) == "sembrado"
        async with control_session() as s:
            assert await verificar_llave_maestra(s) == "ok"


async def test_otra_llave_impide_arrancar(limpiar: None) -> None:
    """Es el caso que motiva todo esto: el servicio tiene que caerse."""
    with _configurada(LLAVE_A):
        async with control_session() as s:
            await verificar_llave_maestra(s)

    with _configurada(LLAVE_B):
        with pytest.raises(LlaveMaestraCambiadaError):
            async with control_session() as s:
                await verificar_llave_maestra(s)


async def test_el_error_dice_qué_revisar(limpiar: None) -> None:
    """El mensaje se lee a las 3 de la mañana; tiene que nombrar la variable."""
    with _configurada(LLAVE_A):
        async with control_session() as s:
            await verificar_llave_maestra(s)

    with _configurada(LLAVE_B):
        with pytest.raises(LlaveMaestraCambiadaError) as exc:
            async with control_session() as s:
                await verificar_llave_maestra(s)

    assert "DTE_MASTER_KEY" in str(exc.value)


async def test_rotar_la_llave_no_dispara_la_alarma(limpiar: None) -> None:
    """Subir de versión siembra un canario nuevo, no choca con el anterior."""
    with _configurada(LLAVE_A, version=1):
        async with control_session() as s:
            await verificar_llave_maestra(s)

    with _configurada(LLAVE_B, version=2, anteriores={"1": LLAVE_A}):
        async with control_session() as s:
            assert await verificar_llave_maestra(s) == "sembrado"
        async with control_session() as s:
            assert await verificar_llave_maestra(s) == "ok"


# -------------------------------------------------------------- rotación ----


def test_la_llave_anterior_abre_lo_cifrado_antes() -> None:
    """Rotar tiene que dejar legible lo viejo, o no es rotar: es perder datos."""
    tenant = uuid.uuid4()
    datos = aad(tenant, "certificates", uuid.uuid4())

    with _configurada(LLAVE_A, version=1):
        nonce, cifrado = sellar(tenant, b"secreto viejo", datos)

    with _configurada(LLAVE_B, version=2, anteriores={"1": LLAVE_A}):
        assert version_actual() == 2
        # Lo viejo se lee con su versión.
        assert abrir(tenant, nonce, cifrado, datos, key_version=1) == b"secreto viejo"
        # Lo nuevo se cifra con la actual.
        nonce2, cifrado2 = sellar(tenant, b"secreto nuevo", datos)
        assert abrir(tenant, nonce2, cifrado2, datos) == b"secreto nuevo"
        # Y no se confunden entre sí.
        with pytest.raises(DescifradoError):
            abrir(tenant, nonce, cifrado, datos, key_version=2)


def test_rotar_sin_conservar_la_anterior_falla_con_mensaje_claro() -> None:
    """Sin la llave vieja cargada, lo viejo es ilegible; que al menos se entienda."""
    tenant = uuid.uuid4()
    datos = aad(tenant, "cafs", uuid.uuid4())

    with _configurada(LLAVE_A, version=1):
        nonce, cifrado = sellar(tenant, b"secreto", datos)

    with _configurada(LLAVE_B, version=2):  # sin anteriores
        with pytest.raises(LlaveDesconocidaError) as exc:
            abrir(tenant, nonce, cifrado, datos, key_version=1)

    assert "DTE_MASTER_KEYS_ANTERIORES" in str(exc.value)


async def test_olvidar_la_llave_anterior_impide_arrancar(limpiar: None) -> None:
    """Rotar sin conservar la llave vieja deja datos ilegibles: hay que frenar.

    Antes de esta comprobación el servicio arrancaba igual y reventaba recién en
    la primera firma, cuando ya había un folio comprometido.
    """
    with _configurada(LLAVE_A, version=1):
        async with control_session() as s:
            await verificar_llave_maestra(s)

    # Rotación bien hecha: la anterior sigue cargada.
    with _configurada(LLAVE_B, version=2, anteriores={"1": LLAVE_A}):
        async with control_session() as s:
            await verificar_llave_maestra(s)

    # Rotación mal hecha: se cayó la anterior del entorno.
    with _configurada(LLAVE_B, version=2):
        with pytest.raises(LlaveMaestraCambiadaError) as exc:
            async with control_session() as s:
                await verificar_llave_maestra(s)

    assert exc.value.key_version == 1
    assert "DTE_MASTER_KEYS_ANTERIORES" in str(exc.value)
