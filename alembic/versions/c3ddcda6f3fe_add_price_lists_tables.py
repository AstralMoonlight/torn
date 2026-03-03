"""add_price_lists_tables

Revision ID: c3ddcda6f3fe
Revises: df7d2ea95367
Create Date: 2026-03-03 18:42:00.823071

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3ddcda6f3fe'
down_revision: Union[str, Sequence[str], None] = 'df7d2ea95367'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Crear tabla price_lists
    op.create_table(
        'price_lists',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), onupdate=sa.text('now()'), nullable=True),
    )

    # 2. Crear tabla pivote price_list_product
    op.create_table(
        'price_list_product',
        sa.Column('price_list_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('fixed_price', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.ForeignKeyConstraint(['price_list_id'], ['price_lists.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('price_list_id', 'product_id')
    )

    # 3. Alterar tabla customers para agregar foreign key
    op.add_column('customers', sa.Column('price_list_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_customers_price_list_id', 'customers', 'price_lists', ['price_list_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    # Revertir cambios en orden inverso
    op.drop_constraint('fk_customers_price_list_id', 'customers', type_='foreignkey')
    op.drop_column('customers', 'price_list_id')
    op.drop_table('price_list_product')
    op.drop_table('price_lists')
