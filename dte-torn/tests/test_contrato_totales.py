"""Contrato de los totales (#39): la misma tabla corre contra el backend y el frontend."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from app.dte.builder import DescuentoGlobal, Item, calcular_totales

CASOS = json.loads((Path(__file__).parent / "casos_totales.json").read_text(encoding="utf-8"))["casos"]


@pytest.mark.parametrize("caso", CASOS, ids=[c["id"] for c in CASOS])
def test_calcular_totales_cumple_el_contrato(caso: dict) -> None:
    items = [
        Item(nombre="x", cantidad=Decimal(l["cantidad"]), precio=Decimal(l["precio_dte"]), exento=l["exento"],
             descuento=l.get("descuento_dte", 0),
             descuento_pct=Decimal(l["descuento_pct"]) if "descuento_pct" in l else None)
        for l in caso["lineas"]
    ]
    globales = [DescuentoGlobal(valor=Decimal(d.get("valor_dte", d["valor"])), porcentaje=d["porcentaje"])
                for d in caso.get("descuentos_globales", [])]
    t = calcular_totales(caso["tipo_dte"], items, globales)
    assert {"neto": t.neto, "exento": t.exento, "iva": t.iva, "total": t.total} == caso["esperado"]
