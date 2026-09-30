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

    def fake_request(method, path, tenant=None, actor=None, **kwargs):
        llamadas.append((method, path, tenant.id))
        return httpx.Response(200, json=stock)

    monkeypatch.setattr(dte_client, "request", fake_request)
    resp = client.get("/folios/status")
    assert resp.status_code == 200, resp.text
    assert llamadas == [("GET", "/folios", 1)]

    por_tipo = {f["dte_type"]: f for f in resp.json()}
    assert set(por_tipo) == {33, 34, 39, 41, 52, 56, 61}
    assert por_tipo[33] == {
        "dte_type": 33, "available": 12, "total": 20,
        "latest_folio_desde": 900, "latest_folio_hasta": 909,
        "fecha_vencimiento": "2026-12-01",  # el que se consume a continuación
        "alerta": False,
    }
    assert por_tipo[39]["available"] == 0


def test_alerta_de_pocos_folios(client, monkeypatch):
    stock = [
        {"tipo_dte": 39, "disponibles": 99, "umbral_alerta": 100, "cafs": [_caf(1, 200, 99)]},
        {"tipo_dte": 33, "disponibles": 100, "umbral_alerta": 100, "cafs": [_caf(1, 100, 100)]},
        {"tipo_dte": 61, "disponibles": 0, "umbral_alerta": 100, "cafs": [_caf(1, 10, 0, estado="AGOTADO")]},
    ]
    monkeypatch.setattr(dte_client, "request", lambda *a, **k: httpx.Response(200, json=stock))

    alertas = {f["dte_type"] for f in client.get("/folios/status").json() if f["alerta"]}
    # 52 nunca tuvo CAF: no se emite, no alerta. 61 se agotó: sí.
    assert alertas == {39, 61}


def test_en_desarrollador_no_alerta(client, monkeypatch):
    from app.dependencies.tenant import get_current_tenant_user
    from app.main import app

    stock = [{"tipo_dte": 39, "disponibles": 5, "umbral_alerta": 100, "cafs": [_caf(1, 5, 5)]}]
    monkeypatch.setattr(dte_client, "request", lambda *a, **k: httpx.Response(200, json=stock))
    tenant_user = app.dependency_overrides[get_current_tenant_user]()
    monkeypatch.setattr(tenant_user.tenant, "sii_ambiente", "DEV")

    assert not any(f["alerta"] for f in client.get("/folios/status").json())


def test_en_desarrollador_nunca_se_agota(client, monkeypatch):
    """El CAF de prueba nace con la primera emisión: sin él, igual se puede emitir."""
    from app.dependencies.tenant import get_current_tenant_user
    from app.main import app

    stock = [{"tipo_dte": 39, "disponibles": 7, "cafs": [_caf(1, 10, 7)]}]
    monkeypatch.setattr(dte_client, "request", lambda *a, **k: httpx.Response(200, json=stock))
    tenant_user = app.dependency_overrides[get_current_tenant_user]()
    monkeypatch.setattr(tenant_user.tenant, "sii_ambiente", "DEV")

    por_tipo = {f["dte_type"]: f["available"] for f in client.get("/folios/status").json()}
    assert por_tipo[39] == 7 and por_tipo[61] == 100_000


def test_dte_torn_caido_responde_503(client, monkeypatch):
    def caido(*args, **kwargs):
        raise dte_client.DteNoDisponible("no respondió")

    monkeypatch.setattr(dte_client, "request", caido)
    assert client.get("/folios/status").status_code == 503


def test_folios_por_anular(client, monkeypatch):
    doc = {"id": "5f0c3a52-7a8e-4c55-9d0e-6c1b2a3d4e5f", "external_id": "venta-7", "tipo_dte": 33, "folio": 12,
           "fecha_emision": "2026-09-29", "receptor_razon_social": "Cliente", "monto_total": 1190,
           "glosa_sii": "Giro invalido", "folio_nuevo": 30, "caf_folio_desde": 1, "caf_folio_hasta": 20}
    llamadas = []

    def fake_request(method, path, tenant=None, actor=None, **kwargs):
        llamadas.append((method, path))
        return httpx.Response(200, json=[doc]) if method == "GET" else httpx.Response(204)

    monkeypatch.setattr(dte_client, "request", fake_request)
    [pendiente] = client.get("/folios/por-anular").json()
    assert (pendiente["folio"], pendiente["folio_nuevo"], pendiente["glosa_sii"]) == (12, 30, "Giro invalido")
    assert client.post(f"/folios/por-anular/{doc['id']}/anulado").status_code == 204
    assert llamadas == [("GET", "/folios/por-anular"), ("POST", f"/folios/por-anular/{doc['id']}/anulado")]
