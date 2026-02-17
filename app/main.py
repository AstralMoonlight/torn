"""
Torn - Facturador Electrónico (SII Chile)
Punto de entrada principal de la aplicación FastAPI.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import customers, health, issuer, products, sales, inventory, cash, reports, brands, providers, purchases, stats, users

app = FastAPI(
    title="Torn - Facturador Electrónico",
    description="Sistema de facturación electrónica para el SII de Chile",
    version="0.1.0",
)

# ── CORS ─────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    """Crear tablas en la BD (si no existen) al iniciar la app."""
    Base.metadata.create_all(bind=engine)

# ── Routers ──────────────────────────────────────────────────────────
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


@app.get("/")
async def root():
    """Endpoint de salud / bienvenida."""
    return {"message": "Sistema Torn Online"}
