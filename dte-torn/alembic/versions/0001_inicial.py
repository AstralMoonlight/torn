"""Esquema inicial con Row Level Security por tenant.

Revision ID: 0001
Revises:
Create Date: 2026-09-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.core.config import get_settings
from app.models import TABLAS_RLS, TABLAS_SOLO_INSERT

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Expresión del tenant activo. `NULLIF` porque `current_setting(..., true)`
#: devuelve cadena vacía si alguien la fijó en vacío, y `''::uuid` revienta.
#: Sin variable fijada, la comparación da NULL y la política no deja pasar
#: ninguna fila: falla cerrada, que es como tiene que fallar.
_TENANT_ACTUAL = "NULLIF(current_setting('app.tenant_id', true), '')::uuid"


def upgrade() -> None:
    _crear_tablas()
    _crear_rol_aplicacion()
    _aplicar_rls()


def downgrade() -> None:
    for tabla in (
        "dead_letters",
        "audit_log",
        "folio_requests",
        "documents",
        "envios",
        "cafs",
        "certificates",
        "tenants",
    ):
        op.drop_table(tabla)


# ------------------------------------------------------------------ tablas --


def _crear_tablas() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rut_emisor", sa.String(12), nullable=False, unique=True),
        sa.Column("razon_social", sa.String(200), nullable=False),
        sa.Column("giro", sa.String(200), nullable=False),
        sa.Column("acteco", sa.String(10), nullable=False),
        sa.Column("direccion", sa.String(300)),
        sa.Column("comuna", sa.String(100)),
        sa.Column("ciudad", sa.String(100)),
        sa.Column("telefono", sa.String(20)),
        sa.Column("email", sa.String(150)),
        sa.Column("ambiente", sa.String(4), nullable=False, server_default="CERT"),
        sa.Column("resolucion_numero", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("resolucion_fecha", sa.Date()),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "certificates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("pfx_cifrado", sa.LargeBinary(), nullable=False),
        sa.Column("nonce_pfx", sa.LargeBinary(12), nullable=False),
        sa.Column("password_cifrada", sa.LargeBinary(), nullable=False),
        sa.Column("nonce_password", sa.LargeBinary(12), nullable=False),
        sa.Column("key_version", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("subject_rut", sa.String(12)),
        sa.Column("fingerprint_sha256", sa.String(64), nullable=False),
        sa.Column("not_before", sa.DateTime(timezone=True)),
        sa.Column("not_after", sa.DateTime(timezone=True)),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("uploaded_by", sa.String(150)),
    )
    op.create_index("ix_certificates_tenant_id", "certificates", ["tenant_id"])
    op.create_index(
        "ix_certificates_activo_por_tenant",
        "certificates",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("activo"),
    )

    op.create_table(
        "cafs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("tipo_dte", sa.SmallInteger(), nullable=False),
        sa.Column("folio_desde", sa.Integer(), nullable=False),
        sa.Column("folio_hasta", sa.Integer(), nullable=False),
        sa.Column("ultimo_folio_usado", sa.Integer(), nullable=False),
        sa.Column("xml_cifrado", sa.LargeBinary(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(12), nullable=False),
        sa.Column("key_version", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("fecha_autorizacion", sa.Date()),
        sa.Column("fecha_vencimiento", sa.Date()),
        sa.Column("estado", sa.String(10), nullable=False, server_default="ACTIVO"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("folio_hasta >= folio_desde", name="ck_cafs_rango"),
        sa.CheckConstraint(
            "ultimo_folio_usado >= folio_desde - 1 AND ultimo_folio_usado <= folio_hasta",
            name="ck_cafs_puntero_en_rango",
        ),
    )
    op.create_index("ix_cafs_tenant_id", "cafs", ["tenant_id"])
    op.create_index("ix_cafs_disponibles", "cafs", ["tenant_id", "tipo_dte", "estado", "folio_desde"])

    op.create_table(
        "envios",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("tipo_envio", sa.String(6), nullable=False, server_default="DTE"),
        sa.Column("periodo", sa.Date()),
        sa.Column("track_id", sa.String(50)),
        sa.Column("xml_key", sa.Text()),
        sa.Column("xml_sha256", sa.String(64)),
        sa.Column("estado", sa.String(12), nullable=False, server_default="ENVIADO"),
        sa.Column("respuesta_raw", sa.Text()),
        sa.Column("consultas", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("next_poll_at", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_envios_tenant_id", "envios", ["tenant_id"])
    op.create_index(
        "ix_envios_rcof_periodo",
        "envios",
        ["tenant_id", "periodo"],
        unique=True,
        postgresql_where=sa.text("tipo_envio = 'RCOF'"),
    )
    op.create_index("ix_envios_pendientes", "envios", ["estado", "next_poll_at"])

    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("external_id", sa.String(100), nullable=False),
        sa.Column("tipo_dte", sa.SmallInteger(), nullable=False),
        sa.Column("folio", sa.Integer()),
        sa.Column("caf_id", sa.Uuid(), sa.ForeignKey("cafs.id")),
        sa.Column("estado", sa.String(20), nullable=False, server_default="PENDIENTE"),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("receptor_rut", sa.String(12)),
        sa.Column("receptor_razon_social", sa.String(200)),
        sa.Column("monto_neto", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("monto_exento", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("monto_iva", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("monto_total", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("fecha_emision", sa.Date(), nullable=False),
        sa.Column("xml_key", sa.Text()),
        sa.Column("xml_sha256", sa.String(64)),
        sa.Column("xml_bytes", sa.Integer()),
        sa.Column("ted_barcode", sa.Text()),
        sa.Column("envio_id", sa.Uuid(), sa.ForeignKey("envios.id")),
        sa.Column("estado_sii", sa.String(20)),
        sa.Column("glosa_sii", sa.Text()),
        sa.Column("pdf_key", sa.Text()),
        sa.Column("intentos", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("next_action_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        # Idempotencia del llamador.
        sa.UniqueConstraint("tenant_id", "external_id", name="uq_documents_external_id"),
        # Si alguna vez la lógica de folios falla, falla acá antes de emitir
        # dos documentos con el mismo correlativo.
        sa.UniqueConstraint("tenant_id", "tipo_dte", "folio", name="uq_documents_folio"),
    )
    op.create_index("ix_documents_tenant_id", "documents", ["tenant_id"])
    op.create_index(
        "ix_documents_pendientes",
        "documents",
        ["estado", "next_action_at"],
        postgresql_where=sa.text(
            "estado NOT IN ('ACEPTADO','REPAROS','RECHAZADO','ANULADO','ERROR_VALIDACION')"
        ),
    )

    op.create_table(
        "folio_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("tipo_dte", sa.SmallInteger(), nullable=False),
        sa.Column("cantidad", sa.Integer(), nullable=False),
        sa.Column("maximo_autorizado", sa.Integer()),
        sa.Column("estado", sa.String(12), nullable=False, server_default="PENDIENTE"),
        sa.Column("paso", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("respuesta", postgresql.JSONB()),
        sa.Column("caf_id", sa.Uuid(), sa.ForeignKey("cafs.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_folio_requests_tenant_id", "folio_requests", ["tenant_id"])
    # El SII no es idempotente pidiendo folios: dos solicitudes en vuelo del
    # mismo tipo son dos CAF y folios que después hay que declarar sin usar.
    op.create_index(
        "ix_folio_requests_en_vuelo",
        "folio_requests",
        ["tenant_id", "tipo_dte"],
        unique=True,
        postgresql_where=sa.text("estado IN ('PENDIENTE','EN_CURSO')"),
    )

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("documents.id")),
        sa.Column("operacion", sa.String(20), nullable=False),
        sa.Column("resultado", sa.String(10), nullable=False),
        sa.Column("cert_fingerprint", sa.String(64)),
        sa.Column("actor", sa.String(150)),
        sa.Column("detalle", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_audit_log_tenant_id", "audit_log", ["tenant_id"])
    op.create_index("ix_audit_log_doc", "audit_log", ["tenant_id", "document_id", "created_at"])

    op.create_table(
        "dead_letters",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("documents.id")),
        sa.Column("cola", sa.String(20), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("traceback", sa.Text()),
        sa.Column("intentos", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_dead_letters_tenant_id", "dead_letters", ["tenant_id"])


# -------------------------------------------------------------- rol y RLS ---


def _crear_rol_aplicacion() -> None:
    """Crea el rol con el que corre la aplicación.

    Deliberadamente sin `BYPASSRLS` y sin ser dueño de las tablas: si alguna vez
    se olvida un `SET LOCAL app.tenant_id`, la consulta devuelve cero filas en
    lugar de todo.
    """
    password = get_settings().app_db_password.replace("'", "''")
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dte_app') THEN
                CREATE ROLE dte_app LOGIN PASSWORD '{password}';
            END IF;
        END
        $$;
        """
    )
    op.execute("GRANT USAGE ON SCHEMA public TO dte_app")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dte_app")
    op.execute("GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO dte_app")


