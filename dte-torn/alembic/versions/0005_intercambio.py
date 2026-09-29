"""Intercambio: estado del envío del XML al correo del receptor.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("intercambio_estado", sa.String(12)))
    op.add_column("documents", sa.Column("intercambio_correo", sa.String(80)))
    op.add_column("documents", sa.Column("intercambio_intentos", sa.SmallInteger, nullable=False, server_default="0"))
    op.add_column("documents", sa.Column("intercambio_next_at", sa.DateTime(timezone=True)))
    op.add_column("documents", sa.Column("intercambio_at", sa.DateTime(timezone=True)))
    op.add_column("documents", sa.Column("intercambio_error", sa.Text))
    op.create_index(
        "ix_documents_intercambio", "documents", ["intercambio_next_at"],
        postgresql_where=sa.text("intercambio_estado = 'PENDIENTE'"),
    )


def downgrade() -> None:
    op.drop_index("ix_documents_intercambio", table_name="documents")
    for columna in ("intercambio_error", "intercambio_at", "intercambio_next_at",
                    "intercambio_intentos", "intercambio_correo", "intercambio_estado"):
        op.drop_column("documents", columna)
