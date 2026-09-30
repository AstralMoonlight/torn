"""Reemplazo de documentos rechazados: reutilizar el folio o anularlo.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-30

El SII da por no emitido un documento rechazado: su folio se reutiliza o se
declara anulado (FAQ 001.003.2167). El único de folio pasa a ignorar los
RECHAZADO, y cada rechazado anota quién lo reemplazó y si su folio ya se anuló.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("reemplazado_por", sa.Uuid, sa.ForeignKey("documents.id")))
    op.add_column("documents", sa.Column("folio_anulado_at", sa.DateTime(timezone=True)))
    op.drop_constraint("uq_documents_folio", "documents", type_="unique")
    op.create_index(
        "uq_documents_folio", "documents", ["tenant_id", "ambiente", "tipo_dte", "folio"],
        unique=True, postgresql_where=sa.text("estado <> 'RECHAZADO'"),
    )


def downgrade() -> None:
    # Falla si ya hay un folio reutilizado: dos filas con el mismo folio.
    op.drop_index("uq_documents_folio", table_name="documents")
    op.create_unique_constraint("uq_documents_folio", "documents", ["tenant_id", "ambiente", "tipo_dte", "folio"])
    op.drop_column("documents", "folio_anulado_at")
    op.drop_column("documents", "reemplazado_por")
