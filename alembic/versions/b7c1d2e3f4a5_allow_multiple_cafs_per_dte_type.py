"""allow multiple cafs per dte type

Revision ID: b7c1d2e3f4a5
Revises: a1b2c3d4e5f6
Create Date: 2026-09-16

`cafs.tipo_documento` tenía un UNIQUE que permitía un solo CAF por tipo de DTE
en toda la vida del inquilino. Al agotarse sus folios era imposible cargar el
siguiente y la emisión de ese documento quedaba muerta de forma permanente.

El resto del código ya asumía lo contrario: `create_sale` consulta con
`ultimo_folio_usado < folio_hasta` ordenando por `id`, es decir, espera varios
CAF y toma el más antiguo con folios libres.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c1d2e3f4a5'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF EXISTS: los esquemas de inquilino se aprovisionan desde
    # modelo_base_datos.sql, así que el nombre de la restricción puede variar
    # o no estar presente según cuándo se creó el esquema.
    op.execute('ALTER TABLE cafs DROP CONSTRAINT IF EXISTS cafs_tipo_documento_key')

    # La búsqueda del CAF vigente filtra por tipo y ordena por rango.
    op.create_index(
        'ix_cafs_tipo_documento_folio_desde',
        'cafs',
        ['tipo_documento', 'folio_desde'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_cafs_tipo_documento_folio_desde', table_name='cafs')
    op.create_unique_constraint('cafs_tipo_documento_key', 'cafs', ['tipo_documento'])
