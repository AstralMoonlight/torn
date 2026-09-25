"""Tests de devoluciones y notas de crédito.

`create_return` no contrastaba las cantidades devueltas contra la venta original
-lo decía un comentario: _"Omitido por simplicidad, confiamos en operador"_-, de
modo que se podía devolver más de lo vendido o devolver la misma venta varias
veces. Cada devolución reingresa stock, emite una NC y abona la cuenta corriente
del cliente.
"""

from decimal import Decimal

import pytest

from app.models.customer import Customer
from app.models.issuer import Issuer
from app.models.payment import PaymentMethod
from app.models.product import Product


@pytest.fixture
def venta(client, db_session):
    """Una venta de 5 unidades, lista para devolver."""
    db_session.add(Issuer(
        rut="76123456-0", razon_social="Emisor", giro="Giro",
        acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce",
    ))
    db_session.add(Customer(rut="12345678-5", razon_social="Cliente", email="c@test.com"))
    db_session.add(PaymentMethod(code="EFECTIVO", name="Efectivo"))
    prod = Product(
        codigo_interno="D-1", nombre="Producto",
        precio_neto=1000, controla_stock=True, stock_actual=10,
    )
    db_session.add(prod)
    db_session.commit()

    assert client.post("/cash/open", json={"start_amount": 10000}).status_code == 200

    resp = client.post("/sales/", json={
        "rut_cliente": "12345678-5",
        "tipo_dte": 33,
        "items": [{"product_id": prod.id, "cantidad": "5"}],
        "payments": [{"payment_method_id": 1, "amount": "5950"}],
    })
    assert resp.status_code == 201, resp.text
    return {"sale_id": resp.json()["id"], "product": prod, "db": db_session}


def _devolver(client, sale_id, product_id, cantidad):
    return client.post("/sales/return", json={
        "original_sale_id": sale_id,
        "items": [{"product_id": product_id, "cantidad": str(cantidad)}],
        "reason": "Prueba",
        "return_method_id": 1,
    })


class TestValidacionDeDevoluciones:
    def test_devolucion_parcial_es_aceptada(self, client, venta, fake_dte):
        resp = _devolver(client, venta["sale_id"], venta["product"].id, 2)
        assert resp.status_code == 201, resp.text
        assert resp.json()["tipo_dte"] == 61
        # El manual de muestras exige imprimir el motivo (RazonRef).
        assert fake_dte.documentos[-1]["referencias"][0]["razon"] == "Prueba"

        venta["db"].refresh(venta["product"])
        assert venta["product"].stock_actual == 7  # 10 - 5 vendidas + 2 devueltas

    def test_devolucion_total_es_aceptada(self, client, venta):
        resp = _devolver(client, venta["sale_id"], venta["product"].id, 5)
        assert resp.status_code == 201, resp.text

        venta["db"].refresh(venta["product"])
        assert venta["product"].stock_actual == 10

    def test_rechaza_devolver_mas_de_lo_vendido(self, client, venta):
        resp = _devolver(client, venta["sale_id"], venta["product"].id, 6)
        assert resp.status_code == 409
        assert "disponible" in resp.json()["detail"]

        venta["db"].refresh(venta["product"])
        assert venta["product"].stock_actual == 5, "El stock no debe moverse"

    def test_rechaza_la_segunda_devolucion_total(self, client, venta):
        """Devolver la misma venta dos veces duplicaba stock y abonos."""
        assert _devolver(client, venta["sale_id"], venta["product"].id, 5).status_code == 201

        resp = _devolver(client, venta["sale_id"], venta["product"].id, 5)
        assert resp.status_code == 409

        venta["db"].refresh(venta["product"])
        assert venta["product"].stock_actual == 10, "No debe reingresar dos veces"

    def test_las_devoluciones_parciales_se_acumulan(self, client, venta):
        assert _devolver(client, venta["sale_id"], venta["product"].id, 3).status_code == 201
        assert _devolver(client, venta["sale_id"], venta["product"].id, 2).status_code == 201

        # Ya se devolvieron las 5; una más debe fallar.
        resp = _devolver(client, venta["sale_id"], venta["product"].id, 1)
        assert resp.status_code == 409

        venta["db"].refresh(venta["product"])
        assert venta["product"].stock_actual == 10

    def test_rechaza_un_producto_ajeno_a_la_venta(self, client, venta):
        db = venta["db"]
        otro = Product(
            codigo_interno="D-2", nombre="Otro",
            precio_neto=1000, controla_stock=True, stock_actual=4,
        )
        db.add(otro)
        db.commit()

        resp = _devolver(client, venta["sale_id"], otro.id, 1)
        assert resp.status_code == 409

        db.refresh(otro)
        assert otro.stock_actual == 4
