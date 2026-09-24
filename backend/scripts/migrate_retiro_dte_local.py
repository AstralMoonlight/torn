"""Borra de cada esquema de tenant las tablas de DTE que ahora viven en dte-torn.

`dtes`, `cafs` y `folio_request_logs` quedaron sin uso cuando la emisión pasó
a dte-torn (ver dte-torn/DESIGN.md §9). Los XML de `dtes` nunca se firmaron, así
que no tienen valor tributario. Los CAF sí: **un CAF con folios sin usar hay
que volver a cargarlo en dte-torn antes de correr esto** (pestaña Folios), o
esos folios se pierden.

Uso (desde backend/):
    python scripts/migrate_retiro_dte_local.py            # muestra qué borraría
    python scripts/migrate_retiro_dte_local.py --aplicar  # borra
"""

import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = (
    f"postgresql://{os.getenv('TORN_DB_USER', 'torn')}:{os.getenv('TORN_DB_PASSWORD', 'torn')}"
    f"@{os.getenv('TORN_DB_HOST', 'localhost')}:{os.getenv('TORN_DB_PORT', '5432')}"
    f"/{os.getenv('TORN_DB_NAME', 'torn_db')}"
)
TABLAS = ("dtes", "folio_request_logs", "cafs")


def main(aplicar: bool) -> None:
    engine = create_engine(DATABASE_URL)
    with engine.begin() as conn:
        esquemas = [r[0] for r in conn.execute(text("SELECT schema_name FROM public.tenants"))] + ["public"]
        for esquema in esquemas:
            for tabla in TABLAS:
                existe = conn.execute(
                    text("SELECT to_regclass(:t)"), {"t": f'"{esquema}".{tabla}'}
                ).scalar()
                if not existe:
                    continue
                if tabla == "cafs":
                    libres = conn.execute(text(
                        f'SELECT count(*) FROM "{esquema}".cafs WHERE ultimo_folio_usado < folio_hasta'
                    )).scalar()
                    if libres:
                        print(f"  ! {esquema}.cafs tiene {libres} CAF con folios sin usar")
                print(f"{'DROP' if aplicar else 'borraría'} {esquema}.{tabla}")
                if aplicar:
                    conn.execute(text(f'DROP TABLE "{esquema}".{tabla} CASCADE'))


if __name__ == "__main__":
    main("--aplicar" in sys.argv)
