"""add ajuste_redondeo to sales

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-16

Ajuste legal por redondeo a la decena de la porción de la venta pagada en
efectivo (issue #36). No es vuelto: el vuelto es lo que sobra del pago sobre
el total ya ajustado por este redondeo.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'sales',
        sa.Column(
            'ajuste_redondeo', sa.Numeric(15, 2), nullable=False, server_default='0',
            comment='Ajuste por redondeo a la decena de la porción pagada en efectivo',
        ),
    )


def downgrade() -> None:
    op.drop_column('sales', 'ajuste_redondeo')
