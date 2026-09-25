"""Modo del emisor (CERT, PROD, DEV): cada venta solo se ve en el modo en que se emitió.

Stock y caja no se separan: una venta de prueba descuenta stock y su efectivo
entra al cierre de caja igual que una real.
"""

import time

import pytest

from app.dependencies.tenant import get_current_tenant_user
from app.main import app
from app.models.customer import Customer
from app.models.issuer import Issuer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.sale import Sale


@pytest.fixture
def entorno(client, db_session):
    db_session.add(Issuer(rut="76123456-0", razon_social="Emisor", giro="Giro",
                          acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce"))
    db_session.add(Customer(rut="12345678-5", razon_social="Cliente", email="c@test.com"))
    db_session.add(PaymentMethod(code="EFECTIVO", name="Efectivo"))
    prod = Product(codigo_interno="M-1", nombre="Producto", precio_neto=1000,
                   controla_stock=True, stock_actual=10)
    db_session.add(prod)
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200
    time.sleep(1)  # SQLite guarda segundos: la venta tiene que quedar después de la apertura
    return prod


def _modo(modo):
    app.dependency_overrides[get_current_tenant_user]().tenant.sii_ambiente = modo


def _vender(client, prod):
    resp = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 33,
        "items": [{"product_id": prod.id, "cantidad": "1"}],
        "payments": [{"payment_method_id": 1, "amount": "1190"}],
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _ids(client):
    return [v["id"] for v in client.get("/sales/").json()]


def test_cada_modo_ve_solo_sus_ventas(client, db_session, entorno):
    cert = _vender(client, entorno)
    _modo("DEV")
    assert _ids(client) == []
    dev = _vender(client, entorno)
    assert _ids(client) == [dev]
    assert db_session.get(Sale, dev).modo == "DEV"
    assert client.get("/stats/summary").json()["daily"]["sales_count"] == 1

    # Reimprimir o devolver una venta de otro modo: no existe.
    assert client.get(f"/sales/{cert}/pdf").status_code == 404
    devolucion = client.post("/sales/return", json={
        "original_sale_id": cert, "tipo_dte": 61, "reason": "x", "return_method_id": 1,
        "items": [{"product_id": entorno.id, "cantidad": "1"}],
    })
    assert devolucion.status_code == 404

    _modo("CERT")
    assert _ids(client) == [cert]


def test_stock_y_caja_no_se_separan(client, db_session, entorno):
    _vender(client, entorno)
    _modo("DEV")
    _vender(client, entorno)
    db_session.refresh(entorno)
    assert entorno.stock_actual == 8
    cierre = client.post("/cash/close", json={"final_cash_declared": 2380})
    assert cierre.status_code == 200, cierre.text
    assert float(cierre.json()["difference"]) == 0