def _aplicar_rls() -> None:
    """Enciende RLS y crea una política de aislamiento por tabla de tenant."""
    for tabla in TABLAS_RLS:
        op.execute(f"ALTER TABLE {tabla} ENABLE ROW LEVEL SECURITY")
        # FORCE: sin esto el dueño de la tabla se salta sus propias políticas,
        # y basta un script de mantención conectado como dueño para leer todos
        # los tenants sin darse cuenta.
        op.execute(f"ALTER TABLE {tabla} FORCE ROW LEVEL SECURITY")

        if tabla in TABLAS_SOLO_INSERT:
            # Append-only: se puede leer e insertar, no modificar ni borrar.
            # Sin política de UPDATE/DELETE, Postgres las niega.
            op.execute(f"REVOKE UPDATE, DELETE ON {tabla} FROM dte_app")
            op.execute(
                f"CREATE POLICY {tabla}_select ON {tabla} FOR SELECT "
                f"USING (tenant_id = {_TENANT_ACTUAL})"
            )
            op.execute(
                f"CREATE POLICY {tabla}_insert ON {tabla} FOR INSERT "
                f"WITH CHECK (tenant_id = {_TENANT_ACTUAL})"
            )
        else:
            op.execute(
                f"CREATE POLICY {tabla}_aislamiento ON {tabla} "
                f"USING (tenant_id = {_TENANT_ACTUAL}) "
                f"WITH CHECK (tenant_id = {_TENANT_ACTUAL})"
            )
