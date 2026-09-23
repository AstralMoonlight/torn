"""Fixtures de los tests.

Corren contra PostgreSQL de verdad, no SQLite: lo que se está probando es
`SELECT ... FOR UPDATE`, `ON CONFLICT` y Row Level Security. Ninguna de las
tres existe en SQLite, así que un test en memoria pasaría siempre sin demostrar
nada. La base sale del docker-compose del repo.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

RAIZ = Path(__file__).resolve().parent.parent

# Antes de importar nada de `app`: la configuración se cachea al primer import.
os.environ.setdefault("DTE_MASTER_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
os.environ.setdefault("DTE_INTERNAL_API_KEY", "test")
os.environ.setdefault("DTE_APP_DB_PASSWORD", "dte_app")
os.environ.setdefault(
    "DTE_DATABASE_URL", "postgresql+asyncpg://dte_app:dte_app@localhost:5432/dte_test"
)
os.environ.setdefault(
    "DTE_DATABASE_OWNER_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/dte_test"
)

from sqlalchemy import text  # noqa: E402

from app.db import control_session, get_engine, tenant_session  # noqa: E402
from app.models import CAF, EstadoCAF, Tenant  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def esquema() -> None:
    """Aplica las migraciones una vez por sesión de tests.

    En subproceso porque `alembic/env.py` hace `asyncio.run()` y pytest-asyncio
    ya tiene un loop corriendo.
    """
    r = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=RAIZ,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        pytest.fail(f"alembic upgrade head falló:\n{r.stdout}\n{r.stderr}")


@pytest_asyncio.fixture
async def limpiar() -> AsyncIterator[None]:
    """Deja las tablas vacías antes de cada test.

    TRUNCATE va como dueño (no hay sesión de aplicación que pueda borrar
    `audit_log`, que es append-only a propósito).
    """
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.core.config import get_settings

    owner = create_async_engine(get_settings().database_owner_url)
    async with owner.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE dead_letters, audit_log, folio_requests, documents, "
                "envios, cafs, certificates, tenants RESTART IDENTITY CASCADE"
            )
        )
    await owner.dispose()
    yield
    await get_engine().dispose()


@pytest_asyncio.fixture
async def tenant(limpiar: None) -> uuid.UUID:
    """Crea un tenant de prueba y devuelve su id."""
    tid = uuid.uuid4()
    async with control_session() as s:
        s.add(
            Tenant(
                id=tid,
                rut_emisor=f"7{uuid.uuid4().int % 9999999}-9",
                razon_social="Empresa de Prueba SpA",
                giro="Servicios",
                acteco="620200",
            )
        )
    return tid


@pytest_asyncio.fixture
async def caf_factory(tenant: uuid.UUID):
    """Devuelve una función que carga un CAF para el tenant de prueba."""

    async def crear(
        tipo_dte: int = 33,
        desde: int = 1000,
        hasta: int = 1100,
        usado: int | None = None,
        estado: str = EstadoCAF.ACTIVO,
    ) -> uuid.UUID:
        caf_id = uuid.uuid4()
        async with tenant_session(tenant) as s:
            s.add(
                CAF(
                    id=caf_id,
                    tenant_id=tenant,
                    tipo_dte=tipo_dte,
                    folio_desde=desde,
                    folio_hasta=hasta,
                    # El puntero sin estrenar es `desde - 1`, no 0.
                    ultimo_folio_usado=desde - 1 if usado is None else usado,
                    xml_cifrado=b"x",
                    nonce=b"0" * 12,
                    estado=estado,
                )
            )
        return caf_id

    return crear
