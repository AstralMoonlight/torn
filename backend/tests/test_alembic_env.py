"""alembic/env.py corre en cada alta de empresa (stamp head): un import roto ahí
rompe el aprovisionamiento entero, y ningún otro test lo carga."""

import ast
import importlib
from pathlib import Path


def test_los_modelos_que_importa_env_existen():
    env = Path(__file__).resolve().parent.parent / "alembic" / "env.py"
    modulos = [
        alias.name
        for nodo in ast.walk(ast.parse(env.read_text(encoding="utf-8")))
        if isinstance(nodo, ast.Import)
        for alias in nodo.names
        if alias.name.startswith("app.")
    ]
    assert modulos
    for modulo in modulos:
        importlib.import_module(modulo)
