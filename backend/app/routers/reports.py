"""
Endpoint de reportes y análisis para el dashboard.
Agrega métricas de ventas del día, por hora, top productos y métodos de pago.
"""

from collections import defaultdict
from datetime import datetime, timedelta, date, timezone
from app.utils.dates import CHILE_TZ, get_now, get_today
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, desc, case, extract, or_, and_
from sqlalchemy.orm import Session

from app.models.sale import Sale, SaleDetail
from app.models.product import Product
from app.models.payment import PaymentMethod, SalePayment
from app.models.cash import CashSession
from app.models.customer import Customer
from app.models.purchase import Purchase
from app.dependencies.tenant import get_tenant_db, requiere_permiso
from app.routers.stats import CUENTA, RECHAZADOS, SIGNO, TIPOS_REPORTE, TIPOS_VENTA
from app.routers.sales import ESTADOS_DTE_FINALES, GUIA_DESPACHO, TRASLADOS_FACTURABLES

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/dashboard", dependencies=[Depends(requiere_permiso("Dashboard"))])
def get_dashboard(
    fecha: Optional[date] = Query(None, description="Fecha del reporte (default=hoy)"),
    db: Session = Depends(get_tenant_db),
):
    """Retorna métricas del dashboard para una fecha específica."""
    target_date = fecha or get_today().date()
    start = datetime.combine(target_date, datetime.min.time(), tzinfo=get_now().tzinfo)
    end = datetime.combine(target_date, datetime.max.time(), tzinfo=get_now().tzinfo)

    # ── KPIs del día ─────────────────────────────────────────────────
    sales_query = db.query(Sale).filter(
        Sale.fecha_emision >= start,
        Sale.fecha_emision <= end,
        Sale.tipo_dte.in_(TIPOS_VENTA),
        CUENTA,
    )

    all_sales = sales_query.all()
    total_ventas = sum(float(s.monto_total) for s in all_sales)
    total_neto = sum(float(s.monto_neto) for s in all_sales)
    total_iva = sum(float(s.iva) for s in all_sales)
    num_ventas = len(all_sales)
    ticket_promedio = total_ventas / num_ventas if num_ventas > 0 else 0

    # Notas de crédito del día
    nc_query = db.query(Sale).filter(
        Sale.fecha_emision >= start,
        Sale.fecha_emision <= end,
        Sale.tipo_dte == 61,
        CUENTA,
    )
    num_nc = nc_query.count()
    total_nc = sum(float(s.monto_total) for s in nc_query.all())

    # Rechazados por el SII: no suman, solo se informan.
    num_rechazados, total_rechazados = db.query(
        func.count(Sale.id), func.coalesce(func.sum(Sale.monto_total), 0)
    ).filter(
        Sale.fecha_emision >= start,
        Sale.fecha_emision <= end,
        Sale.tipo_dte.in_(TIPOS_REPORTE),
        Sale.dte_estado.in_(RECHAZADOS),
    ).one()

    # ── Ventas por hora ──────────────────────────────────────────────
    hourly = (
        db.query(
            extract("hour", Sale.fecha_emision).label("hora"),
            func.count(Sale.id).label("cantidad"),
            func.sum(Sale.monto_total).label("total"),
        )
        .filter(
            Sale.fecha_emision >= start,
            Sale.fecha_emision <= end,
            Sale.tipo_dte.in_(TIPOS_VENTA),
            CUENTA,
        )
        .group_by(extract("hour", Sale.fecha_emision))
        .order_by(extract("hour", Sale.fecha_emision))
        .all()
    )
    ventas_por_hora = [
        {"hora": f"{int(h.hora):02d}:00", "cantidad": h.cantidad, "total": float(h.total)}
        for h in hourly
    ]

    # ── Top 5 Productos ──────────────────────────────────────────────
    top_products = (
        db.query(
            Product.nombre,
            Product.codigo_interno,
            func.sum(SaleDetail.cantidad).label("cantidad"),
            func.sum(SaleDetail.subtotal).label("total"),
        )
        .join(SaleDetail, SaleDetail.product_id == Product.id)
        .join(Sale, Sale.id == SaleDetail.sale_id)
        .filter(
            Sale.fecha_emision >= start,
            Sale.fecha_emision <= end,
            Sale.tipo_dte.in_(TIPOS_VENTA),
            CUENTA,
        )
        .group_by(Product.id, Product.nombre, Product.codigo_interno)
        .order_by(desc(func.sum(SaleDetail.subtotal)))
        .limit(5)
        .all()
    )
    top = [
        {
            "nombre": p.nombre,
            "sku": p.codigo_interno,
            "cantidad": float(p.cantidad),
            "total": float(p.total),
        }
        for p in top_products
    ]

    # ── Distribución Medios de Pago ──────────────────────────────────
    payment_dist = (
        db.query(
            PaymentMethod.name,
            PaymentMethod.code,
            func.count(SalePayment.id).label("transacciones"),
            func.sum(SalePayment.amount).label("total"),
        )
        .join(SalePayment, SalePayment.payment_method_id == PaymentMethod.id)
        .join(Sale, Sale.id == SalePayment.sale_id)
        .filter(
            Sale.fecha_emision >= start,
            Sale.fecha_emision <= end,
            Sale.tipo_dte.in_(TIPOS_VENTA),
            CUENTA,
        )
        .group_by(PaymentMethod.id, PaymentMethod.name, PaymentMethod.code)
        .all()
    )
    medios_pago = [
        {
            "nombre": p.name,
            "codigo": p.code,
            "transacciones": p.transacciones,
            "total": float(p.total),
        }
        for p in payment_dist
    ]

    # ── Caja actual ──────────────────────────────────────────────────
    active_session = db.query(CashSession).filter(CashSession.status == "OPEN").first()
    caja = None
    if active_session:
        caja = {
            "id": active_session.id,
            "inicio": active_session.start_time.isoformat(),
            "fondo": float(active_session.start_amount),
        }

    return {
        "fecha": target_date.isoformat(),
        "kpis": {
            "total_ventas": total_ventas,
            "total_neto": total_neto,
            "total_iva": total_iva,
            "num_ventas": num_ventas,
            "ticket_promedio": round(ticket_promedio),
            "num_notas_credito": num_nc,
            "total_notas_credito": total_nc,
            "num_rechazados": num_rechazados,
            "total_rechazados": float(total_rechazados),
        },
        "ventas_por_hora": ventas_por_hora,
        "top_productos": top,
        "medios_pago": medios_pago,
        "caja": caja,
    }


