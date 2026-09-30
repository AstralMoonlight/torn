"""Documentos de proveedores: el backend es proxy de dte-torn y agrega la compra,
el proveedor y los productos que calzan con cada línea."""

import httpx
import pytest

from app.dependencies.tenant import get_current_tenant_user
from app.main import app
from app.models.customer import Customer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.provider import Provider
from app.models.sale import Sale
from app.services import dte_client

DOC_ID = "5a1f6c3e-2b7d-4c8e-9f01-23456789abcd"
DOCUMENTO = {
    "id": DOC_ID, "tipo_dte": 33, "folio": 7, "rut_emisor": "76111111-6",
    "razon_social_emisor": "Mayorista del Sur SpA", "fecha_emision": "2026-09-28",
    "monto_neto": 35000, "monto_exento": 0, "monto_iva": 6650, "monto_total": 41650,
    "firma_valida": True, "origen": "CORREO", "estado_registro": None,
    "detalle": {
        "emisor": {"RznSoc": "Mayorista del Sur SpA", "GiroEmis": "Venta al por mayor",
                   "DirOrigen": "Calle Falsa 123", "CmnaOrigen": "Concepcion", "CorreoEmisor": "ventas@mayorista.cl"},
        "lineas": [
            {"nombre": "Resma carta", "codigo": "RES-1", "cantidad": "10", "unidad": "", "precio": "3000",
             "monto": "30000", "exento": False},
            {"nombre": "corchetera", "codigo": "", "cantidad": "", "unidad": "", "precio": "5000",
             "monto": "5000", "exento": False},
            {"nombre": "Algo que no vendemos", "codigo": "Z-9", "cantidad": "2", "unidad": "", "precio": "",
             "monto": "999", "exento": False},
        ],
    },
}


class DteFalso:
    def __init__(self):
        self.pedidos = []

    def __call__(self, method, path, tenant=None, actor=None, **kw):
        self.pedidos.append((method, path, actor, kw.get("params"), kw.get("json")))
        if path == "/recibidos":
            if method == "POST":
                return httpx.Response(201, json={"envio": {"estado": 0}, "documentos": [DOCUMENTO], "nuevo": True})
            return httpx.Response(200, json=[DOCUMENTO])
        if path.endswith("/accion"):
            return httpx.Response(200, json={**DOCUMENTO, "estado_registro": "ACEPTADO", "accion": kw["json"]["accion"]})
        if path.endswith("/xml"):
            return httpx.Response(200, content=b"<DTE/>", headers={"content-disposition": 'inline; filename="x.xml"'})
        return httpx.Response(200, json=DOCUMENTO)


@pytest.fixture
def dte(monkeypatch):
    falso = DteFalso()
    monkeypatch.setattr(dte_client, "request", falso)
    return falso


def test_el_detalle_trae_proveedor_productos_y_costos(client, db_session, dte):
    db_session.add_all([
        Product(codigo_interno="RES-1", nombre="Resma carta 500 hojas", precio_neto=4000),
        Product(codigo_interno="COR-1", nombre="Corchetera", precio_neto=7000),
    ])
    db_session.commit()

    doc = client.get(f"/recibidos/{DOC_ID}").json()

    assert doc["provider_id"] is None and doc["compra_id"] is None
    resma, corchetera, otro = doc["lineas"]
    assert (resma["product_id"], resma["costo_unitario"]) == (1, "3000.00")  # por código
    assert (corchetera["product_id"], corchetera["cantidad"]) == (2, "1")  # por nombre; sin cantidad es 1
    assert otro["product_id"] is None and otro["costo_unitario"] == "499.50"


def test_el_proveedor_se_crea_con_los_datos_del_documento(client, db_session, dte):
    r = client.post(f"/recibidos/{DOC_ID}/proveedor")
    assert r.status_code == 200, r.text
    assert r.json()["rut"] == "76111111-6" and r.json()["direccion"] == "Calle Falsa 123, Concepcion"
    # La segunda vez es el mismo.
    assert client.post(f"/recibidos/{DOC_ID}/proveedor").json()["id"] == r.json()["id"]
    assert db_session.query(Provider).count() == 1


def test_la_factura_se_ingresa_una_sola_vez(client, db_session, dte):
    db_session.add_all([Provider(rut="76111111-6", razon_social="Mayorista del Sur SpA"),
                        Product(codigo_interno="RES-1", nombre="Resma", precio_neto=4000)])
    db_session.commit()
    compra = {"provider_id": 1, "folio": "7", "tipo_documento": "FACTURA", "dte_recibido_id": DOC_ID,
              "items": [{"product_id": 1, "cantidad": "10", "precio_costo_unitario": "3000"}]}

    primera = client.post("/purchases/", json=compra)
    assert primera.status_code == 201, primera.text
    otra = client.post("/purchases/", json=compra)
    assert otra.status_code == 409 and "ya está ingresada" in otra.json()["detail"]

    lista = client.get("/recibidos").json()
    assert lista[0]["compra_id"] == primera.json()["id"]


def test_aceptar_lleva_quien_lo_hizo(client, dte):
    r = client.post(f"/recibidos/{DOC_ID}/accion", json={"accion": "ACD"})
    assert r.status_code == 200 and r.json()["estado_registro"] == "ACEPTADO"
    metodo, ruta, actor, _, cuerpo = dte.pedidos[-1]
    assert (metodo, ruta, cuerpo) == ("POST", f"/recibidos/{DOC_ID}/accion", {"accion": "ACD"})
    assert actor  # el correo de quien aceptó, para la auditoría de dte-torn


def test_cargar_un_xml(client, dte):
    r = client.post("/recibidos", files={"file": ("DTE_7.xml", b"<EnvioDTE/>", "application/xml")})
    assert r.status_code == 201, r.text
    assert r.json()["documentos"][0]["compra_id"] is None


def test_la_lista_pasa_los_filtros(client, dte):
    client.get("/recibidos", params={"sin_responder": True, "q": "mayorista"})
    assert dte.pedidos[-1][3] == {"q": "mayorista", "sin_responder": True, "limit": 50}


def test_sin_compras_no_entra(client, dte):
    app.dependency_overrides[get_current_tenant_user]().role_name = "VENDEDOR"
    assert client.get("/recibidos").status_code == 403
    assert client.post(f"/recibidos/{DOC_ID}/accion", json={"accion": "ACD"}).status_code == 403


def test_el_refresco_trae_el_reclamo_del_cliente(client, db_session, monkeypatch):
    db_session.add_all([
        Customer(rut="12345678-5", razon_social="Cliente", giro="G", direccion="D", comuna="C"),
        PaymentMethod(code="EFECTIVO", name="Efectivo"),
        Product(codigo_interno="X-1", nombre="Saco", precio_neto=1000),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200
    venta = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 33, "items": [{"product_id": 1, "cantidad": "1"}],
        "payments": [{"payment_method_id": 1, "amount": "1190"}],
    }).json()["id"]
    sale = db_session.get(Sale, venta)
    sale.dte_estado = "ACEPTADO"
    db_session.commit()
    monkeypatch.setattr(dte_client, "request", lambda *a, **k: httpx.Response(
        200, json={"estado": "ACEPTADO", "estado_receptor": "RECLAMADO"}))

    assert client.post("/sales/dte-estados").json() == {"pendientes": 1, "cambiadas": 1}
    db_session.refresh(sale)
    assert sale.estado_receptor == "RECLAMADO"
    assert client.get("/sales/").json()[0]["estado_receptor"] == "RECLAMADO"
    # Reclamada, ya no se sigue consultando.
    assert client.post("/sales/dte-estados").json()["pendientes"] == 0
