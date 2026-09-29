"""descuentos: porcentaje por linea, descuento global y tope del personal

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-09-28

- `sale_details.descuento_pct`: la linea se desconto en porcentaje (la NC lo repite).
- `sales.descuento_global` / `descuento_global_pct`: descuento al total, en pesos
  netos o en porcentaje (la NC lo devuelve en proporcion).
- `system_settings.descuento_maximo`: tope en % para quien no es administrador.

Por esquema de empresa, con SQL calificado (ver e1f2a3b4c5d6).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd6e7f8a9b0c1'
down_revision: Union[str, Sequence[str], None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNAS = [
    ("sale_details", "descuento_pct", "NUMERIC(5, 2)"),
    ("sales", "descuento_global", "NUMERIC(15, 2) NOT NULL DEFAULT 0"),
    ("sales", "descuento_global_pct", "BOOLEAN NOT NULL DEFAULT false"),
    ("system_settings", "descuento_maximo", "INTEGER NOT NULL DEFAULT 10"),
]


def _esquemas(tabla: str) -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = :t"
    ), {"t": tabla}).scalars())


def upgrade() -> None:
    for tabla, columna, tipo in COLUMNAS:
        for e in _esquemas(tabla):
            op.execute(f'ALTER TABLE "{e}".{tabla} ADD COLUMN IF NOT EXISTS {columna} {tipo}')


def downgrade() -> None:
    for tabla, columna, _ in COLUMNAS:
        for e in _esquemas(tabla):
            op.execute(f'ALTER TABLE "{e}".{tabla} DROP COLUMN IF EXISTS {columna}')
