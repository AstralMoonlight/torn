"""modo del emisor con que se emitió cada venta

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-25

`sales.modo` (CERT, PROD o DEV): una venta solo se ve en el modo en que se
emitió. Las existentes quedan en CERT. Se aplica a cada esquema de empresa con
SQL calificado, porque `op.add_column` con `schema_translate_map` cae en `public`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, Sequence[str], None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas_con_ventas() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'sales'"
    )).scalars())


def upgrade() -> None:
    for esquema in _esquemas_con_ventas():
        op.execute(f"ALTER TABLE \"{esquema}\".sales ADD COLUMN IF NOT EXISTS modo VARCHAR(4) NOT NULL DEFAULT 'CERT'")


def downgrade() -> None:
    for esquema in _esquemas_con_ventas():
        op.execute(f'ALTER TABLE "{esquema}".sales DROP COLUMN IF EXISTS modo')
