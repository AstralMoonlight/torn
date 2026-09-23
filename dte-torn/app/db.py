"""Motor y sesiones de base de datos.

Todo acceso a datos de un tenant pasa por `tenant_session()`, que abre una
transacción y fija `app.tenant_id` **con `set_config(..., is_local => true)`**.
Ese `true` es lo que hace que el valor muera con la transacción. Un `SET` no
local sobrevive en la conexión, vuelve al pool y el siguiente tenant que la tome
hereda el filtro RLS del anterior: la peor falla posible en este servicio.
Por eso no hay forma de obtener una sesión sin declarar el tenant.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """Retorna el engine del rol de aplicación (sin bypass de RLS)."""
    global _engine, _session_factory
    if _engine is None:
        s = get_settings()
        _engine = create_async_engine(
            s.database_url,
            pool_size=s.db_pool_size,
            max_overflow=s.db_max_overflow,
            pool_pre_ping=True,
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


@asynccontextmanager
async def tenant_session(tenant_id: uuid.UUID | str) -> AsyncIterator[AsyncSession]:
    """Abre una transacción con RLS fijado al tenant indicado.

    Hace commit al salir y rollback si el bloque levanta.

    Args:
        tenant_id: UUID del tenant.

    Yields:
        La sesión, ya dentro de la transacción.
    """
    get_engine()
    assert _session_factory is not None
    async with _session_factory() as session:
        async with session.begin():
            await session.execute(
                text("SELECT set_config('app.tenant_id', :tid, true)"),
                {"tid": str(tenant_id)},
            )
            yield session


@asynccontextmanager
async def control_session() -> AsyncIterator[AsyncSession]:
    """Sesión para `tenants`, la única tabla sin RLS.

    No fija `app.tenant_id`, así que cualquier consulta a una tabla con RLS
    devuelve cero filas. Es deliberado: si una consulta de tenant se cuela acá,
    falla vacía en vez de leer de más.
    """
    get_engine()
    assert _session_factory is not None
    async with _session_factory() as session:
        async with session.begin():
            yield session
