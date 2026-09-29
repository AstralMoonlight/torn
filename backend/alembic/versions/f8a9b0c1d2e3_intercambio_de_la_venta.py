"""envio del XML al cliente (intercambio) en cada venta

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-09-29

`sales.intercambio_estado`: copia del estado en dte-torn (PENDIENTE, ENVIADO,
SIN_CORREO, ERROR) para mostrarlo en el historial sin preguntar venta por venta.
Por esquema de empresa, con SQL calificado (ver e1f2a3b4c5d6).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f8a9b0c1d2e3'
down_revision: Union[str, Sequence[str], None] = 'e7f8a9b0c1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'sales'"
    )).scalars())


def upgrade() -> None:
    for esquema in _esquemas():
        op.execute(f'ALTER TABLE "{esquema}".sales ADD COLUMN IF NOT EXISTS intercambio_estado VARCHAR(12)')


def downgrade() -> None:
    for esquema in _esquemas():
        op.execute(f'ALTER TABLE "{esquema}".sales DROP COLUMN IF EXISTS intercambio_estado')
