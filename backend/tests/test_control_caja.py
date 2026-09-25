"""Control de caja por empresa: con el control apagado se vende sin turno."""

from app.dependencies.tenant import get_current_tenant_user
from app.main import app
from app.models.customer import Customer
from app.models.issuer import Issuer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.saas import TenantUser


def _venta(db_session):
    db_session.add(Issuer(rut="76123456-K", razon_social="Emisor", giro="Giro", acteco="123",
                          direccion="Dir", comuna="Conce", ciudad="Conce"))
    db_session.add(Customer(rut="12345678-5", razon_social="Cliente"))
    prod = Product(codigo_interno="CC-1", nombre="Producto", precio_neto=1000, controla_stock=False)
    pm = PaymentMethod(code="DEBITO", name="Debito")
    db_session.add_all([prod, pm])
    db_session.commit()
    return {
        "rut_cliente": "12345678-5",
        "items": [{"product_id": prod.id, "cantidad": 1}],
        "payments": [{"payment_method_id": pm.id, "amount": 1190}],
    }


def test_sin_turno_da_409_con_control_encendido(client, db_session):
    resp = client.post("/sales/", json=_venta(db_session))
    assert resp.status_code == 409
    assert "turno de caja abierto" in resp.json()["detail"]


def test_sin_turno_vende_con_control_apagado(client, db_session):
    venta = _venta(db_session)
    assert client.put("/config/settings/", json={"control_caja": False}).status_code == 200
    resp = client.post("/sales/", json=venta)
    assert resp.status_code == 201, resp.text


def test_no_se_apaga_con_turnos_abiertos(client):
    assert client.post("/cash/open", json={"start_amount": 1000}).status_code == 200
    resp = client.put("/config/settings/", json={"control_caja": False})
    assert resp.status_code == 409
    assert client.get("/config/settings/").json()["control_caja"] is True


def test_solo_el_administrador_cambia_ajustes_de_empresa(client):
    app.dependency_overrides[get_current_tenant_user] = lambda: TenantUser(
        tenant_id=1, user_id=2, role_name="VENDEDOR", is_active=True,
    )
    for cambio in ({"control_caja": False}, {"color_mode": "usuario"}, {"color_primario": "rojo"}):
        assert client.put("/config/settings/", json=cambio).status_code == 403
    # Los demás ajustes siguen abiertos a quien entra a Configuración.
    assert client.put("/config/settings/", json={"print_formats": {"39": "57mm"}}).status_code == 200


def test_color_fuera_de_la_paleta_se_rechaza(client):
    assert client.put("/config/settings/", json={"color_primario": "amarillo"}).status_code == 422
    resp = client.put("/config/settings/", json={"color_mode": "usuario", "color_primario": "lima"})
    assert resp.json()["color_mode"] == "usuario" and resp.json()["color_primario"] == "lima"
