"""costo del producto en cada línea de venta

Revision ID: b4c5d6e7f8a9
Revises: f2a3b4c5d6e7
Create Date: 2026-09-28

`sale_details.costo_unitario`: el costo al momento de vender, para que la
utilidad de ventas pasadas no cambie con el costo de hoy. Las líneas existentes
toman el costo actual del producto (el mejor dato que hay). Por esquema de
empresa con SQL calificado, igual que `f2a3b4c5d6e7`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4c5d6e7f8a9'
down_revision: Union[str, Sequence[str], None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'sale_details'"
    )).scalars())


def upgrade() -> None:
    for e in _esquemas():
        op.execute(f'ALTER TABLE "{e}".sale_details ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(15, 2) NOT NULL DEFAULT 0')
        op.execute(f'''
            UPDATE "{e}".sale_details sd SET costo_unitario = COALESCE(p.costo_unitario, 0)
            FROM "{e}".products p WHERE p.id = sd.product_id
        ''')


def downgrade() -> None:
    for e in _esquemas():
        op.execute(f'ALTER TABLE "{e}".sale_details DROP COLUMN IF EXISTS costo_unitario')
