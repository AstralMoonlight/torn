"""add vuelto to sales

Revision ID: d4e5f6a7b8c9
Revises: b7c1d2e3f4a5
Create Date: 2026-09-16

Excedente pagado sobre el total de la venta, entregado en efectivo, para
que el arqueo de caja pueda descontarlo del efectivo esperado (issue #27).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'b7c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'sales',
        sa.Column(
            'vuelto', sa.Numeric(15, 2), nullable=False, server_default='0',
            comment='Excedente pagado sobre el total, entregado en efectivo',
        ),
    )


def downgrade() -> None:
    op.drop_column('sales', 'vuelto')
