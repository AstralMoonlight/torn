"""Entrar con la misma cuenta en otro equipo cierra la sesión anterior."""

from app.dependencies.tenant import SESION_REEMPLAZADA, get_current_global_user
from app.main import app
from app.models.saas import SaaSUser
from app.utils.security import get_password_hash


def test_el_segundo_login_cierra_el_primero(saas_client, db_session):
    db_session.add(SaaSUser(email="vendedora@test.cl", hashed_password=get_password_hash("clave-1234")))
    db_session.commit()
    app.dependency_overrides.pop(get_current_global_user)  # que valide el token de verdad

    def entrar():
        resp = saas_client.post("/auth/login", json={"email": "vendedora@test.cl", "password": "clave-1234"})
        assert resp.status_code == 200, resp.text
        return {"Authorization": f"Bearer {resp.json()['access_token']}"}

    caja, oficina = entrar(), entrar()
    assert saas_client.get("/auth/validate", headers=oficina).status_code == 200
    resp = saas_client.get("/auth/validate", headers=caja)
    assert resp.status_code == 401 and resp.json()["detail"] == SESION_REEMPLAZADA
