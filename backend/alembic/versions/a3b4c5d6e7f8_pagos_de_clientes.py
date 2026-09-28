"""pagos de clientes con crédito interno

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-09-28

`customer_payments`: el pago que baja `customers.current_balance`. Se crea en
cada esquema de empresa con SQL calificado, igual que `f2a3b4c5d6e7`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, Sequence[str], None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _esquemas_con_clientes() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'customers'"
    )).scalars())


def upgrade() -> None:
    for e in _esquemas_con_clientes():
        op.execute(f'''
            CREATE TABLE IF NOT EXISTS "{e}".customer_payments (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER NOT NULL REFERENCES "{e}".customers(id),
                amount NUMERIC(15, 2) NOT NULL,
                payment_method_id INTEGER NOT NULL REFERENCES "{e}".payment_methods(id),
                user_id INTEGER NOT NULL REFERENCES "{e}".users(id),
                cash_session_id INTEGER REFERENCES "{e}".cash_sessions(id),
                nota VARCHAR(200),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
            )
        ''')
        op.execute(f'CREATE INDEX IF NOT EXISTS ix_customer_payments_customer_id ON "{e}".customer_payments (customer_id)')
        op.execute(f'CREATE INDEX IF NOT EXISTS ix_customer_payments_cash_session_id ON "{e}".customer_payments (cash_session_id)')


def downgrade() -> None:
    for e in _esquemas_con_clientes():
        op.execute(f'DROP TABLE IF EXISTS "{e}".customer_payments')
