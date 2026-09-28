"""La utilidad de una venta pasada no cambia cuando cambia el costo del producto.

`stats.py` restaba `Product.costo_unitario`, el costo de hoy: una compra nueva
reescribía la utilidad del mes pasado. Ahora cada línea guarda su costo.
"""

from decimal import Decimal

from app.models.customer import Customer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.sale import SaleDetail


def test_cambiar_el_costo_no_cambia_la_utilidad(client, db_session):
    db_session.add_all([
        Customer(rut="12345678-5", razon_social="Cliente", giro="G", direccion="D", comuna="C"),
        PaymentMethod(code="EFECTIVO", name="Efectivo"),
        Product(codigo_interno="C-1", nombre="Saco", precio_neto=1000, costo_unitario=600),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200
    venta = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 33,
        "items": [{"product_id": 1, "cantidad": "2"}],
        "payments": [{"payment_method_id": 1, "amount": "2380"}],
    })
    assert venta.status_code == 201, venta.text
    assert db_session.query(SaleDetail).one().costo_unitario == 600

    antes = client.get("/stats/report").json()["total_utilidad"]
    assert client.put("/products/1", json={"costo_unitario": "900"}).status_code == 200
    despues = client.get("/stats/report").json()["total_utilidad"]

    assert Decimal(antes) == Decimal(despues) == 800  # 2 x (1.000 - 600)
