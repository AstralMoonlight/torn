"""permisos del rol VENDEDOR con las claves del menu

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-09-29

El rol VENDEDOR nacia con {"sales": true, "cash": true}, pero el menu y el
guardian de rutas leen las etiquetas del menu ("Terminal POS", "Caja"...): un
vendedor entraba al POS sin menu, sin poder llegar a Caja, Historial ni
Clientes. Solo se cambian los roles que siguen con ese valor de fabrica; uno que
el administrador ya edito en Personal queda como esta.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, Sequence[str], None] = 'd6e7f8a9b0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

VIEJO = '{"sales": true, "cash": true}'
NUEVO = '{"Terminal POS": true, "Caja": true, "Historial": true, "Clientes": true}'


def _esquemas() -> list[str]:
    return list(op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = 'roles'"
    )).scalars())


def _cambiar(desde: str, hacia: str) -> None:
    for esquema in _esquemas():
        # La columna es json o jsonb segun como nacio el esquema: se compara como
        # jsonb y el texto nuevo toma el tipo de la columna.
        op.execute(sa.text(
            f'UPDATE "{esquema}".roles SET permissions = :hacia '
            f"WHERE name = 'VENDEDOR' AND permissions::jsonb = CAST(:desde AS jsonb)"
        ).bindparams(desde=desde, hacia=hacia))


def upgrade() -> None:
    _cambiar(VIEJO, NUEVO)


def downgrade() -> None:
    _cambiar(NUEVO, VIEJO)