# ── Panel de inicio ──────────────────────────────────────────────────

#: Estados del SII que dejan el documento sin validez o con observaciones.
PROBLEMAS_DTE = ("RECHAZADO", "REPAROS", "ERROR_VALIDACION")
#: Un documento sin respuesta del SII pasado este plazo se muestra como problema.
SIN_RESPUESTA = timedelta(hours=24)
#: Los documentos con problemas más antiguos que esto ya no se alertan.
VENTANA_PROBLEMAS = timedelta(days=30)


def _local(dt: datetime) -> datetime:
    """Fecha en hora de Chile. SQLite (tests) la devuelve sin zona y en UTC."""
    return (dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt).astimezone(CHILE_TZ)


def _tramo(dias_vencido: int) -> str:
    if dias_vencido <= 0:
        return "al_dia"
    if dias_vencido <= 30:
        return "1_30"
    if dias_vencido <= 60:
        return "31_60"
    return "61_mas"


def _cobranza(db: Session, hoy: date) -> dict:
    """Deuda de crédito interno por antigüedad.

    Los pagos se aplican a la venta fiada más antigua, así que el saldo actual es lo
    que queda de las más nuevas: se reparte desde la última venta hacia atrás. Cada
    parte vence en fecha + `dias_credito`.
    """
    deudores = db.query(Customer).filter(Customer.current_balance > 0).all()
    tramos = {"al_dia": 0.0, "1_30": 0.0, "31_60": 0.0, "61_mas": 0.0}
    if not deudores:
        return {"total": 0.0, "vencido": 0.0, "tramos": tramos, "deudores": [], "num_vencidos": 0}

    # El saldo es uno solo para todos los modos del emisor: se miran todas sus ventas.
    fiadas = defaultdict(list)
    filas = (
        db.query(Sale.customer_id, Sale.fecha_emision, SalePayment.amount)
        .join(SalePayment, SalePayment.sale_id == Sale.id)
        .join(PaymentMethod, PaymentMethod.id == SalePayment.payment_method_id)
        .filter(Sale.customer_id.in_([c.id for c in deudores]), Sale.tipo_dte != 61,
                PaymentMethod.code == "CREDITO_INTERNO")
        .order_by(Sale.fecha_emision.desc())
        .execution_options(todos_los_modos=True)
        .all()
    )
    for customer_id, fecha, monto in filas:
        fiadas[customer_id].append((_local(fecha).date(), monto))

    lista = []
    for c in deudores:
        pendiente = c.current_balance
        vencido, dias_max = Decimal(0), 0
        for fecha, monto in fiadas[c.id]:
            if pendiente <= 0:
                break
            parte = min(monto, pendiente)
            pendiente -= parte
            dias = (hoy - (fecha + timedelta(days=c.dias_credito or 0))).days
            tramos[_tramo(dias)] += float(parte)
            if dias > 0:
                vencido += parte
                dias_max = max(dias_max, dias)
        if pendiente > 0:
            # Saldo sin venta fiada que lo explique (cargado a mano o anterior a Torn).
            tramos["61_mas"] += float(pendiente)
            vencido += pendiente
            dias_max = max(dias_max, 61)
        if vencido > 0:
            lista.append({"rut": c.rut, "razon_social": c.razon_social, "saldo": float(c.current_balance),
                          "vencido": float(vencido), "dias": dias_max})

    lista.sort(key=lambda d: d["vencido"], reverse=True)
    return {
        "total": float(sum(c.current_balance for c in deudores)),
        "vencido": sum(d["vencido"] for d in lista),
        "tramos": tramos,
        "deudores": lista[:5],
        "num_vencidos": len(lista),
    }


