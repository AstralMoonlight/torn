"""Eliminar un cliente lo desactiva: borrarlo chocaba con la FK de sus ventas."""

from app.models.customer import Customer
from app.models.sale import Sale


def test_eliminar_cliente_con_ventas_lo_desactiva(client, db_session, admin_local_user):
    c = Customer(rut="12345678-5", razon_social="Ana")
    db_session.add(c)
    db_session.flush()
    db_session.add(Sale(folio=1, tipo_dte=39, customer_id=c.id, user_id=admin_local_user.id, monto_total=1000))
    db_session.commit()

    assert client.delete("/customers/12345678-5").status_code == 204

    assert db_session.query(Sale).count() == 1
    assert client.get("/customers/").json() == []
    assert client.get("/customers/search", params={"q": "Ana"}).json() == []
    assert client.get("/sales/").json()[0]["customer"]["rut"] == "12345678-5"


def test_crear_de_nuevo_un_cliente_eliminado_lo_reactiva(client):
    assert client.post("/customers/", json={"rut": "12345678-5", "razon_social": "Ana"}).status_code == 201
    assert client.delete("/customers/12345678-5").status_code == 204

    resp = client.post("/customers/", json={"rut": "12345678-5", "razon_social": "Ana Pérez"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["razon_social"] == "Ana Pérez" and resp.json()["is_active"]
    assert client.post("/customers/", json={"rut": "12345678-5", "razon_social": "Otra"}).status_code == 409
