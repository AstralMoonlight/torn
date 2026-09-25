"""Ambiente por documento y por CAF, para el modo Desarrollador.

Cada documento y cada CAF quedan marcados con el ambiente en que nacieron. Los
folios pasan a ser únicos por ambiente: el CAF de prueba de Desarrollador
empieza en 1 igual que uno de maullín. Lo existente toma el ambiente actual de
su tenant.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TERMINALES = "'ACEPTADO','REPAROS','RECHAZADO','ANULADO','ERROR_VALIDACION'"


def upgrade() -> None:
    for tabla in ("cafs", "documents"):
        op.add_column(tabla, sa.Column("ambiente", sa.String(4), nullable=False, server_default="CERT"))
        op.execute(f"UPDATE {tabla} x SET ambiente = t.ambiente FROM tenants t WHERE t.id = x.tenant_id")

    op.drop_index("ix_cafs_disponibles", table_name="cafs")
    op.create_index("ix_cafs_disponibles", "cafs", ["tenant_id", "ambiente", "tipo_dte", "estado", "folio_desde"])

    op.drop_constraint("uq_documents_folio", "documents", type_="unique")
    op.create_unique_constraint("uq_documents_folio", "documents", ["tenant_id", "ambiente", "tipo_dte", "folio"])

    op.drop_index("ix_documents_pendientes", table_name="documents")
    op.create_index(
        "ix_documents_pendientes", "documents", ["estado", "next_action_at"],
        postgresql_where=sa.text(f"estado NOT IN ({_TERMINALES},'SIMULADO')"),
    )


def downgrade() -> None:
    op.drop_index("ix_documents_pendientes", table_name="documents")
    op.create_index(
        "ix_documents_pendientes", "documents", ["estado", "next_action_at"],
        postgresql_where=sa.text(f"estado NOT IN ({_TERMINALES})"),
    )
    op.drop_constraint("uq_documents_folio", "documents", type_="unique")
    op.create_unique_constraint("uq_documents_folio", "documents", ["tenant_id", "tipo_dte", "folio"])
    op.drop_index("ix_cafs_disponibles", table_name="cafs")
    op.create_index("ix_cafs_disponibles", "cafs", ["tenant_id", "tipo_dte", "estado", "folio_desde"])
    op.drop_column("documents", "ambiente")
    op.drop_column("cafs", "ambiente")
