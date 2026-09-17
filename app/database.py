"""
Configuración de conexión a PostgreSQL.

Lee las credenciales desde variables de entorno para mantener
la seguridad y portabilidad del proyecto.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

load_dotenv()

# ── Variables de entorno ─────────────────────────────────────────────
DB_USER = os.getenv("TORN_DB_USER", "torn") 
DB_PASSWORD = os.getenv("TORN_DB_PASSWORD", "torn")
DB_HOST = os.getenv("TORN_DB_HOST", "localhost")
DB_PORT = os.getenv("TORN_DB_PORT", "5432")
DB_NAME = os.getenv("TORN_DB_NAME", "torn_db")

DATABASE_URL = (
    f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

# ── Pool de conexiones ───────────────────────────────────────────────
# Los valores por defecto de SQLAlchemy (pool_size=5, max_overflow=10) dan 15
# conexiones. Cada petición con inquilino consume DOS —la sesión global de
# `get_global_db` y la conexión propia de `get_tenant_db` para el
# schema_translate_map—, así que el techo real eran ~7 peticiones concurrentes:
# a partir de ahí el POS devolvía 500 con "QueuePool limit ... reached".
#
# Al subirlos, hay que cuadrarlos con el `max_connections` de PostgreSQL
# (100 por defecto) y multiplicar por el número de instancias del backend.
# Medido contra el stack Docker en /products/ (issue #38): con pool_size=30 +
# max_overflow=40 (70 conexiones, una sola instancia), 60 peticiones
# concurrentes responden 200 y el techo queda entre 60 y 80; antes de esto
# 60 ya devolvía 500 con pool_size=20+max_overflow=30 (50 conexiones).
#
# Eliminar la segunda conexión por petición (que `get_tenant_db` reuse la de
# `get_global_db`) subiría el techo mucho más, pero exigiría que ninguna
# sesión necesite las dos conexiones abiertas a la vez con schema_translate_map
# distinto — no es el caso hoy (ver `app/routers/users.py`, que intercala
# consultas al esquema público y al del tenant en el mismo request) y esta
# ruta de aislamiento por esquema no tiene cobertura de tests todavía. Se
# dejó fuera de este cambio para no arriesgar una fuga de datos entre
# tenants sin esa red de seguridad.
DB_POOL_SIZE = int(os.getenv("TORN_DB_POOL_SIZE", "30"))
DB_MAX_OVERFLOW = int(os.getenv("TORN_DB_MAX_OVERFLOW", "40"))
DB_POOL_TIMEOUT = int(os.getenv("TORN_DB_POOL_TIMEOUT", "30"))

# ── SQLAlchemy engine & session ──────────────────────────────────────
engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_timeout=DB_POOL_TIMEOUT,
    # Descarta conexiones muertas antes de usarlas, en vez de fallar la
    # petición: pasa tras un reinicio de PostgreSQL o si un firewall corta
    # conexiones ociosas.
    pool_pre_ping=True,
    # Recicla cada 30 min para no toparse con timeouts del servidor.
    pool_recycle=1800,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Generador de sesión para inyección de dependencias en FastAPI."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
