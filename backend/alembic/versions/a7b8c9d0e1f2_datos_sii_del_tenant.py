"""datos del SII del tenant, para sincronizar el emisor con dte-torn

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-09-24

Ambiente (CERT/PROD), resolución y unidad del SII que dte-torn necesita y el
`Issuer` del tenant no tiene. Viven en `public.tenants` porque solo los edita
un superusuario.

DDL escrito como SQL calificado con `public.` e `IF NOT EXISTS`: con
`schema_translate_map` las operaciones de Alembic no siempre caen en el esquema
esperado, y esta revisión se estampa también en cada esquema de tenant.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.tenants
            ADD COLUMN IF NOT EXISTS sii_ambiente VARCHAR(4) NOT NULL DEFAULT 'CERT',
            ADD COLUMN IF NOT EXISTS sii_resolucion_numero INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sii_resolucion_fecha DATE,
            ADD COLUMN IF NOT EXISTS sii_oficina VARCHAR(60)
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE public.tenants
            DROP COLUMN IF EXISTS sii_oficina,
            DROP COLUMN IF EXISTS sii_resolucion_fecha,
            DROP COLUMN IF EXISTS sii_resolucion_numero,
            DROP COLUMN IF EXISTS sii_ambiente
    """)
