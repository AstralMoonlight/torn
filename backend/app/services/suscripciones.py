"""Suscripción de cada empresa: estado, pagos y prórroga.

El estado no se guarda: sale de `Tenant.suscripcion_vence` (último día pagado,
inclusive), de la prórroga y de las reglas de `SaaSAjustes`. Así una fecha mal
cargada se arregla cambiando la fecha, sin estados que queden desfasados.
"""

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.saas import SaaSAjustes, SaaSPago, Tenant
from app.utils.dates import CHILE_TZ

CORTESIA = "CORTESIA"        # plan sin vencimiento (JCB, pruebas)
SIN_PAGO = "SIN_PAGO"        # empresa nueva que aún no paga el primer período
AL_DIA = "AL_DIA"
POR_VENCER = "POR_VENCER"    # faltan `dias_aviso` días o menos
EN_GRACIA = "EN_GRACIA"      # vencida hace `dias_gracia` días o menos: todo funciona
PRORROGA = "PRORROGA"        # suspendida, pero un superusuario le dio horas extra
SUSPENDIDA = "SUSPENDIDA"    # solo lectura

#: Métodos HTTP que no escriben: una empresa suspendida los sigue usando.
METODOS_DE_LECTURA = frozenset({"GET", "HEAD", "OPTIONS"})


def ajustes(db: Session) -> SaaSAjustes:
    """La fila única de reglas, o las por defecto si la base aún no la tiene."""
    return db.get(SaaSAjustes, 1) or SaaSAjustes(id=1, dias_aviso=7, dias_gracia=5, horas_prorroga=12)


def sumar_meses(d: date, meses: int) -> date:
    """31 de enero + 1 mes = 28 (o 29) de febrero."""
    anio, mes = divmod(d.month - 1 + meses, 12)
    anio, mes = d.year + anio, mes + 1
    return date(anio, mes, min(d.day, monthrange(anio, mes)[1]))


def _utc(momento: datetime) -> datetime:
    # SQLite devuelve las fechas sin zona; se guardan en UTC.
    return momento if momento.tzinfo else momento.replace(tzinfo=timezone.utc)


def estado(tenant: Tenant, reglas: SaaSAjustes, ahora: datetime) -> str:
    if tenant.plan is not None and tenant.plan.meses == 0:
        return CORTESIA
    vence = tenant.suscripcion_vence
    if vence is None:
        return SIN_PAGO
    hoy = ahora.astimezone(CHILE_TZ).date()
    if hoy <= vence:
        return POR_VENCER if (vence - hoy).days <= reglas.dias_aviso else AL_DIA
    if (hoy - vence).days <= reglas.dias_gracia:
        return EN_GRACIA
    if tenant.prorroga_hasta and _utc(ahora) < _utc(tenant.prorroga_hasta):
        return PRORROGA
    return SUSPENDIDA


def aplicar_pago(pago: SaaSPago, reglas: SaaSAjustes, ahora: datetime) -> bool:
    """Marca el pago como PAGADO y extiende el vencimiento en los meses del plan.

    Idempotente: un pago ya aplicado no vuelve a extender (la pasarela avisa por
    el webhook y por el retorno del cliente, y puede repetir la notificación).

    Pagado antes de vencer o en gracia, sigue desde el día siguiente al
    vencimiento; suspendida, desde hoy (no se cobran los días sin servicio).
    """
    if pago.estado == "PAGADO":
        return False
    if pago.plan.meses < 1:
        raise ValueError("El plan Cortesía no se paga.")
    tenant = pago.tenant
    hoy = ahora.astimezone(CHILE_TZ).date()
    vence = tenant.suscripcion_vence
    continua = vence is not None and (hoy - vence).days <= reglas.dias_gracia
    desde = vence + timedelta(days=1) if continua else hoy

    pago.vence_anterior = vence
    pago.periodo_desde = desde
    pago.periodo_hasta = sumar_meses(desde, pago.plan.meses) - timedelta(days=1)
    pago.estado = "PAGADO"
    pago.pagado_at = ahora
    tenant.suscripcion_vence = pago.periodo_hasta
    tenant.plan_id = pago.plan_id
    tenant.plan = pago.plan
    tenant.prorroga_hasta = None
    return True


def anular_pago(pago: SaaSPago) -> None:
    """Deshace un pago. Uno PAGADO solo si es el último (su período es el vigente)."""
    if pago.estado == "ANULADO":
        return
    if pago.estado == "PAGADO":
        if pago.periodo_hasta != pago.tenant.suscripcion_vence:
            raise ValueError("Solo se puede anular el último pago de la empresa.")
        pago.tenant.suscripcion_vence = pago.vence_anterior
    pago.estado = "ANULADO"


def dar_prorroga(tenant: Tenant, horas: int, ahora: datetime) -> None:
    """Horas extra de funcionamiento desde ahora. 0 la quita."""
    tenant.prorroga_hasta = ahora + timedelta(hours=horas) if horas > 0 else None


# ── Pasarela (Flow) ────────────────────────────────────────────────────

def orden_de(pago: SaaSPago) -> str:
    return f"torn-pago-{pago.id}"


def iniciar_pago_pasarela(db: Session, tenant: Tenant, plan, email: str, creado_por: int | None) -> str:
    """Crea el pago PENDIENTE y la orden en Flow; devuelve la URL donde se paga."""
    from app.services import flow

    if not plan.is_active or plan.meses < 1:
        raise ValueError("Ese plan no se puede pagar.")
    pago = SaaSPago(tenant_id=tenant.id, plan_id=plan.id, monto=int(plan.precio), medio="PASARELA",
                    estado="PENDIENTE", creado_por=creado_por)
    db.add(pago)
    db.flush()
    meses = "1 mes" if plan.meses == 1 else f"{plan.meses} meses"
    url, token = flow.crear_orden(orden_de(pago), pago.monto, f"Factureando {plan.name} ({meses}) - {tenant.name}", email)
    pago.referencia = token
    db.commit()
    return url


def confirmar_pago_pasarela(db: Session, token: str, ahora: datetime) -> SaaSPago | None:
    """Pregunta a Flow por la orden y aplica el pago si está pagada.

    Lo llaman el webhook y el retorno del cliente, en cualquier orden y quizás a la
    vez: el `FOR UPDATE` los pone en fila y `aplicar_pago` es idempotente.
    """
    from app.services import flow

    pago = db.query(SaaSPago).filter(SaaSPago.referencia == token).with_for_update().first()
    if pago is None:
        return None
    if pago.estado == "PENDIENTE":
        r = flow.estado_orden(token)
        if r.get("commerceOrder") != orden_de(pago) or int(float(r.get("amount", -1))) != pago.monto:
            raise flow.FlowError(f"La orden {token} no calza con el pago {pago.id}")
        if r.get("status") == flow.PAGADA:
            aplicar_pago(pago, ajustes(db), ahora)
        elif r.get("status") in (flow.RECHAZADA, flow.ANULADA):
            pago.estado = "FALLIDO"
    db.commit()
    return pago
