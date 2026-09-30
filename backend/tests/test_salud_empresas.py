"""Qué problemas se detectan en una empresa, con datos escritos a mano."""

from datetime import date, datetime, timezone

from app.models.saas import Tenant
from app.services import suscripciones as sus
from app.services.salud_empresas import CRITICO, AVISO, INFO, DatosEmpresa, problemas

AHORA = datetime(2026, 9, 30, 15, 0, tzinfo=timezone.utc)


def empresa(ambiente="PROD", creada=datetime(2026, 1, 1, 15, tzinfo=timezone.utc)):
    return Tenant(id=1, name="Almacén", schema_name="t", sii_ambiente=ambiente,
                  suscripcion_vence=date(2026, 9, 1), created_at=creada)


def folios(tipo, disponibles, umbral=50, vence="2027-01-01"):
    return {"tipo_dte": tipo, "disponibles": disponibles, "umbral_alerta": umbral,
            "cafs": [{"estado": "ACTIVO", "disponibles": disponibles, "fecha_vencimiento": vence}]}


def mensajes(t, estado, datos):
    return {(p.nivel, p.mensaje) for p in problemas(t, estado, datos, AHORA)}


def sano(**cambios):
    base = dict(ultima_venta=datetime(2026, 9, 30, tzinfo=timezone.utc), usuarios_activos=2,
                certificado={"dias_restantes": 200}, folios=[folios(33, 500)])
    return DatosEmpresa(**{**base, **cambios})


def test_empresa_sana_no_tiene_problemas():
    assert mensajes(empresa(), sus.AL_DIA, sano()) == set()


def test_certificado_vencido_por_vencer_o_ausente():
    assert (CRITICO, "Certificado vencido hace 3 días: no está emitiendo") in mensajes(
        empresa(), sus.AL_DIA, sano(certificado={"dias_restantes": -3}))
    assert (AVISO, "El certificado digital vence en 20 días") in mensajes(
        empresa(), sus.AL_DIA, sano(certificado={"dias_restantes": 20}))
    assert (CRITICO, "Sin certificado digital: no puede emitir") in mensajes(
        empresa(), sus.AL_DIA, sano(certificado={}))


def test_folios_agotados_bajos_y_vencidos():
    datos = sano(folios=[folios(33, 0), folios(39, 10), folios(61, 300, vence="2026-09-01")])
    m = mensajes(empresa(), sus.AL_DIA, datos)
    assert (CRITICO, "Sin folios de Factura") in m
    assert (AVISO, "Quedan 10 folios de Boleta") in m
    assert (CRITICO, "Los folios de Nota de crédito vencieron: hay que pedir otros al SII") in m


def test_sin_ningun_caf():
    assert (CRITICO, "No tiene folios (CAF) cargados: no puede emitir") in mensajes(
        empresa(), sus.AL_DIA, sano(folios=[]))


def test_suspendida_rechazados_e_inactividad():
    datos = sano(rechazados=2, sin_respuesta=1, ultima_venta=datetime(2026, 9, 10, 12, tzinfo=timezone.utc))
    m = mensajes(empresa(), sus.SUSPENDIDA, datos)
    assert (CRITICO, "Suspendida por no pago desde el 01-09-2026: solo puede consultar") in m
    assert (AVISO, "2 documentos rechazados por el SII") in m
    assert (AVISO, "1 documentos sin respuesta del SII hace más de 2 días") in m
    assert (INFO, "Sin ventas hace 20 días") in m


def test_desarrollador_no_revisa_certificado_ni_folios_pero_avisa_que_sigue_en_pruebas():
    m = mensajes(empresa("DEV"), sus.CORTESIA, sano(certificado={}, folios=[]))
    assert m == {(INFO, "Sigue en modo desarrollador hace 272 días")}
