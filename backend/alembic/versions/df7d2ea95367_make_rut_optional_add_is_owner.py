"""make_rut_optional_add_is_owner

Revision ID: df7d2ea95367
Revises: 0ef96f03b890
Create Date: 2026-02-21 01:59:22.484146

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'df7d2ea95367'
down_revision: Union[str, Sequence[str], None] = '0ef96f03b890'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def get_tenant_schemas():
    bind = op.get_bind()
    result = bind.execute(sa.text("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'"))
    return [row[0] for row in result.fetchall()]

def upgrade() -> None:
    schemas = get_tenant_schemas()
    for schema in schemas:
        try:
            op.add_column('users', sa.Column('is_owner', sa.Boolean(), server_default='false', nullable=True), schema=schema)
        except Exception as e:
            print(f"Skipping add is_owner across {schema}: {e}")
            
        try:
            op.alter_column('users', 'rut', existing_type=sa.VARCHAR(length=12), nullable=True, schema=schema)
        except Exception as e:
            print(f"Skipping alter rut across {schema}: {e}")
            
        try:
            op.alter_column('users', 'razon_social', existing_type=sa.VARCHAR(length=200), nullable=True, schema=schema)
        except Exception as e:
            print(f"Skipping alter razon_social across {schema}: {e}")
            
        try:
            op.create_index(op.f(f'ix_{schema}_users_email'), 'users', ['email'], unique=True, schema=schema)
        except Exception as e:
            print(f"Skipping create email index across {schema}: {e}")

def downgrade() -> None:
    schemas = get_tenant_schemas()
    for schema in schemas:
        pass
