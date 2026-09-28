"""Vacía los datos de demostración de una empresa antes de usarla de verdad.

Pensado para JCB antes del piloto (tasks/lanzamiento.md 1.2): `seed_jcb.py` le
cargó catálogo, clientes, proveedores, compras y las ventas de la certificación.
Se borran; quedan la empresa, el emisor, los usuarios y sus roles, los medios de
pago, los impuestos, la configuración y el cliente "consumidor final"
(66666666-6), que las boletas necesitan. No toca dte-torn: sus documentos y su
enlace con la empresa (el id) siguen igual.

Uso (desde backend/), siempre primero sin --aplicar:
    python scripts/vaciar_datos_demo.py tenant_763989569            # muestra qué borraría
    python scripts/vaciar_datos_demo.py tenant_763989569 --aplicar  # borra, en una transacción
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
CONSUMIDOR_FINAL = "66666666-6"

#: En orden: primero lo que apunta a otras tablas. (tabla, condición).
BORRAR = [
    ("sale_payments", None),
    ("stock_movements", None),
    ("customer_payments", None),
    ("sale_details", None),
    ("sales", None),
    ("purchase_details", None),
    ("purchases", None),
    ("price_list_product", None),
    ("products", None),
    ("brands", None),
    ("customers", f"rut <> '{CONSUMIDOR_FINAL}'"),
    ("price_lists", None),
    ("providers", None),
    ("cash_sessions", None),
]


def main(esquema: str, aplicar: bool) -> None:
    engine = create_engine(DATABASE_URL)
    with engine.begin() as conn:
        empresa = conn.execute(
            text("SELECT id, name FROM public.tenants WHERE schema_name = :e"), {"e": esquema}
        ).first()
        if empresa is None:
            sys.exit(f"No hay una empresa con el esquema {esquema!r}.")
        print(f"Empresa {empresa.id}: {empresa.name} ({esquema})")
        for tabla, condicion in BORRAR:
            if not conn.execute(text("SELECT to_regclass(:t)"), {"t": f'"{esquema}".{tabla}'}).scalar():
                continue
            donde = f" WHERE {condicion}" if condicion else ""
            filas = conn.execute(text(f'SELECT count(*) FROM "{esquema}".{tabla}{donde}')).scalar()
            print(f"  {'borra' if aplicar else 'borraría'} {filas:>6} de {tabla}")
            if aplicar and filas:
                conn.execute(text(f'DELETE FROM "{esquema}".{tabla}{donde}'))
    if not aplicar:
        print("Nada cambió. Para borrar, agregue --aplicar.")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--aplicar"]
    if len(args) != 1 or args[0] == "public":
        sys.exit(__doc__)
    main(args[0], "--aplicar" in sys.argv)
