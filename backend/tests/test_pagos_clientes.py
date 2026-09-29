"""Pagos de deuda de crédito interno.

La deuda (`current_balance`) subía con cada venta fiada y solo bajaba con una
NC: no había cómo anotar que el cliente pagó.
"""

from decimal import Decimal

import pytest

from app.models.customer import Customer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.settings import SystemSettings

EFECTIVO, CREDITO, TRANSFERENCIA = 1, 2, 3


@pytest.fixture
def fiado(client, db_session):
    """Caja abierta con 10.000 y una venta fiada de $11.900 al cliente."""
    db_session.add_all([
        PaymentMethod(id=EFECTIVO, code="EFECTIVO", name="Efectivo"),
        PaymentMethod(id=CREDITO, code="CREDITO_INTERNO", name="Crédito interno"),
        PaymentMethod(id=TRANSFERENCIA, code="TRANSFERENCIA", name="Transferencia"),
        Customer(rut="12345678-5", razon_social="Don Pedro", giro="G", direccion="D", comuna="C", dias_credito=30),
        Product(codigo_interno="P-1", nombre="Saco", precio_neto=10000),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 10000}).status_code == 200
    venta = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 33,
        "items": [{"product_id": 1, "cantidad": "1"}],
        "payments": [{"payment_method_id": CREDITO, "amount": "11900"}],
    })
    assert venta.status_code == 201, venta.text


def _pagar(client, monto, medio=EFECTIVO, nota=None):
    return client.post("/customers/12345678-5/pagos",
                       json={"amount": str(monto), "payment_method_id": medio, "nota": nota})


def test_pago_baja_la_deuda_y_entra_al_cierre(client, fiado):
    resp = _pagar(client, 5000, nota="Abono")
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["current_balance"]) == 6900

    cierre = client.post("/cash/close", json={"final_cash_declared": 15000})
    assert cierre.status_code == 200
    assert Decimal(cierre.json()["final_cash_system"]) == 15000  # 10.000 + 5.000 del pago
    assert Decimal(cierre.json()["difference"]) == 0


def test_pago_por_transferencia_no_entra_a_la_caja(client, fiado):
    assert _pagar(client, 11900, TRANSFERENCIA).status_code == 201
    cierre = client.post("/cash/close", json={"final_cash_declared": 10000})
    assert Decimal(cierre.json()["final_cash_system"]) == 10000


def test_no_se_paga_mas_que_la_deuda(client, fiado):
    resp = _pagar(client, 12000)
    assert resp.status_code == 400
    assert "supera la deuda" in resp.json()["detail"]


def test_no_se_paga_con_credito_interno(client, fiado):
    assert _pagar(client, 1000, CREDITO).status_code == 400


def test_efectivo_sin_caja_abierta(client, fiado, db_session):
    assert client.post("/cash/close", json={"final_cash_declared": 10000}).status_code == 200
    assert _pagar(client, 1000).status_code == 409
    assert _pagar(client, 1000, TRANSFERENCIA).status_code == 201

    # Sin control de caja, el efectivo no necesita turno.
    db_session.add(SystemSettings(control_caja=False))
    db_session.commit()
    assert _pagar(client, 1000).status_code == 201


def test_cuenta_muestra_ventas_y_pagos(client, fiado):
    _pagar(client, 5000, nota="Abono")
    cuenta = client.get("/customers/12345678-5/cuenta").json()
    assert Decimal(cuenta["saldo"]) == 6900
    tipos = sorted((m["tipo"], Decimal(m["cargo"]), Decimal(m["abono"])) for m in cuenta["movimientos"])
    assert tipos == [("PAGO", 0, 5000), ("VENTA", 11900, 0)]
    pago = next(m for m in cuenta["movimientos"] if m["tipo"] == "PAGO")
    assert pago["detalle"] == "Pago Efectivo: Abono"
