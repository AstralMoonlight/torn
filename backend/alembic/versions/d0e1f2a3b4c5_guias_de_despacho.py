"""guías de despacho: tipo de traslado y factura que las cobra

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-09-24

`sales.ind_traslado` (IndTraslado de la guía) y `sales.facturada_por_id` (la
factura que la cobró; NULL mientras está pendiente). Por esquema, con SQL
calificado, como `c9d0e1f2a3b4`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd0e1f2a3b4c5'
down_revision: Union[str, Sequence[str], None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas_con_ventas() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'sales'"
    )).scalars())


def upgrade() -> None:
    for esquema in _esquemas_con_ventas():
        op.execute(f'ALTER TABLE "{esquema}".sales ADD COLUMN IF NOT EXISTS ind_traslado INTEGER')
        op.execute(f'ALTER TABLE "{esquema}".sales ADD COLUMN IF NOT EXISTS facturada_por_id INTEGER '
                   f'REFERENCES "{esquema}".sales(id)')


def downgrade() -> None:
    for esquema in _esquemas_con_ventas():
        op.execute(f'ALTER TABLE "{esquema}".sales DROP COLUMN IF EXISTS facturada_por_id')
        op.execute(f'ALTER TABLE "{esquema}".sales DROP COLUMN IF EXISTS ind_traslado')
