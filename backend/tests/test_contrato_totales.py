"""Contrato de los totales (#39): la tabla vive en dte-torn, dueño del cálculo."""

import json
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.routers.sales import _descuento_global_dte, _linea_dte
from app.utils.taxes import totales_dte

RUTA = Path(__file__).resolve().parents[2] / "dte-torn" / "tests" / "casos_totales.json"
CASOS = json.loads(RUTA.read_text(encoding="utf-8"))["casos"]


@pytest.mark.parametrize("caso", CASOS, ids=[c["id"] for c in CASOS])
def test_totales_dte_cumple_el_contrato(caso):
    if "backend" in caso.get("pendiente", []):
        pytest.skip("pendiente en el backend")
    lineas = []
    for l in caso["lineas"]:
        producto = SimpleNamespace(nombre="x", codigo_interno="x", unidad_medida=None,
                                   tax=SimpleNamespace(rate=0 if l["exento"] else 19))
        pct = Decimal(l["descuento_pct"]) if "descuento_pct" in l else None
        item, monto, exenta = _linea_dte(caso["tipo_dte"], producto, Decimal(l["cantidad"]),
                                         Decimal(l["precio_neto"]), Decimal(l.get("descuento", "0")),
                                         descuento_pct=pct)
        # Lo que el backend manda a dte-torn es lo que dice el contrato.
        assert Decimal(item["precio"]) == Decimal(l["precio_dte"])
        assert item["descuento"] == l.get("descuento_dte", 0)
        lineas.append((monto, exenta))
    globales = [_descuento_global_dte(caso["tipo_dte"], Decimal(g["valor"]), g["porcentaje"], lineas)
                for g in caso.get("descuentos_globales", [])]
    neto, exento, iva, total = totales_dte(caso["tipo_dte"], lineas, globales)
    assert {"neto": neto, "exento": exento, "iva": iva, "total": total} == caso["esperado"]
