"""sesion unica: entrar en otro equipo cierra la sesion anterior

Revision ID: d3e4f5a6b7c9
Revises: c2d3e4f5a6b7
Create Date: 2026-10-01

`public.saas_users.sesion_id`: cada login la renueva y va en el JWT (`sid`).
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'd3e4f5a6b7c9'
down_revision: Union[str, Sequence[str], None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.saas_users ADD COLUMN IF NOT EXISTS sesion_id VARCHAR(32)")


def downgrade() -> None:
    op.execute("ALTER TABLE public.saas_users DROP COLUMN IF EXISTS sesion_id")
