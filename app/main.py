"""
Torn - Facturador Electrónico (SII Chile)
Punto de entrada principal de la aplicación FastAPI.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import customers, health, issuer, products, sales, inventory, cash, reports, brands, providers, purchases, stats, users, config, auth, roles, price_lists

logger = logging.getLogger(__name__)

#: Orígenes permitidos por CORS. Se sobrescriben con TORN_CORS_ORIGINS
#: (lista separada por comas) para no tener que tocar el código al desplegar.
_DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

_cors_env = os.getenv("TORN_CORS_ORIGINS", "").strip()
CORS_ORIGINS = (
    [origin.strip() for origin in _cors_env.split(",") if origin.strip()]
    if _cors_env
    else _DEFAULT_CORS_ORIGINS
)

#: `create_all` al arrancar es cómodo en local pero pisa el terreno de Alembic
#: y obliga a tener la BD viva sólo para importar la app (rompe los tests).
AUTO_CREATE_TABLES = os.getenv("TORN_AUTO_CREATE_TABLES", "1").lower() not in (
    "0", "false", "no",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicializa recursos al arrancar y los libera al apagar."""
    if AUTO_CREATE_TABLES:
        try:
            Base.metadata.create_all(bind=engine)
        except Exception as exc:  # pragma: no cover - depende del entorno
            logger.warning("No se pudieron crear las tablas al arrancar: %s", exc)
    yield


app = FastAPI(
    title="Torn - Facturador Electrónico",
    description="Sistema de facturación electrónica para el SII de Chile",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────
from app.routers import saas
app.include_router(saas.router)
app.include_router(health.router)
app.include_router(customers.router)
app.include_router(products.router)
app.include_router(brands.router)
app.include_router(sales.router)
app.include_router(issuer.router)
app.include_router(inventory.router)
app.include_router(cash.router)
app.include_router(reports.router)
app.include_router(providers.router)
app.include_router(purchases.router)
app.include_router(stats.router)
app.include_router(users.router)
app.include_router(config.router)
from app.routers import auth
app.include_router(auth.router)
app.include_router(roles.router)
app.include_router(price_lists.router)
from app.routers import folios
app.include_router(folios.router)


@app.exception_handler(HTTPException)
async def logged_http_exception_handler(request: Request, exc: HTTPException):
    """Registra el detail de cada HTTPException antes de responder.

    El frontend (dev, Turbopack) intercepta el AxiosError vía console.error
    y lo muestra en su propio overlay de depuración, que sólo trae el
    mensaje genérico ("Request failed with status code 400") y no el
    `detail` real que arma el backend — para verlo hay que ir al toast de
    la app o, más confiable, acá.
    """
    logger.warning(
        "HTTP %s en %s %s: %s",
        exc.status_code, request.method, request.url.path, exc.detail,
    )
    return await http_exception_handler(request, exc)


@app.get("/")
async def root():
    """Endpoint de salud / bienvenida."""
    return {"message": "Sistema Torn Online"}
