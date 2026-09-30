"""Panel saas-admin: permisos por cargo, pagos, prórroga, bloqueo y pago con Flow."""

import hashlib
import hmac
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.dependencies.tenant import _bloquear_si_suspendida
from app.models.saas import SaaSPago, SaaSPlan, SaaSUser, Tenant, TenantUser
from app.services import flow, salud_empresas
from app.services import suscripciones as sus


@pytest.fixture
def datos(db_session):
    dueno = SaaSUser(id=1, email="dueno@factureando.cl", hashed_password="x", is_superuser=True, is_active=True)
    mensual = SaaSPlan(id=1, name="Mensual", precio=33333, meses=1, max_users=3)
    pack12 = SaaSPlan(id=2, name="Pack 12", precio=359996, meses=12, max_users=3, cuotas_sin_interes=True)
    cortesia = SaaSPlan(id=3, name="Cortesía", precio=0, meses=0, max_users=3)
    hace_un_mes = datetime.now(timezone.utc).date() - timedelta(days=30)
    empresa = Tenant(id=10, name="Almacén Rosa", rut="76.111.111-1", schema_name="tenant_rosa",
                     plan=mensual, suscripcion_vence=hace_un_mes, is_active=True)
    cliente = SaaSUser(id=5, email="rosa@almacen.cl", hashed_password="x", is_active=True)
    db_session.add_all([dueno, mensual, pack12, cortesia, empresa, cliente,
                        TenantUser(tenant_id=10, user_id=5, role_name="ADMINISTRADOR", is_active=True)])
    db_session.commit()
    return {"dueno": dueno, "empresa": empresa, "cliente": cliente}


def nuevo_miembro(c, db_session, permisos):
    cargo = c.post("/saas/cargos", json={"nombre": "Cobranza", "permisos": permisos}).json()
    r = c.post("/saas/equipo", json={"email": "ana@factureando.cl", "password": "secreta123", "cargo_id": cargo["id"]})
    assert r.status_code == 201, r.text
    assert r.json()["permisos"] == permisos and not r.json()["es_dueno"]
    return db_session.get(SaaSUser, r.json()["id"])


def test_el_cargo_limita_lo_que_puede_hacer_el_equipo(saas_client, db_session, datos):
    c = saas_client
    c.como(datos["dueno"])
    ana = nuevo_miembro(c, db_session, ["cobros.ver", "cobros.registrar"])

    c.como(ana)
    assert c.get("/saas/pagos").status_code == 200
    assert c.get("/saas/tenants").status_code == 403           # no tiene empresas.ver
    assert c.get("/saas/equipo").status_code == 403            # el equipo es solo del dueño
    assert c.post(f"/saas/tenants/10/prorroga", json={"horas": 12}).status_code == 403


def test_el_dueno_no_se_puede_desactivar_y_un_permiso_desconocido_se_rechaza(saas_client, datos):
    c = saas_client
    c.como(datos["dueno"])
    assert c.patch("/saas/equipo/1", json={"is_active": False}).status_code == 403
    assert c.post("/saas/cargos", json={"nombre": "X", "permisos": ["todo"]}).status_code == 422


def test_cambiar_datos_del_sii_pide_su_propio_permiso(saas_client, db_session, datos):
    c = saas_client
    c.como(datos["dueno"])
    ana = nuevo_miembro(c, db_session, ["empresas.ver", "empresas.editar"])
    c.como(ana)
    r = c.patch("/saas/tenants/10", json={"sii_ambiente": "PROD"})
    assert r.status_code == 403 and "SII" in r.json()["detail"]


def test_pago_manual_reactiva_y_se_puede_anular(saas_client, datos):
    c = saas_client
    c.como(datos["dueno"])
    assert c.get("/saas/tenants/10").json()["suscripcion_estado"] == sus.SUSPENDIDA

    r = c.post("/saas/tenants/10/pagos", json={"plan_id": 2, "medio": "TRANSFERENCIA"})
    assert r.status_code == 201, r.text
    pago = r.json()
    hoy = datetime.now(timezone.utc).astimezone(sus.CHILE_TZ).date()
    assert pago["monto"] == 359996 and pago["periodo_desde"] == hoy.isoformat()
    empresa = c.get("/saas/tenants/10").json()
    assert empresa["suscripcion_estado"] == sus.AL_DIA and empresa["plan_id"] == 2

    assert c.post(f"/saas/pagos/{pago['id']}/anular").json()["estado"] == "ANULADO"
    assert c.get("/saas/tenants/10").json()["suscripcion_estado"] == sus.SUSPENDIDA


def test_cortesia_no_se_paga(saas_client, datos):
    saas_client.como(datos["dueno"])
    r = saas_client.post("/saas/tenants/10/pagos", json={"plan_id": 3, "medio": "EFECTIVO"})
    assert r.status_code == 400


def test_prorroga_con_horas_a_eleccion(saas_client, datos):
    c = saas_client
    c.como(datos["dueno"])
    assert c.get("/saas/ajustes").json()["horas_prorroga"] == 12
    r = c.post("/saas/tenants/10/prorroga", json={"horas": 3})
    assert r.json()["suscripcion_estado"] == sus.PRORROGA
    hasta = datetime.fromisoformat(r.json()["prorroga_hasta"])
    hasta = hasta if hasta.tzinfo else hasta.replace(tzinfo=timezone.utc)
    assert timedelta(hours=2, minutes=59) < hasta - datetime.now(timezone.utc) <= timedelta(hours=3)
    assert c.post("/saas/tenants/10/prorroga", json={"horas": 0}).json()["suscripcion_estado"] == sus.SUSPENDIDA


