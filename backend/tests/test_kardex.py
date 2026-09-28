"""Kardex: el stock actual es siempre la suma de sus movimientos.

Antes editar un producto escribía `stock_actual` sin anotar nada, el stock con
que nacía un producto no tenía movimiento INICIAL y las ventas y devoluciones
no guardaban el saldo (`balance_after`).
"""

from decimal import Decimal

import pytest

from app.models.customer import Customer
from app.models.inventory import StockMovement
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.provider import Provider


def _cuadra(db, product_id):
    """Recorre el kardex en orden: cada saldo es el corrido y el último es el stock."""
    saldo = Decimal(0)
    movimientos = db.query(StockMovement).filter_by(product_id=product_id).order_by(StockMovement.id).all()
    for m in movimientos:
        saldo += m.cantidad if m.tipo == "ENTRADA" else -m.cantidad
        assert m.balance_after == saldo, (m.motivo, m.balance_after, saldo)
    assert db.get(Product, product_id).stock_actual == saldo
    return [m.motivo for m in movimientos]


@pytest.fixture
def producto(client, db_session):
    resp = client.post("/products/", json={
        "nombre": "Tornillo", "precio_neto": "1000", "controla_stock": True, "stock_actual": "10",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_venta_devolucion_y_compras_cuadran(client, db_session, producto):
    db_session.add_all([
        Customer(rut="12345678-5", razon_social="Cliente", giro="G", direccion="D", comuna="C"),
        PaymentMethod(code="EFECTIVO", name="Efectivo"),
        Provider(rut="76123456-0", razon_social="Proveedor"),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200

    venta = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 33,
        "items": [{"product_id": producto, "cantidad": "4"}],
        "payments": [{"payment_method_id": 1, "amount": "4760"}],
    })
    assert venta.status_code == 201, venta.text
    assert client.post("/sales/return", json={
        "original_sale_id": venta.json()["id"], "items": [{"product_id": producto, "cantidad": "1"}],
        "reason": "Falla", "return_method_id": 1,
    }).status_code == 201
    compra = client.post("/purchases/", json={
        "provider_id": 1, "folio": "9",
        "items": [{"product_id": producto, "cantidad": "5", "precio_costo_unitario": "500"}],
    })
    assert compra.status_code == 201, compra.text
    assert client.delete(f"/purchases/{compra.json()['id']}").status_code == 204

    assert _cuadra(db_session, producto) == ["INICIAL", "VENTA", "DEVOLUCION", "COMPRA", "AJUSTE"]
    assert db_session.get(Product, producto).stock_actual == 7  # 10 - 4 + 1 + 5 - 5
    venta_mov = db_session.query(StockMovement).filter_by(motivo="VENTA").one()
    assert venta_mov.sale_id == venta.json()["id"]
    assert venta_mov.description == f"DTE 33 folio {venta.json()['folio']}"


def test_editar_producto_no_toca_el_stock(client, producto):
    resp = client.put(f"/products/{producto}", json={"stock_actual": "99"})
    assert resp.status_code == 422
    assert client.put(f"/products/{producto}", json={"nombre": "Tornillo 2"}).status_code == 200


@pytest.mark.parametrize("contadas, esperado", [("7", ["INICIAL", "CONTEO"]), ("12", ["INICIAL", "CONTEO"])])
def test_ajuste_anota_la_diferencia(client, db_session, producto, contadas, esperado):
    resp = client.post(f"/products/{producto}/ajuste-stock",
                       json={"cantidad_contada": contadas, "motivo": "CONTEO", "nota": "Toma de inventario"})
    assert resp.status_code == 200, resp.text
    assert Decimal(resp.json()["stock_actual"]) == Decimal(contadas)
    assert _cuadra(db_session, producto) == esperado

    kardex = client.get(f"/products/{producto}/movimientos").json()
    assert kardex[0]["motivo"] == "CONTEO" and kardex[0]["description"] == "Toma de inventario"
    assert Decimal(kardex[0]["cantidad"]) == abs(Decimal(contadas) - 10)


def test_ajuste_sin_diferencia_no_anota(client, db_session, producto):
    resp = client.post(f"/products/{producto}/ajuste-stock", json={"cantidad_contada": "10", "motivo": "CONTEO"})
    assert resp.status_code == 200
    assert _cuadra(db_session, producto) == ["INICIAL"]


def test_ajuste_de_producto_sin_control_de_stock(client):
    pid = client.post("/products/", json={"nombre": "Servicio", "precio_neto": "1000"}).json()["id"]
    resp = client.post(f"/products/{pid}/ajuste-stock", json={"cantidad_contada": "3", "motivo": "CONTEO"})
    assert resp.status_code == 400


def test_variantes_nacen_con_movimiento_inicial(client, db_session):
    resp = client.post("/products/with-variants", json={
        "nombre": "Polera", "controla_stock": True,
        "variants": [{"nombre": "M", "precio_neto": "5000", "stock_actual": "3"},
                     {"nombre": "L", "precio_neto": "5000"}],
    })
    assert resp.status_code == 201, resp.text
    m, l = resp.json()["variants"]
    assert _cuadra(db_session, m["id"]) == ["INICIAL"]
    assert _cuadra(db_session, l["id"]) == []
