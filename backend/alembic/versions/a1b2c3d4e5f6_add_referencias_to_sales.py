"""add referencias to sales

Revision ID: a1b2c3d4e5f6
Revises: c3ddcda6f3fe
Create Date: 2026-02-21

Referencias a documentos previos (OC, Guía, etc.) para Factura Electrónica SII.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'c3ddcda6f3fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sales', sa.Column('referencias', sa.JSON(), nullable=True, comment='Lista de {tipo_documento, folio, fecha}'))


def downgrade() -> None:
    op.drop_column('sales', 'referencias')
