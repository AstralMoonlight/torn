"""Volver a emitir un documento que el SII rechazó, sin repetir la venta (#62)."""

from decimal import Decimal

import pytest

from app.models.customer import Customer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.sale import Sale
from app.services import dte_client


@pytest.fixture
def pos(client, db_session):
    db_session.add_all([
        PaymentMethod(code="EFECTIVO", name="Efectivo"),
        Customer(rut="12345678-5", razon_social="Cliente", giro="Giro malo", direccion="D", comuna="C"),
        Product(codigo_interno="D-1", nombre="Saco", precio_neto=1000, controla_stock=True, stock_actual=10),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200


def _vender(client, tipo):
    resp = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": tipo,
        "items": [{"product_id": 1, "cantidad": "2", "descuento_pct": "10"}],
        "payments": [{"payment_method_id": 1, "amount": "5000"}],
        "descuento_global": {"valor": "5", "porcentaje": True},
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def _mismo(a, b):
    """Iguales salvo el formato de los decimales ("2" o "2.0000"): dte-torn los normaliza."""
    def norm(v):
        if isinstance(v, dict):
            return {k: norm(x) for k, x in v.items()}
        if isinstance(v, list):
            return [norm(x) for x in v]
        try:
            return Decimal(v).normalize() if isinstance(v, str) else v
        except ArithmeticError:
            return v
    return norm(a) == norm(b)


def _rechazar(db_session, sale_id):
    sale = db_session.get(Sale, sale_id)
    sale.dte_estado, sale.dte_glosa = "RECHAZADO", "Giro del receptor invalido"
    db_session.commit()


def test_factura_rechazada_sale_de_nuevo_con_los_datos_corregidos(client, db_session, pos, fake_dte):
    venta = _vender(client, 33)
    _rechazar(db_session, venta["id"])
    db_session.query(Customer).one().giro = "Giro bueno"  # se corrige en Clientes
    db_session.commit()

    resp = client.post(f"/sales/{venta['id']}/reemitir")
    assert resp.status_code == 200, resp.text
    nueva = resp.json()
    assert (nueva["folio"], nueva["dte_estado"], nueva["dte_glosa"]) == (2, "FIRMADO", None)
    assert nueva["monto_total"] == venta["monto_total"]

    primero, segundo = fake_dte.documentos
    assert segundo["external_id"] == f"venta-{venta['id']}-1"
    for campo in ("items", "descuentos_globales", "forma_pago", "tipo_dte"):
        assert _mismo(segundo[campo], primero[campo]), campo
    assert segundo["receptor"]["giro"] == "Giro bueno"
    # El stock salió una sola vez, con la venta.
    assert db_session.query(Product).one().stock_actual == 8
    assert db_session.get(Sale, venta["id"]).stock_movements[0].description == "DTE 33 folio 2"


def test_solo_se_reemite_un_rechazado(client, pos):
    venta = _vender(client, 39)
    resp = client.post(f"/sales/{venta['id']}/reemitir")
    assert resp.status_code == 409 and "rechazado" in resp.json()["detail"]


def test_si_dte_torn_falla_la_venta_queda_como_estaba(client, db_session, pos, fake_dte):
    venta = _vender(client, 39)
    _rechazar(db_session, venta["id"])
    fake_dte.error = dte_client.DteNoDisponible("no respondió")
    assert client.post(f"/sales/{venta['id']}/reemitir").status_code == 503
    sale = db_session.get(Sale, venta["id"])
    assert (sale.folio, sale.dte_estado, sale.dte_external_id) == (1, "RECHAZADO", None)


def test_el_refresco_y_el_xml_siguen_al_documento_nuevo(client, db_session, pos, monkeypatch):
    venta = _vender(client, 33)
    _rechazar(db_session, venta["id"])
    assert client.post(f"/sales/{venta['id']}/reemitir").status_code == 200

    rutas = []

    def request(method, path, tenant=None, actor=None, **kwargs):
        rutas.append(path)
        return type("R", (), {"json": lambda self: {"estado": "ACEPTADO", "intercambio_estado": None}})()

    monkeypatch.setattr(dte_client, "request", request)
    client.post("/sales/dte-estados")
    client.post(f"/sales/{venta['id']}/reenviar-xml", json={})
    assert rutas == [f"/documents/venta-{venta['id']}-1", f"/documents/venta-{venta['id']}-1/intercambio"]


def test_nota_de_credito_rechazada_repite_lo_devuelto(client, db_session, pos, fake_dte):
    venta = _vender(client, 33)
    nc = client.post("/sales/return", json={
        "original_sale_id": venta["id"], "items": [{"product_id": 1, "cantidad": "1"}],
        "reason": "Prueba", "return_method_id": 1,
    })
    assert nc.status_code == 201, nc.text
    _rechazar(db_session, nc.json()["id"])

    resp = client.post(f"/sales/{nc.json()['id']}/reemitir")
    assert resp.status_code == 200, resp.text
    primera, segunda = fake_dte.documentos[1:]
    for campo in ("items", "descuentos_globales", "referencias"):
        assert _mismo(segunda[campo], primera[campo]), campo
    assert Decimal(resp.json()["monto_total"]) == Decimal(nc.json()["monto_total"])
    assert db_session.query(Product).one().stock_actual == 9  # la NC reingresó 1, una sola vez
