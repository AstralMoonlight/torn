"""
Endpoint de reportes y análisis para el dashboard.
Agrega métricas de ventas del día, por hora, top productos y métodos de pago.
"""

from datetime import datetime, timedelta, date
from app.utils.dates import get_now, get_today
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, desc, case, extract
from sqlalchemy.orm import Session

from app.models.sale import Sale, SaleDetail
from app.models.product import Product
from app.models.payment import PaymentMethod, SalePayment
from app.models.cash import CashSession
from app.dependencies.tenant import get_tenant_db, requiere_permiso
from app.routers.stats import CUENTA, RECHAZADOS, TIPOS_REPORTE, TIPOS_VENTA

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
