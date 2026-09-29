"""NC que corrige texto (código de referencia 2, #45).

Para el SII corrige un dato escrito (giro, dirección) sin tocar montos: una
línea con la corrección y total 0. No mueve stock, ni caja, ni la deuda del
cliente, y no consume lo que queda por devolver de la venta.
"""

from decimal import Decimal

from app.models.customer import Customer
from app.models.payment import PaymentMethod, SalePayment
from app.models.product import Product
from app.models.sale import Sale


def _venta(client, db_session):
    db_session.add_all([
        Customer(rut="12345678-5", razon_social="Cliente", giro="Ferreteria", direccion="D", comuna="C"),
        PaymentMethod(code="EFECTIVO", name="Efectivo"),
        Product(codigo_interno="T-1", nombre="Saco", precio_neto=1000, controla_stock=True, stock_actual=10),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200
    venta = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 33,
        "items": [{"product_id": 1, "cantidad": "2"}],
        "payments": [{"payment_method_id": 1, "amount": "2380"}],
    })
    assert venta.status_code == 201, venta.text
    return venta.json()


def test_corrige_texto_sin_montos_ni_stock(client, db_session, fake_dte):
    venta = _venta(client, db_session)

    nc = client.post(f"/sales/{venta['id']}/corrige-texto", json={
        "donde_dice": "Giro: Ferreteria", "debe_decir": "Giro: Ferreteria y pinturas",
    })
    assert nc.status_code == 201, nc.text
    assert nc.json()["tipo_dte"] == 61
    assert Decimal(nc.json()["monto_total"]) == 0

    doc = fake_dte.documentos[-1]
    [ref] = doc["referencias"]
    assert (ref["tipo_doc"], ref["folio"], ref["codigo"]) == ("33", str(venta["folio"]), 2)
    [linea] = doc["items"]
    assert Decimal(linea["precio"]) == 0
    assert linea["descripcion"] == "Donde dice: Giro: Ferreteria. Debe decir: Giro: Ferreteria y pinturas."

    assert db_session.get(Product, 1).stock_actual == 8
    nc_id = nc.json()["id"]
    assert db_session.query(SalePayment).filter(SalePayment.sale_id == nc_id).count() == 0
    assert db_session.get(Sale, nc_id).related_sale_id == venta["id"]

    # No descuenta lo que queda por devolver.
    devolucion = client.post("/sales/return", json={
        "original_sale_id": venta["id"], "items": [{"product_id": 1, "cantidad": "2"}],
        "reason": "Devuelve todo", "return_method_id": 1,
    })
    assert devolucion.status_code == 201, devolucion.text


def test_la_devolucion_no_acepta_el_codigo_2(client, db_session):
    """Por /return el código 2 emitía una NC con montos y reingresaba stock."""
    venta = _venta(client, db_session)
    resp = client.post("/sales/return", json={
        "original_sale_id": venta["id"], "items": [{"product_id": 1, "cantidad": "1"}],
        "reason": "x", "return_method_id": 1, "sii_reason_code": 2,
    })
    assert resp.status_code == 422
    assert db_session.get(Product, 1).stock_actual == 8


def test_corrige_texto_pide_los_dos_textos(client, db_session):
    venta = _venta(client, db_session)
    resp = client.post(f"/sales/{venta['id']}/corrige-texto", json={"donde_dice": "  ", "debe_decir": "algo"})
    assert resp.status_code == 422
