"""Canario de la llave maestra.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "crypto_canary",
        sa.Column("key_version", sa.SmallInteger(), primary_key=True),
        sa.Column("nonce", sa.LargeBinary(12), nullable=False),
        sa.Column("cifrado", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # Sin RLS: la tabla no tiene datos de ningún tenant. El rol de la aplicación
    # necesita leerla e insertar la primera vez; el GRANT de la migración 0001
    # solo alcanzó a las tablas que existían entonces.
    op.execute("GRANT SELECT, INSERT ON crypto_canary TO dte_app")


def downgrade() -> None:
    op.drop_table("crypto_canary")
