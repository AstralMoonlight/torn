"""Deja el esquema al día antes de levantar la API (CMD de Dockerfile.backend).

Base existente: `alembic upgrade head`. Base vacía (sin `public.alembic_version`):
`create_all` + `stamp head`, porque la cadena de migraciones asume tablas previas
y no parte de cero.

Si falla, sale con error y el contenedor no arranca: mejor un reinicio visible en
`docker ps` que una API que responde 500 por una columna que falta.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import inspect  # noqa: E402

import app.main  # noqa: E402,F401  registra todos los modelos (vía routers) en Base.metadata
from app.database import Base, engine  # noqa: E402

ALEMBIC_INI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alembic.ini")


def main() -> None:
    cfg = Config(ALEMBIC_INI)
    if inspect(engine).has_table("alembic_version", schema="public"):
        command.upgrade(cfg, "head")
    else:
        Base.metadata.create_all(bind=engine)
        command.stamp(cfg, "head")


if __name__ == "__main__":
    main()
