"""Tests de `safe_schema_name`.

PostgreSQL no permite parametrizar identificadores, así que el nombre del
esquema del inquilino se concatena en unas 17 consultas. Este validador es la
única barrera entre ese valor y el SQL.
"""

import pytest

from app.services.tenant_service import _generate_schema_name
from app.utils.schemas import safe_schema_name


class TestSafeSchemaName:
    @pytest.mark.parametrize("nombre", [
        "tenant_761234560",
        "tenant_12345678k",
        "public",
        "_interno",
        "a",
        "t" + "0" * 62,          # 63 caracteres, el máximo
    ])
    def test_acepta_identificadores_validos(self, nombre):
        assert safe_schema_name(nombre) == nombre

    @pytest.mark.parametrize("nombre", [
        'tenant"; DROP TABLE users; --',
        "tenant_1; SELECT 1",
        'tenant_1" OR "1"="1',
        "tenant-con-guiones",
        "tenant con espacios",
        "Tenant_Mayusculas",         # el generador siempre produce minúsculas
        "1empieza_con_digito",
        "",
        "t" + "0" * 63,              # 64 caracteres, excede el límite
        None,
        123,
    ])
    def test_rechaza_lo_demas(self, nombre):
        with pytest.raises(ValueError):
            safe_schema_name(nombre)

    def test_acepta_lo_que_produce_el_generador(self):
        """El validador no debe rechazar nombres legítimos del propio sistema."""
        for rut in ["76.123.456-0", "12345678-K", "9.876.543-2"]:
            generado = _generate_schema_name(rut)
            assert safe_schema_name(generado) == generado
