"""Guías de despacho (52) y su facturación.

La guía descuenta stock sin cobrar; la factura que la cobra toma sus líneas y
precios, la referencia con tipo 52 y no vuelve a mover stock.
"""

import pytest

from app.models.customer import Customer
from app.models.inventory import StockMovement
from app.models.issuer import Issuer
from app.models.payment import PaymentMethod
from app.models.product import Product


@pytest.fixture
def entorno(client, db_session):
    db_session.add(Issuer(rut="76123456-0", razon_social="Emisor", giro="Giro",
                          acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce"))
    db_session.add(Customer(rut="12345678-5", razon_social="Cliente", email="c@test.com"))
    db_session.add(Customer(rut="11111111-1", razon_social="Otro", email="o@test.com"))
    db_session.add(PaymentMethod(code="EFECTIVO", name="Efectivo"))
    db_session.add(PaymentMethod(code="TRANSFERENCIA", name="Transferencia"))
    prod = Product(codigo_interno="G-1", nombre="Producto", precio_neto=1000,
                   controla_stock=True, stock_actual=10)
    db_session.add(prod)
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200
    return {"db": db_session, "prod": prod}


def _guia(client, prod_id, cantidad=2, rut="12345678-5", ind_traslado=1, **extra):
    return client.post("/sales/", json={
        "rut_cliente": rut, "tipo_dte": 52, "ind_traslado": ind_traslado,
        "items": [{"product_id": prod_id, "cantidad": str(cantidad)}], "payments": [], **extra,
    })


def test_guia_descuenta_stock_sin_cobro(client, entorno, fake_dte):
    resp = _guia(client, entorno["prod"].id, tipo_despacho=2)
    assert resp.status_code == 201, resp.text
    assert resp.json()["ind_traslado"] == 1
    doc = fake_dte.documentos[-1]
    assert (doc["tipo_dte"], doc["ind_traslado"], doc["tipo_despacho"]) == (52, 1, 2)
    db = entorno["db"]
    db.refresh(entorno["prod"])
    assert entorno["prod"].stock_actual == 8
    assert db.query(StockMovement).one().motivo == "GUIA"


def test_guia_sin_tipo_de_traslado(client, entorno):
    resp = _guia(client, entorno["prod"].id, ind_traslado=None)
    assert resp.status_code == 400 and "tipo de traslado" in resp.text


def test_guia_no_se_cobra(client, entorno):
    resp = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 52, "ind_traslado": 1,
        "items": [{"product_id": entorno["prod"].id, "cantidad": "1"}],
        "payments": [{"payment_method_id": 1, "amount": "1190"}],
    })
    assert resp.status_code == 400 and "no se cobra" in resp.text


def test_traslado_interno_va_al_emisor_y_no_se_factura(client, entorno, fake_dte):
    assert _guia(client, entorno["prod"].id, ind_traslado=5).status_code == 201
    assert fake_dte.documentos[-1]["receptor"]["rut"] == "76123456-0"
    assert client.get("/sales/guias-pendientes").json() == []


def test_facturar_guias_cobra_sin_mover_stock(client, entorno, fake_dte):
    ids = [_guia(client, entorno["prod"].id, cantidad=c).json()["id"] for c in (2, 3)]
    assert [g["id"] for g in client.get("/sales/guias-pendientes").json()] == ids

    resp = client.post("/sales/facturar-guias", json={"guia_ids": ids, "tipo_dte": 33, "payment_method_id": 2})
    assert resp.status_code == 201, resp.text
    factura = resp.json()
    assert factura["monto_total"] == "5950.00"  # 5 x 1000 + IVA
    refs = fake_dte.documentos[-1]["referencias"]
    assert [(r["tipo_doc"], r["folio"]) for r in refs] == [("52", "1"), ("52", "2")]

    entorno["db"].refresh(entorno["prod"])
    assert entorno["prod"].stock_actual == 5  # solo las guías lo movieron
    assert client.get("/sales/guias-pendientes").json() == []

    otra = client.post("/sales/facturar-guias", json={"guia_ids": ids[:1], "tipo_dte": 33, "payment_method_id": 2})
    assert otra.status_code == 409


def test_facturar_en_efectivo_redondea(client, entorno):
    gid = _guia(client, entorno["prod"].id, cantidad=1).json()["id"]
    resp = client.post("/sales/facturar-guias", json={"guia_ids": [gid], "tipo_dte": 33, "payment_method_id": 1})
    assert resp.status_code == 201, resp.text
    assert resp.json()["ajuste_redondeo"] == "0.00"  # 1190 ya termina en 0


def test_no_mezcla_clientes(client, entorno):
    a = _guia(client, entorno["prod"].id).json()["id"]
    b = _guia(client, entorno["prod"].id, rut="11111111-1").json()["id"]
    resp = client.post("/sales/facturar-guias", json={"guia_ids": [a, b], "tipo_dte": 33, "payment_method_id": 2})
    assert resp.status_code == 400
