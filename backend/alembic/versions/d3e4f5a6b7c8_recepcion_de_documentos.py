"""documentos de proveedores: la compra que registra cada uno, y el reclamo del cliente

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-09-30

- `purchases.dte_recibido_id`: el documento recibido en dte-torn con que se
  registró la compra. Único: una factura de proveedor no se ingresa dos veces.
- `sales.estado_receptor`: lo que hizo el cliente con una factura nuestra en el
  Registro de Aceptación o Reclamo del SII (ACEPTADO, RECLAMADO), copiado de
  dte-torn como `intercambio_estado`.

Por esquema de empresa, con SQL calificado (ver e1f2a3b4c5d6).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, Sequence[str], None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas(tabla: str) -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = :t"
    ), {"t": tabla}).scalars())


def upgrade() -> None:
    for esquema in _esquemas("purchases"):
        op.execute(f'ALTER TABLE "{esquema}".purchases ADD COLUMN IF NOT EXISTS dte_recibido_id VARCHAR(36)')
        op.execute(f'CREATE UNIQUE INDEX IF NOT EXISTS ix_purchases_dte_recibido_id '
                   f'ON "{esquema}".purchases (dte_recibido_id)')
    for esquema in _esquemas("sales"):
        op.execute(f'ALTER TABLE "{esquema}".sales ADD COLUMN IF NOT EXISTS estado_receptor VARCHAR(10)')


def downgrade() -> None:
    for esquema in _esquemas("sales"):
        op.execute(f'ALTER TABLE "{esquema}".sales DROP COLUMN IF EXISTS estado_receptor')
    for esquema in _esquemas("purchases"):
        op.execute(f'DROP INDEX IF EXISTS "{esquema}".ix_purchases_dte_recibido_id')
        op.execute(f'ALTER TABLE "{esquema}".purchases DROP COLUMN IF EXISTS dte_recibido_id')
