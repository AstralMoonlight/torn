"""Descuentos por línea y al total (#41, #42), la NC que los devuelve y el tope del personal (#40)."""

from decimal import Decimal

import pytest

from app.dependencies.tenant import get_current_tenant_user
from app.main import app
from app.models.customer import Customer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.sale import Sale


@pytest.fixture
def pos(client, db_session):
    db_session.add_all([
        PaymentMethod(code="EFECTIVO", name="Efectivo"),
        Customer(rut="12345678-5", razon_social="Cliente", giro="G", direccion="D", comuna="C"),
        Product(codigo_interno="D-1", nombre="Saco", precio_neto=1000),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200


def _vender(client, tipo, item, descuento_global=None):
    return client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": tipo,
        "items": [{"product_id": 1, "cantidad": "2", **item}],
        "payments": [{"payment_method_id": 1, "amount": "5000"}],
        "descuento_global": descuento_global,
    })


def _como_vendedor():
    app.dependency_overrides[get_current_tenant_user]().role_name = "VENDEDOR"


def test_factura_con_porcentaje_por_linea_y_al_total(client, pos, fake_dte):
    resp = _vender(client, 33, {"descuento_pct": "10"}, {"valor": "10", "porcentaje": True})
    assert resp.status_code == 201, resp.text
    # 2.000 - 10% = 1.800; -10% = 1.620; IVA 307,8 -> 308
    assert Decimal(resp.json()["monto_total"]) == 1928
    doc = fake_dte.documentos[-1]
    assert doc["items"][0]["descuento_pct"] == "10" and doc["items"][0]["descuento"] == 0
    assert doc["descuentos_globales"] == [{"valor": "10", "porcentaje": True, "exento": False, "glosa": "Descuento"}]


def test_boleta_con_descuento_al_total_en_pesos(client, pos, fake_dte):
    """El POS manda pesos netos: en la boleta van brutos (420,17 x 1,19 = 500)."""
    resp = _vender(client, 39, {}, {"valor": "420.17", "porcentaje": False})
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["monto_total"]) == 1880  # 2.380 - 500
    assert fake_dte.documentos[-1]["descuentos_globales"][0]["valor"] == "500"


def test_el_descuento_al_total_no_puede_superar_la_venta(client, pos):
    resp = _vender(client, 33, {}, {"valor": "2500", "porcentaje": False})
    assert resp.status_code == 400
    assert "supera" in resp.json()["detail"]


@pytest.mark.parametrize("cantidad, total_nc", [("2", 1821), ("1", 910)])
def test_la_nc_devuelve_lo_cobrado(client, pos, db_session, cantidad, total_nc):
    """Venta: 2.000 - 300 por línea - 170 al total = 1.530 + IVA = 1.821. La NC
    reparte ambos descuentos: devolver una unidad es 850 - 85 = 765 + IVA = 910."""
    venta = _vender(client, 33, {"descuento": "300"}, {"valor": "170", "porcentaje": False})
    assert venta.status_code == 201, venta.text
    assert Decimal(venta.json()["monto_total"]) == 1821
    nc = client.post("/sales/return", json={
        "original_sale_id": venta.json()["id"],
        "items": [{"product_id": 1, "cantidad": cantidad}],
        "reason": "Prueba", "return_method_id": 1,
    })
    assert nc.status_code == 201, nc.text
    assert Decimal(nc.json()["monto_total"]) == total_nc


def test_la_nc_repite_el_porcentaje(client, pos, fake_dte):
    venta = _vender(client, 39, {"descuento_pct": "25"}, {"valor": "10", "porcentaje": True})
    assert venta.status_code == 201, venta.text
    nc = client.post("/sales/return", json={
        "original_sale_id": venta.json()["id"],
        "items": [{"product_id": 1, "cantidad": "2"}],
        "reason": "Prueba", "return_method_id": 1,
    })
    assert nc.status_code == 201, nc.text
    doc = fake_dte.documentos[-1]
    assert doc["items"][0]["descuento_pct"] == "25.00"
    assert doc["descuentos_globales"][0]["valor"] == "10.00"


def test_el_personal_descuenta_hasta_el_tope(client, pos):
    _como_vendedor()
    assert _vender(client, 39, {"descuento_pct": "10"}).status_code == 201  # tope por defecto: 10%
    resp = _vender(client, 39, {"descuento_pct": "15"})
    assert resp.status_code == 403
    assert "10%" in resp.json()["detail"]


def test_con_tope_cero_solo_descuenta_el_administrador(client, pos, db_session):
    assert client.put("/config/settings/", json={"descuento_maximo": 0}).status_code == 200
    assert _vender(client, 39, {"descuento_pct": "50"}).status_code == 201  # administrador: sin tope
    _como_vendedor()
    resp = _vender(client, 39, {}, {"valor": "1", "porcentaje": True})
    assert resp.status_code == 403
    assert "Solo el administrador" in resp.json()["detail"]
    assert _vender(client, 39, {}).status_code == 201  # sin descuento, vende igual


def test_la_guia_no_lleva_descuento_al_total(client, pos):
    resp = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 52, "ind_traslado": 1,
        "items": [{"product_id": 1, "cantidad": "1"}], "payments": [],
        "descuento_global": {"valor": "10", "porcentaje": True},
    })
    assert resp.status_code == 400
