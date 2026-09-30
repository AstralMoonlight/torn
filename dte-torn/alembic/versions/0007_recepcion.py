"""Recepción de documentos de proveedores y eventos del registro del SII.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-30

Dos tablas de tenant (`envios_recibidos`, `documentos_recibidos`), con la
misma política de aislamiento que el resto (ver 0001), y en `documents` los
eventos que deja el receptor de una factura propia en el Registro de
Aceptación o Reclamo.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TENANT_ACTUAL = "NULLIF(current_setting('app.tenant_id', true), '')::uuid"
_TABLAS = ("envios_recibidos", "documentos_recibidos")


def _tenant_id() -> sa.Column:
    return sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)


def upgrade() -> None:
    op.create_table(
        "envios_recibidos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _tenant_id(),
        sa.Column("codigo", sa.BigInteger(), sa.Identity(start=1), nullable=False, unique=True),
        sa.Column("origen", sa.String(10), nullable=False),
        sa.Column("correo_origen", sa.String(150)),
        sa.Column("asunto", sa.String(300)),
        sa.Column("nombre_archivo", sa.String(80), nullable=False),
        sa.Column("rut_emisor", sa.String(12)),
        sa.Column("razon_social_emisor", sa.String(200)),
        sa.Column("envio_dte_id", sa.String(80)),
        sa.Column("digest", sa.String(100)),
        sa.Column("xml_key", sa.Text(), nullable=False),
        sa.Column("xml_sha256", sa.String(64), nullable=False),
        sa.Column("estado", sa.SmallInteger(), nullable=False),
        sa.Column("glosa", sa.String(256), nullable=False),
        sa.Column("resultados", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("acuse_estado", sa.String(10), nullable=False),
        sa.Column("acuse_intentos", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("acuse_next_at", sa.DateTime(timezone=True)),
        sa.Column("acuse_at", sa.DateTime(timezone=True)),
        sa.Column("acuse_error", sa.Text()),
        sa.Column("recibido_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "xml_sha256", name="uq_envios_recibidos_sha"),
    )
    op.create_index(
        "ix_envios_recibidos_acuse", "envios_recibidos", ["acuse_next_at"],
        postgresql_where=sa.text("acuse_estado = 'PENDIENTE'"),
    )
    op.create_table(
        "documentos_recibidos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _tenant_id(),
        sa.Column("envio_id", sa.Uuid(), sa.ForeignKey("envios_recibidos.id"), nullable=False),
        sa.Column("tipo_dte", sa.SmallInteger(), nullable=False),
        sa.Column("folio", sa.BigInteger(), nullable=False),
        sa.Column("rut_emisor", sa.String(12), nullable=False),
        sa.Column("razon_social_emisor", sa.String(200), nullable=False),
        sa.Column("fecha_emision", sa.Date(), nullable=False),
        sa.Column("monto_neto", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("monto_exento", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("monto_iva", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("monto_total", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("detalle", postgresql.JSONB(), nullable=False),
        sa.Column("firma_valida", sa.Boolean(), nullable=False),
        sa.Column("xml_key", sa.Text(), nullable=False),
        sa.Column("xml_sha256", sa.String(64), nullable=False),
        sa.Column("fecha_recepcion_sii", sa.DateTime(timezone=True)),
        sa.Column("registro_next_at", sa.DateTime(timezone=True)),
        sa.Column("registro_error", sa.Text()),
        sa.Column("accion", sa.String(3)),
        sa.Column("accion_at", sa.DateTime(timezone=True)),
        sa.Column("accion_actor", sa.String(150)),
        sa.Column("eventos", postgresql.JSONB()),
        sa.Column("eventos_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "rut_emisor", "tipo_dte", "folio", name="uq_documentos_recibidos"),
    )
    op.create_index(
        "ix_documentos_recibidos_registro", "documentos_recibidos", ["registro_next_at"],
        postgresql_where=sa.text("registro_next_at IS NOT NULL"),
    )

    # Mismo trato que 0001: el rol de la aplicación sin bypass, política por tenant.
    for tabla in _TABLAS:
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tabla} TO dte_app")
        op.execute(f"ALTER TABLE {tabla} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {tabla} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {tabla}_aislamiento ON {tabla} "
            f"USING (tenant_id = {_TENANT_ACTUAL}) WITH CHECK (tenant_id = {_TENANT_ACTUAL})"
        )
    op.execute("GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO dte_app")

    op.add_column("documents", sa.Column("eventos_receptor", postgresql.JSONB()))
    op.add_column("documents", sa.Column("eventos_next_at", sa.DateTime(timezone=True)))
    op.create_index(
        "ix_documents_eventos", "documents", ["eventos_next_at"],
        postgresql_where=sa.text("eventos_next_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_documents_eventos", table_name="documents")
    op.drop_column("documents", "eventos_next_at")
    op.drop_column("documents", "eventos_receptor")
    op.drop_table("documentos_recibidos")
    op.drop_table("envios_recibidos")
