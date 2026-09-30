"""Estado de la suscripción, pagos y prórroga con fechas escritas a mano."""

from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.saas import SaaSAjustes, SaaSPago, SaaSPlan, Tenant
from app.services import suscripciones as s

REGLAS = SaaSAjustes(id=1, dias_aviso=7, dias_gracia=5, horas_prorroga=12)
MENSUAL = SaaSPlan(id=1, name="Mensual", meses=1)
PACK12 = SaaSPlan(id=3, name="Pack 12", meses=12)
CORTESIA = SaaSPlan(id=4, name="Cortesía", meses=0)


def mediodia(d: date) -> datetime:
    """12:00 en Chile (UTC-3 en septiembre), para no caer en el borde del día."""
    return datetime(d.year, d.month, d.day, 15, 0, tzinfo=timezone.utc)


def empresa(vence=None, plan=MENSUAL, prorroga=None):
    return Tenant(id=7, name="X", schema_name="t", plan=plan, plan_id=plan.id,
                  suscripcion_vence=vence, prorroga_hasta=prorroga)


@pytest.mark.parametrize("hoy, esperado", [
    (date(2026, 9, 1), s.AL_DIA),
    (date(2026, 9, 23), s.POR_VENCER),   # faltan 7 días
    (date(2026, 9, 30), s.POR_VENCER),   # el día del vencimiento todavía está pagado
    (date(2026, 10, 1), s.EN_GRACIA),
    (date(2026, 10, 5), s.EN_GRACIA),    # 5 días de gracia
    (date(2026, 10, 6), s.SUSPENDIDA),
])
def test_estado_segun_la_fecha(hoy, esperado):
    assert s.estado(empresa(date(2026, 9, 30)), REGLAS, mediodia(hoy)) == esperado


def test_cortesia_y_sin_pago():
    assert s.estado(empresa(date(2020, 1, 1), plan=CORTESIA), REGLAS, mediodia(date(2026, 9, 30))) == s.CORTESIA
    assert s.estado(empresa(None), REGLAS, mediodia(date(2026, 9, 30))) == s.SIN_PAGO


def test_prorroga_de_12_horas_y_luego_vuelve_a_suspender():
    ahora = mediodia(date(2026, 10, 10))
    t = empresa(date(2026, 9, 30))
    s.dar_prorroga(t, 12, ahora)
    assert s.estado(t, REGLAS, ahora + timedelta(hours=11)) == s.PRORROGA
    assert s.estado(t, REGLAS, ahora + timedelta(hours=13)) == s.SUSPENDIDA
    s.dar_prorroga(t, 0, ahora)
    assert t.prorroga_hasta is None


def pagar(t, plan, hoy):
    pago = SaaSPago(id=1, tenant=t, plan=plan, plan_id=plan.id, monto=33333, medio="TRANSFERENCIA", estado="PENDIENTE")
    assert s.aplicar_pago(pago, REGLAS, mediodia(hoy))
    return pago


def test_pagar_antes_de_vencer_sigue_desde_el_vencimiento():
    t = empresa(date(2026, 9, 30))
    pago = pagar(t, MENSUAL, date(2026, 9, 25))
    assert (pago.periodo_desde, pago.periodo_hasta) == (date(2026, 10, 1), date(2026, 10, 31))
    assert t.suscripcion_vence == date(2026, 10, 31)


def test_pagar_en_gracia_no_regala_los_dias_usados():
    t = empresa(date(2026, 9, 30))
    pagar(t, MENSUAL, date(2026, 10, 4))
    assert t.suscripcion_vence == date(2026, 10, 31)


def test_pagar_suspendida_parte_hoy_y_quita_la_prorroga():
    t = empresa(date(2026, 9, 30), prorroga=datetime(2026, 10, 20, tzinfo=timezone.utc))
    pagar(t, PACK12, date(2026, 10, 20))
    assert t.suscripcion_vence == date(2027, 10, 19)
    assert t.plan_id == PACK12.id and t.prorroga_hasta is None


def test_primer_pago_de_una_empresa_nueva():
    t = empresa(None)
    pagar(t, MENSUAL, date(2026, 1, 31))
    assert t.suscripcion_vence == date(2026, 2, 27)   # 31-ene + 1 mes = 28-feb, menos un día


def test_el_mismo_pago_no_extiende_dos_veces():
    t = empresa(date(2026, 9, 30))
    pago = pagar(t, MENSUAL, date(2026, 9, 25))
    assert not s.aplicar_pago(pago, REGLAS, mediodia(date(2026, 9, 25)))
    assert t.suscripcion_vence == date(2026, 10, 31)


def test_anular_el_ultimo_pago_devuelve_el_vencimiento():
    t = empresa(date(2026, 9, 30))
    primero = pagar(t, MENSUAL, date(2026, 9, 25))
    segundo = SaaSPago(id=2, tenant=t, plan=MENSUAL, plan_id=1, monto=1, medio="EFECTIVO", estado="PENDIENTE")
    s.aplicar_pago(segundo, REGLAS, mediodia(date(2026, 9, 26)))
    with pytest.raises(ValueError):
        s.anular_pago(primero)
    s.anular_pago(segundo)
    assert t.suscripcion_vence == date(2026, 10, 31) and segundo.estado == "ANULADO"


def test_sumar_meses():
    assert s.sumar_meses(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert s.sumar_meses(date(2026, 11, 15), 3) == date(2027, 2, 15)
