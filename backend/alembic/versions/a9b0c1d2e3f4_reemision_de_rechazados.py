"""documento de dte-torn de una venta vuelta a emitir tras un rechazo

Revision ID: a9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-09-29

`sales.dte_external_id`: el external_id del documento nuevo cuando una venta
RECHAZADA se vuelve a emitir (`venta-{id}-{folio rechazado}`); NULL es el de
siempre, `venta-{id}`. Por esquema de empresa, con SQL calificado (ver e1f2a3b4c5d6).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9b0c1d2e3f4'
down_revision: Union[str, Sequence[str], None] = 'f8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'sales'"
    )).scalars())


def upgrade() -> None:
    for esquema in _esquemas():
        op.execute(f'ALTER TABLE "{esquema}".sales ADD COLUMN IF NOT EXISTS dte_external_id VARCHAR(100)')


def downgrade() -> None:
    for esquema in _esquemas():
        op.execute(f'ALTER TABLE "{esquema}".sales DROP COLUMN IF EXISTS dte_external_id')
