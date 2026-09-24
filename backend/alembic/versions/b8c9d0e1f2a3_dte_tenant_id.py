"""id de la empresa en dte-torn cuando no es el derivado

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-24

Para empresas que ya existían en dte-torn antes de darse de alta en Torn. Allá
su id no se puede cambiar: el certificado y los CAF están cifrados con una
llave derivada de él. Ver `app/services/dte_client.tenant_uuid`.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, Sequence[str], None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS dte_tenant_id UUID UNIQUE")


def downgrade() -> None:
    op.execute("ALTER TABLE public.tenants DROP COLUMN IF EXISTS dte_tenant_id")
