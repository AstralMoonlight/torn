"""/folios reenvía a dte-torn y adapta la respuesta al formato que usa el POS."""

import httpx

from app.services import dte_client


def _caf(desde, hasta, disponibles, estado="ACTIVO", vence="2027-01-01"):
    return {"folio_desde": desde, "folio_hasta": hasta, "disponibles": disponibles,
            "estado": estado, "fecha_vencimiento": vence}


def test_status_suma_los_caf_activos_por_tipo(client, monkeypatch):
    stock = [{"tipo_dte": 33, "disponibles": 12, "cafs": [
        _caf(1, 10, 0, estado="AGOTADO"),
        _caf(11, 20, 2, vence="2026-12-01"),
        _caf(900, 909, 10, vence="2027-03-01"),
    ]}]
    llamadas = []

    def fake_request(method, path, tenant_id=None, actor=None, **kwargs):
        llamadas.append((method, path, tenant_id))
        return httpx.Response(200, json=stock)

    monkeypatch.setattr(dte_client, "request", fake_request)
    resp = client.get("/folios/status")
    assert resp.status_code == 200, resp.text
    assert llamadas == [("GET", "/folios", 1)]

    por_tipo = {f["dte_type"]: f for f in resp.json()}
    assert set(por_tipo) == {33, 34, 39, 41, 56, 61}
    assert por_tipo[33] == {
        "dte_type": 33, "available": 12, "total": 20,
        "latest_folio_desde": 900, "latest_folio_hasta": 909,
        "fecha_vencimiento": "2026-12-01",  # el que se consume a continuación
    }
    assert por_tipo[39]["available"] == 0


def test_dte_torn_caido_responde_503(client, monkeypatch):
    def caido(*args, **kwargs):
        raise dte_client.DteNoDisponible("no respondió")

    monkeypatch.setattr(dte_client, "request", caido)
    assert client.get("/folios/status").status_code == 503