@router.get("/panel", dependencies=[Depends(requiere_permiso("Dashboard"))])
def get_panel(db: Session = Depends(get_tenant_db)):
    """Lo que el dueño tiene que ver al entrar: estado ante el SII, IVA del mes,
    guías por facturar, cuentas por cobrar y ventas de los últimos 30 días."""
    ahora = get_now()
    hoy = get_today()
    inicio_mes = hoy.replace(day=1)

    # ── Estado ante el SII ───────────────────────────────────────────
    estados = dict(
        db.query(Sale.dte_estado, func.count(Sale.id))
        .filter(Sale.fecha_emision >= inicio_mes, Sale.dte_estado.isnot(None))
        .group_by(Sale.dte_estado)
        .all()
    )
    con_problemas = db.query(Sale).filter(
        Sale.fecha_emision >= ahora - VENTANA_PROBLEMAS,
        or_(
            Sale.dte_estado.in_(PROBLEMAS_DTE),
            and_(Sale.dte_estado.notin_(ESTADOS_DTE_FINALES), Sale.fecha_emision < ahora - SIN_RESPUESTA),
        ),
    )
    problemas = [
        {"id": s.id, "tipo_dte": s.tipo_dte, "folio": s.folio, "fecha": s.fecha_emision.isoformat(),
         "estado": s.dte_estado if s.dte_estado in PROBLEMAS_DTE else "SIN_RESPUESTA", "glosa": s.dte_glosa}
        for s in con_problemas.order_by(Sale.fecha_emision.desc()).limit(10)
    ]

    # ── IVA estimado del mes ─────────────────────────────────────────
    debito = db.query(func.sum(SIGNO * Sale.iva)).filter(
        Sale.fecha_emision >= inicio_mes, Sale.tipo_dte.in_(TIPOS_REPORTE), CUENTA).scalar() or 0
    credito = db.query(func.sum(Purchase.iva)).filter(
        Purchase.fecha_compra >= inicio_mes, Purchase.tipo_documento == "FACTURA").scalar() or 0
    # El F29 de quien factura electrónicamente vence el 20 del mes siguiente.
    vence = (inicio_mes + timedelta(days=32)).replace(day=20).date()

    # ── Guías por facturar ───────────────────────────────────────────
    guias = db.query(func.count(Sale.id), func.min(Sale.fecha_emision)).filter(
        Sale.tipo_dte == GUIA_DESPACHO, Sale.facturada_por_id.is_(None),
        Sale.ind_traslado.in_(TRASLADOS_FACTURABLES)).one()

    # ── Ventas de los últimos 30 días ────────────────────────────────
    desde = hoy - timedelta(days=29)
    por_dia = defaultdict(Decimal)
    for fecha, monto in db.query(Sale.fecha_emision, SIGNO * Sale.monto_total).filter(
            Sale.fecha_emision >= desde, Sale.tipo_dte.in_(TIPOS_REPORTE), CUENTA):
        por_dia[_local(fecha).date()] += monto
    dias = [(desde + timedelta(days=i)).date() for i in range(30)]

    return {
        "sii": {
            "estados": estados,
            "problemas": problemas,
            "num_problemas": con_problemas.count(),
        },
        "iva": {"debito": float(debito), "credito": float(credito),
                "a_pagar": float(debito - credito), "vence": vence.isoformat()},
        "guias": {"pendientes": guias[0],
                  "desde": guias[1].isoformat() if guias[1] else None},
        "cobranza": _cobranza(db, hoy.date()),
        "ventas_30_dias": [{"fecha": d.isoformat(), "total": float(por_dia[d])} for d in dias],
    }
