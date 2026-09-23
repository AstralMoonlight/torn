"""Entrypoint de la API."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text

from app.core.config import get_settings
from app.core.crypto import verificar_llave_maestra
from app.db import control_session, get_engine

settings = get_settings()

if settings.sentry_dsn:
    sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.env)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Abre el pool y comprueba la llave maestra antes de servir.

    Si la llave configurada no es la que cifró los datos existentes, el proceso
    no parte. Es deliberado: arrancar igual significaría cifrar lo nuevo con una
    llave y dejar lo viejo ilegible, sin que nadie lo note hasta la primera
    venta. Un contenedor que no levanta se ve en el despliegue.
    """
    get_engine()
    async with control_session() as session:
        resultado = await verificar_llave_maestra(session)
    logging.getLogger(__name__).info("llave maestra: %s", resultado)
    yield
    await get_engine().dispose()


app = FastAPI(title="dte-torn", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    """Healthcheck del contenedor: comprueba que la base responde."""
    async with get_engine().connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/metrics")
async def metrics() -> Response:
    """Métricas en formato Prometheus."""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
