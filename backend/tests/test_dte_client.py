"""Errores de dte-torn tal como llegan por HTTP."""

import httpx
import pytest

from app.routers.sales import _mensaje_emision
from app.services import dte_client


def test_el_422_de_validacion_llega_como_texto(monkeypatch):
    """FastAPI responde un 422 con una lista que trae el pedido entero en `input`:
    convertida con str() llegaba al POS como volcado técnico."""
    cuerpo = {"detail": [{
        "type": "value_error", "loc": ["body"],
        "msg": "Value error, El DTE 61 requiere del receptor: giro, direccion",
        "input": {"tipo_dte": 61, "items": [{"nombre": "Saco"}]}, "ctx": {"error": {}},
    }]}
    monkeypatch.setenv("TORN_DTE_URL", "http://dte")
    monkeypatch.setattr(httpx, "request", lambda *a, **k: httpx.Response(422, json=cuerpo))

    with pytest.raises(dte_client.DteError) as exc:
        dte_client.request("POST", "/documents")

    assert exc.value.detail == "El DTE 61 requiere del receptor: giro, direccion"
    assert "faltan datos del cliente: giro, dirección. Complételos" in _mensaje_emision(exc.value, 61)
