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

# ── SQLAlchemy engine & session ──────────────────────────────────────
engine = create_engine(DATABASE_URL, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Generador de sesión para inyección de dependencias en FastAPI."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