def test_ajustes_de_cobranza_se_guardan(saas_client, datos):
    c = saas_client
    c.como(datos["dueno"])
    assert c.put("/saas/ajustes", json={"dias_aviso": 10, "dias_gracia": 3, "horas_prorroga": 24}).status_code == 200
    assert c.get("/saas/ajustes").json() == {"dias_aviso": 10, "dias_gracia": 3, "horas_prorroga": 24}


def test_resumen_cuenta_estados_y_lo_cobrado(saas_client, datos, monkeypatch):
    monkeypatch.setattr(salud_empresas, "datos_empresa",
                        lambda t, usuarios, ahora: salud_empresas.DatosEmpresa(usuarios_activos=usuarios))
    c = saas_client
    c.como(datos["dueno"])
    r = c.get("/saas/resumen").json()
    assert r["por_estado"] == {sus.SUSPENDIDA: 1} and r["cobrado_mes"] == 0
    assert any(p["tipo"] == "suscripcion" and p["nivel"] == "critico" for p in r["problemas"])

    c.post("/saas/tenants/10/pagos", json={"plan_id": 1, "medio": "EFECTIVO"})
    r = c.get("/saas/resumen").json()
    assert r["por_estado"] == {sus.AL_DIA: 1} and r["cobrado_mes"] == 33333 and r["pagos_mes"] == 1


# ── Bloqueo de solo lectura ────────────────────────────────────────────

def test_suspendida_no_escribe_pero_el_equipo_si(saas_client, datos):
    db = MagicMock()
    db.get.return_value = None  # reglas por defecto
    empresa = datos["empresa"]
    with pytest.raises(HTTPException) as e:
        _bloquear_si_suspendida(empresa, TenantUser(user=datos["cliente"]), db)
    assert e.value.status_code == 402
    _bloquear_si_suspendida(empresa, TenantUser(user=datos["dueno"]), db)

    empresa.prorroga_hasta = datetime.now(timezone.utc) + timedelta(hours=12)
    _bloquear_si_suspendida(empresa, TenantUser(user=datos["cliente"]), db)


# ── Flow ───────────────────────────────────────────────────────────────

def test_firma_de_flow_ordena_los_parametros():
    esperado = hmac.new(b"secreto", b"amount100apiKeyKcommerceOrderA1", hashlib.sha256).hexdigest()
    assert flow.firmar({"commerceOrder": "A1", "apiKey": "K", "amount": 100}, "secreto") == esperado


class FlowFalso:
    def __init__(self):
        self.ordenes = {}

    def crear_orden(self, orden, monto, asunto, email):
        token = f"tok-{orden}"
        self.ordenes[token] = {"commerceOrder": orden, "amount": monto, "status": flow.PENDIENTE}
        return f"https://sandbox.flow.cl/app/web/pay.php?token={token}", token

    def estado_orden(self, token):
        return self.ordenes[token]


@pytest.fixture
def flow_falso(monkeypatch):
    f = FlowFalso()
    monkeypatch.setattr(flow, "crear_orden", f.crear_orden)
    monkeypatch.setattr(flow, "estado_orden", f.estado_orden)
    return f


def test_pago_con_flow_se_aplica_una_sola_vez(saas_client, db_session, datos, flow_falso):
    c = saas_client
    c.como(datos["dueno"])
    r = c.post("/saas/tenants/10/link-pago", json={"plan_id": 1})
    assert r.status_code == 200, r.text
    token = r.json()["url"].split("token=")[1]
    pago = db_session.query(SaaSPago).filter_by(referencia=token).one()
    assert pago.estado == "PENDIENTE" and pago.monto == 33333

    # Aviso antes de pagar: no cambia nada.
    assert c.post("/pagos/flow/confirmacion", data={"token": token}).status_code == 200
    assert db_session.get(SaaSPago, pago.id).estado == "PENDIENTE"

    flow_falso.ordenes[token]["status"] = flow.PAGADA
    c.post("/pagos/flow/confirmacion", data={"token": token})
    r = c.post("/pagos/flow/retorno", data={"token": token}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].endswith("/pago-resultado?estado=pagado")

    db_session.expire_all()
    empresa = db_session.get(Tenant, 10)
    hoy = datetime.now(timezone.utc).astimezone(sus.CHILE_TZ).date()
    assert empresa.suscripcion_vence == sus.sumar_meses(hoy, 1) - timedelta(days=1)


def test_flow_con_otro_monto_no_se_aplica(saas_client, db_session, datos, flow_falso):
    c = saas_client
    c.como(datos["dueno"])
    token = c.post("/saas/tenants/10/link-pago", json={"plan_id": 1}).json()["url"].split("token=")[1]
    flow_falso.ordenes[token].update(status=flow.PAGADA, amount=1)
    assert c.post("/pagos/flow/confirmacion", data={"token": token}).status_code == 502
    db_session.expire_all()
    assert db_session.query(SaaSPago).filter_by(referencia=token).one().estado == "PENDIENTE"
