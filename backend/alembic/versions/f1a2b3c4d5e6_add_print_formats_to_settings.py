"""add print_formats to system_settings

Revision ID: f1a2b3c4d5e6
Revises: e5f6a7b8c9d0
Create Date: 2026-09-17

Formato de impresión por tipo de documento (33/34/39/41/56/61 y "purchase"
para compras), en vez de un único `print_format` global. `print_format` se
conserva como respaldo para cualquier tipo sin entrada explícita.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # sa.JSON() (no postgresql.JSONB): es tabla de tenant y la suite de tests
    # crea el esquema sobre SQLite (`tests/conftest.py`), que no entiende
    # JSONB - mismo criterio que `sales.referencias`/`users.permissions`.
    #
    # Sin `comment=`: con una conexión de `schema_translate_map` (aprovisionamiento
    # de tenants), SQLAlchemy emite el `COMMENT ON COLUMN` apuntando al esquema
    # traducido en el SQL pero antes de que Postgres vea el ADD COLUMN recién
    # hecho en esa misma sesión, y falla con "column does not exist" - se
    # documenta en el modelo (`app/models/settings.py`) en su lugar.
    op.add_column(
        'system_settings',
        sa.Column('print_formats', sa.JSON(), nullable=False, server_default='{}'),
    )


def downgrade() -> None:
    op.drop_column('system_settings', 'print_formats')
