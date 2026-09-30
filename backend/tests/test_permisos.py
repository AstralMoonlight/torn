"""El backend revisa los permisos del rol, no solo el menú del frontend (#60)."""

import pytest

from app.dependencies.tenant import get_current_tenant_user
from app.main import app
from app.models.user import Role, User


def _como(rol):
    app.dependency_overrides[get_current_tenant_user]().role_name = rol


@pytest.mark.parametrize("metodo, ruta", [
    ("post", "/products/"),
    ("post", "/products/1/ajuste-stock"),
    ("put", "/issuer/"),
    ("post", "/config/taxes/"),
    ("put", "/config/settings/"),
    ("get", "/stats/summary"),
    ("get", "/stats/report"),
    ("get", "/reports/dashboard"),
    ("get", "/purchases/"),
    ("get", "/providers/"),
    ("get", "/users/"),
    ("post", "/users/"),
    ("get", "/roles/"),
    ("post", "/price-lists/"),
    ("delete", "/brands/1"),
])
def test_la_vendedora_no_entra_a_lo_que_no_ve_en_el_menu(client, metodo, ruta):
    _como("VENDEDOR")
    resp = getattr(client, metodo)(ruta, **({} if metodo in ("get", "delete") else {"json": {}}))
    assert resp.status_code == 403, (ruta, resp.text)
    assert "Pídaselo al administrador" in resp.json()["detail"]


def test_la_vendedora_usa_lo_de_su_menu(client):
    _como("VENDEDOR")
    assert client.get("/products/").status_code == 200  # el POS busca productos
    assert client.get("/sales/").status_code == 200  # Historial
    assert client.get("/cash/sessions").status_code == 200  # Caja
    assert client.post("/customers/", json={"rut": "11111111-1", "razon_social": "Cliente"}).status_code == 201


def test_un_rol_sin_permisos_no_vende(client):
    _como("DESCONOCIDO")  # rol que no existe en la empresa: sin permisos
    assert client.post("/sales/", json={}).status_code == 403


def test_con_personal_no_se_toca_a_un_administrador(client, db_session):
    admin = db_session.query(Role).filter_by(name="ADMINISTRADOR").one()
    vendedor = db_session.query(Role).filter_by(name="VENDEDOR").one()
    db_session.add_all([
        Role(name="ENCARGADO", permissions={"Personal": True}),
        User(id=5, email="duena@jcb.cl", role_id=admin.id),
        User(id=6, email="vendedora@jcb.cl", role_id=vendedor.id),
    ])
    db_session.commit()
    _como("ENCARGADO")

    assert client.put("/users/5", json={"password": "otra"}).status_code == 403
    assert client.delete("/users/5").status_code == 403
    assert client.put("/users/6", json={"role_id": admin.id}).status_code == 403
    assert client.post("/users/", json={"full_name": "Nueva", "email": "nueva@jcb.cl", "password": "x",
                                        "role_id": admin.id}).status_code == 403



def test_la_vendedora_edita_clientes_pero_no_los_elimina(client):
    """Completa en el POS lo que falta para facturar; eliminar lo pide a administración."""
    client.post("/customers/", json={"rut": "11111111-1", "razon_social": "Cliente"})
    _como("VENDEDOR")
    resp = client.put("/customers/11111111-1", json={"giro": "Ferretería", "direccion": "Av. Uno 1", "comuna": "Maipú"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["direccion"] == "Av. Uno 1"
    assert client.delete("/customers/11111111-1").status_code == 403
