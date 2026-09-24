"""Guardar el emisor lo copia a dte-torn, junto con los datos del SII del tenant."""

from datetime import date

import httpx
import pytest

from app.dependencies.tenant import get_current_tenant_user
from app.main import app
from app.models.issuer import Issuer
from app.models.saas import Tenant, TenantUser
from app.services import dte_client

EMISOR = {
    "rut": "76123456-0", "razon_social": "Emisor Test", "giro": "Comercio",
    "acteco": "464903", "direccion": "Calle 1", "comuna": "Concepción", "ciudad": "Concepción",
}


@pytest.fixture
def con_dte(client, monkeypatch):
    monkeypatch.setenv("TORN_DTE_URL", "http://dte-torn")
    tenant = Tenant(id=7, name="Emisor Test", schema_name="tenant_7", is_active=True, sii_ambiente="CERT",
                    sii_resolucion_numero=0, sii_resolucion_fecha=date(2020, 11, 30), sii_oficina="S.I.I. - CONCEPCION")
    app.dependency_overrides[get_current_tenant_user] = lambda: TenantUser(
        tenant_id=7, user_id=1, role_name="ADMINISTRADOR", is_active=True, tenant=tenant
    )
    llamadas = []
    monkeypatch.setattr(dte_client, "request", lambda *a, **kw: llamadas.append((a, kw)) or httpx.Response(200, json={}))
    return llamadas


def test_guardar_emisor_lo_copia_a_dte_torn(client, con_dte):
    resp = client.put("/issuer/", json=EMISOR)
    assert resp.status_code == 200, resp.text

    (args, kwargs), = con_dte
    assert args == ("PUT", f"/tenants/{dte_client.tenant_uuid(7)}")
    enviado = kwargs["json"]
    assert enviado["rut_emisor"] == "76123456-0"
    assert enviado["acteco"] == "464903"
    assert enviado["ambiente"] == "CERT"
    assert enviado["resolucion_fecha"] == "2020-11-30"
    assert enviado["oficina_sii"] == "S.I.I. - CONCEPCION"


def test_si_dte_torn_rechaza_el_emisor_no_se_guarda(client, con_dte, monkeypatch, db_session):
    def rechaza(*args, **kwargs):
        raise dte_client.DteError(422, "Giro vacío")

    monkeypatch.setattr(dte_client, "request", rechaza)
    resp = client.put("/issuer/", json=EMISOR)
    assert resp.status_code == 422
    assert "Giro vacío" in resp.json()["detail"]
    assert db_session.query(Issuer).count() == 0
