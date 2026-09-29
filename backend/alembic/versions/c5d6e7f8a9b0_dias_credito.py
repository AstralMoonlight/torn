"""plazo de credito de cada cliente

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-09-28

`customers.dias_credito`: la factura fiada a ese cliente vence a esos dias de
emitida (FchVenc). NULL: el cliente no tiene credito y no puede comprar fiado.
Por esquema de empresa, con SQL calificado (ver e1f2a3b4c5d6).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5d6e7f8a9b0'
down_revision: Union[str, Sequence[str], None] = 'b4c5d6e7f8a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'customers'"
    )).scalars())


def upgrade() -> None:
    for esquema in _esquemas():
        op.execute(f'ALTER TABLE "{esquema}".customers ADD COLUMN IF NOT EXISTS dias_credito INTEGER')


def downgrade() -> None:
    for esquema in _esquemas():
        op.execute(f'ALTER TABLE "{esquema}".customers DROP COLUMN IF EXISTS dias_credito')
