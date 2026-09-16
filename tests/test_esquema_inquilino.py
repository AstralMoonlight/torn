"""Verifica que `modelo_base_datos.sql` no se quede atrás de los modelos.

El aprovisionamiento de inquilinos construye las tablas desde ese volcado y
después hace `alembic stamp head`, declarando el esquema al día. Lo que falte en
el volcado no lo añade nadie y el inquilino nace incompleto, sin que ningún
error lo delate hasta que alguien usa la funcionalidad que falta.

Ya ocurrió: los inquilinos nuevos salían sin las tablas de listas de precios
(`c3ddcda6f3fe`) y sin `sales.referencias` (`a1b2c3d4e5f6`). Esta última hacía
fallar cualquier consulta sobre Sale con `UndefinedColumn`, de modo que
/stats/summary y /sales/ devolvían 500 en toda empresa recién creada.

Este test compara el volcado contra los modelos y falla si divergen. Cuando una
migración nueva toque el esquema del inquilino, hay que reflejarla también en
`modelo_base_datos.sql` (o resolver #33, que sustituye el volcado por Alembic).
"""

import pathlib
import re

import pytest

from app.database import Base
# Importar los modelos registra sus tablas en Base.metadata.
import app.models  # noqa: F401

RAIZ = pathlib.Path(__file__).resolve().parent.parent
VOLCADO = RAIZ / "modelo_base_datos.sql"

#: Tablas que viven en el esquema `public` (plano SaaS) y que por tanto no
#: forman parte del esquema de cada inquilino.
TABLAS_GLOBALES = {"saas_plans", "saas_users", "tenants", "tenant_users", "actecos"}

#: Alembic crea esta tabla por su cuenta al stampar.
TABLAS_IGNORADAS = {"alembic_version"}


def _sql() -> str:
    return VOLCADO.read_text(encoding="utf-8", errors="replace")


def _columnas_del_volcado(sql: str) -> dict:
    """Extrae {tabla: {columnas}} de los CREATE TABLE y ALTER TABLE ADD COLUMN."""
    columnas: dict = {}

    for match in re.finditer(
        r"CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)\s*\((.*?)\n\);",
        sql,
        re.DOTALL,
    ):
        tabla, cuerpo = match.group(1), match.group(2)
        cols = set()
        for linea in cuerpo.split("\n"):
            linea = linea.strip().rstrip(",")
            if not linea or linea.upper().startswith(
                ("CONSTRAINT", "PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "CHECK")
            ):
                continue
            cols.add(linea.split()[0].strip('"'))
        columnas.setdefault(tabla, set()).update(cols)

    for match in re.finditer(
        r"ALTER TABLE (?:ONLY )?(?:public\.)?(\w+)\s+ADD COLUMN (?:IF NOT EXISTS )?(\w+)",
        sql,
    ):
        columnas.setdefault(match.group(1), set()).add(match.group(2))

    return columnas


def _tablas_de_inquilino():
    """Tablas que los modelos esperan en el esquema de cada inquilino."""
    return {
        t.name: {c.name for c in t.columns}
        for t in Base.metadata.sorted_tables
        if t.schema != "public"
        and t.name not in TABLAS_GLOBALES
        and t.name not in TABLAS_IGNORADAS
    }


def test_el_volcado_existe():
    assert VOLCADO.is_file(), f"No se encontró {VOLCADO}"


def test_el_volcado_tiene_todas_las_tablas_del_inquilino():
    del_volcado = _columnas_del_volcado(_sql())
    esperadas = _tablas_de_inquilino()

    faltantes = sorted(set(esperadas) - set(del_volcado))
    assert not faltantes, (
        "modelo_base_datos.sql no crea estas tablas, así que los inquilinos "
        f"nuevos nacerán sin ellas: {faltantes}"
    )


@pytest.mark.parametrize("tabla", sorted(_tablas_de_inquilino()))
def test_el_volcado_tiene_todas_las_columnas(tabla):
    del_volcado = _columnas_del_volcado(_sql())
    esperadas = _tablas_de_inquilino()[tabla]

    if tabla not in del_volcado:
        pytest.skip("la ausencia de la tabla la reporta el test anterior")

    faltantes = sorted(esperadas - del_volcado[tabla])
    assert not faltantes, (
        f"modelo_base_datos.sql define '{tabla}' sin las columnas {faltantes}. "
        "Si vienen de una migración, hay que reflejarla también en el volcado."
    )
