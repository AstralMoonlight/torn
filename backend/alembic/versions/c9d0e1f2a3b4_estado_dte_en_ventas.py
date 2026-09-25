"""estado del documento en dte-torn por venta

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-09-24

`sales.dte_estado` y `sales.dte_glosa`: si el SII aceptó, aceptó con reparos o
rechazó. Se aplica a cada esquema de empresa con SQL calificado, porque
`op.add_column` con `schema_translate_map` cae en `public`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, Sequence[str], None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas_con_ventas() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'sales'"
    )).scalars())


def upgrade() -> None:
    for esquema in _esquemas_con_ventas():
        op.execute(f'ALTER TABLE "{esquema}".sales ADD COLUMN IF NOT EXISTS dte_estado VARCHAR(20)')
        op.execute(f'ALTER TABLE "{esquema}".sales ADD COLUMN IF NOT EXISTS dte_glosa VARCHAR(500)')


def downgrade() -> None:
    for esquema in _esquemas_con_ventas():
        op.execute(f'ALTER TABLE "{esquema}".sales DROP COLUMN IF EXISTS dte_glosa')
        op.execute(f'ALTER TABLE "{esquema}".sales DROP COLUMN IF EXISTS dte_estado')
