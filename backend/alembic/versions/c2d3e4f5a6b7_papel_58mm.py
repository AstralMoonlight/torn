"""la termica es de 58 mm, no de 57

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-09-30

El formato de impresion "57mm" pasa a "58mm" en el ajuste de cada empresa
(`print_format` y `print_formats`), y el plan Pack 6 dice "Termica 58 mm".
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, Sequence[str], None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cambiar(desde: str, hacia: str) -> None:
    columnas = op.get_bind().execute(sa.text(
        "SELECT table_schema, data_type FROM information_schema.columns "
        "WHERE table_name = 'system_settings' AND column_name = 'print_formats'"
    )).all()
    for esquema, tipo in columnas:
        # json o jsonb segun como nacio el esquema: el texto nuevo toma ese tipo.
        op.execute(sa.text(
            f'UPDATE "{esquema}".system_settings SET '
            f"print_format = CASE WHEN print_format = :desde THEN :hacia ELSE print_format END, "
            f"print_formats = CAST(REPLACE(print_formats::text, :desde_json, :hacia_json) AS {tipo})"
        ).bindparams(desde=desde, hacia=hacia, desde_json=f'"{desde}"', hacia_json=f'"{hacia}"'))
    op.execute(sa.text(
        "UPDATE public.saas_plans SET incluye_impresora = REPLACE(incluye_impresora, :d, :h)"
    ).bindparams(d=desde.replace("mm", " mm"), h=hacia.replace("mm", " mm")))


def upgrade() -> None:
    _cambiar("57mm", "58mm")


def downgrade() -> None:
    _cambiar("58mm", "57mm")
