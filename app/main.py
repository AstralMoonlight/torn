"""
Torn - Facturador Electrónico (SII Chile)
Punto de entrada principal de la aplicación FastAPI.
"""

from fastapi import FastAPI

from app.database import Base, engine
from app.routers import customers, health, products, sales

# ── Crear tablas en la BD (si no existen) ────────────────────────────
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Torn - Facturador Electrónico",
    description="Sistema de facturación electrónica para el SII de Chile",
    version="0.1.0",
)

# ── Routers ──────────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(customers.router)
app.include_router(products.router)
app.include_router(sales.router)


@app.get("/")
async def root():
    """Endpoint de salud / bienvenida."""
    return {"message": "Sistema Torn Online"}
