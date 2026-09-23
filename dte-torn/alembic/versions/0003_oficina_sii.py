"""Unidad del SII del emisor, para la representación impresa.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("oficina_sii", sa.String(60), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "oficina_sii")
