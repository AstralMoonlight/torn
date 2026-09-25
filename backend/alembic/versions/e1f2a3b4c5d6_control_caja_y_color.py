"""control de caja y color principal por empresa

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-09-25

`system_settings.control_caja` (el POS exige turno abierto), `color_mode`
('empresa' | 'usuario') y `color_primario` (clave de la paleta). Se aplica a
cada esquema de empresa con SQL calificado, porque `op.add_column` con
`schema_translate_map` cae en `public`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = 'd0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas_con_settings() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'system_settings'"
    )).scalars())


def upgrade() -> None:
    for esquema in _esquemas_con_settings():
        t = f'"{esquema}".system_settings'
        op.execute(f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS control_caja BOOLEAN NOT NULL DEFAULT true")
        op.execute(f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS color_mode VARCHAR(10) NOT NULL DEFAULT 'empresa'")
        op.execute(f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS color_primario VARCHAR(20) NOT NULL DEFAULT 'azul'")


def downgrade() -> None:
    for esquema in _esquemas_con_settings():
        t = f'"{esquema}".system_settings'
        for col in ("color_primario", "color_mode", "control_caja"):
            op.execute(f"ALTER TABLE {t} DROP COLUMN IF EXISTS {col}")
