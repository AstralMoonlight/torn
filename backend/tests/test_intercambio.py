"""El XML al correo del cliente (intercambio): lo manda dte-torn; el backend
guarda su estado y deja reenviarlo."""

import httpx
import pytest

from app.models.customer import Customer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.sale import Sale
from app.services import dte_client


@pytest.fixture
def factura(client, db_session):
    db_session.add_all([
        Customer(rut="12345678-5", razon_social="Cliente", giro="G", direccion="D", comuna="C", email="c@cliente.cl"),
        PaymentMethod(code="EFECTIVO", name="Efectivo"),
        Product(codigo_interno="X-1", nombre="Saco", precio_neto=1000),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200
    venta = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 33,
        "items": [{"product_id": 1, "cantidad": "1"}],
        "payments": [{"payment_method_id": 1, "amount": "1190"}],
    })
    assert venta.status_code == 201, venta.text
    return venta.json()["id"]


class DteFalso:
    def __init__(self, respuesta: dict | None = None, error=None):
        self.pedidos, self.respuesta, self.error = [], respuesta, error

    def __call__(self, method, path, tenant=None, **kw):
        self.pedidos.append((method, path, kw.get("json")))
        if self.error:
            raise self.error
        return httpx.Response(200, json=self.respuesta)


def test_reenviar_xml_guarda_el_estado(client, db_session, factura, monkeypatch):
    dte = DteFalso({"estado": "ACEPTADO", "intercambio_estado": "PENDIENTE"})
    monkeypatch.setattr(dte_client, "request", dte)

    r = client.post(f"/sales/{factura}/reenviar-xml", json={"correo": "otro@cliente.cl"})
    assert r.status_code == 200, r.text
    assert r.json()["intercambio_estado"] == "PENDIENTE"
    assert dte.pedidos == [("POST", f"/documents/venta-{factura}/intercambio", {"correo": "otro@cliente.cl"})]

    # Sin correo: el de la ficha, que dte-torn ya tiene en el documento.
    client.post(f"/sales/{factura}/reenviar-xml", json={})
    assert dte.pedidos[-1][2] == {}


def test_reenviar_explica_el_rechazo_de_dte_torn(client, factura, monkeypatch):
    monkeypatch.setattr(dte_client, "request", DteFalso(error=dte_client.DteError(
        409, "El documento está ENVIADO: se envía cuando el SII lo acepta")))
    r = client.post(f"/sales/{factura}/reenviar-xml", json={})
    assert r.status_code == 409 and "cuando el SII lo acepta" in r.json()["detail"]


def test_correo_invalido(client, factura):
    assert client.post(f"/sales/{factura}/reenviar-xml", json={"correo": "malo"}).status_code == 422


def test_el_refresco_sigue_el_intercambio_pendiente(client, db_session, factura, monkeypatch):
    """Aceptada, la venta ya no se refrescaba: el envío del XML nunca se veía."""
    sale = db_session.get(Sale, factura)
    sale.dte_estado, sale.intercambio_estado = "ACEPTADO", "PENDIENTE"
    db_session.commit()
    monkeypatch.setattr(dte_client, "request", DteFalso({"estado": "ACEPTADO", "intercambio_estado": "ENVIADO"}))

    r = client.post("/sales/dte-estados")
    assert r.json() == {"pendientes": 1, "cambiadas": 1}
    db_session.refresh(sale)
    assert sale.intercambio_estado == "ENVIADO"
