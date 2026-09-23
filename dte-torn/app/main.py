"""Entrypoint de la API."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text

from app.core.config import get_settings
from app.db import get_engine

settings = get_settings()

if settings.sentry_dsn:
    sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.env)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Abre y cierra el pool de conexiones."""
    get_engine()
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
