"""Forma de pago de la factura: fiada (crédito interno) va como crédito (FmaPago 2)."""

import pytest

from app.models.customer import Customer
from app.models.payment import PaymentMethod
from app.models.product import Product

EFECTIVO, CREDITO = 1, 2


@pytest.fixture
def pos(client, db_session):
    db_session.add_all([
        PaymentMethod(id=EFECTIVO, code="EFECTIVO", name="Efectivo"),
        PaymentMethod(id=CREDITO, code="CREDITO_INTERNO", name="Crédito interno"),
        Customer(rut="12345678-5", razon_social="Cliente", giro="G", direccion="D", comuna="C"),
        Product(codigo_interno="F-1", nombre="Saco", precio_neto=1000),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200


def _vender(client, tipo, pagos):
    resp = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": tipo, "items": [{"product_id": 1, "cantidad": "1"}],
        "payments": [{"payment_method_id": m, "amount": a} for m, a in pagos],
    })
    assert resp.status_code == 201, resp.text


@pytest.mark.parametrize("pagos, forma", [
    ([(EFECTIVO, "1190")], 1),
    ([(CREDITO, "1190")], 2),
    ([(EFECTIVO, "500"), (CREDITO, "690")], 2),  # con parte fiada, crédito
])
def test_factura_lleva_forma_de_pago(client, pos, fake_dte, pagos, forma):
    _vender(client, 33, pagos)
    assert fake_dte.documentos[-1]["forma_pago"] == forma


def test_boleta_no_lleva_forma_de_pago(client, pos, fake_dte):
    _vender(client, 39, [(CREDITO, "1190")])
    assert "forma_pago" not in fake_dte.documentos[-1]
