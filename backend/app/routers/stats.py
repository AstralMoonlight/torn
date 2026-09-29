"""Router para estadísticas y reportes del Dashboard."""

from datetime import datetime, timedelta
from app.utils.dates import get_now, get_today
from typing import List
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, case

from app.models.sale import Sale, SaleDetail
from app.models.product import Product
from app.schemas import DashboardSummary, StatPeriod, TopProductsResponse, TopProduct, ReportOut, ReportItem
from app.dependencies.tenant import get_tenant_db, require_admin

router = APIRouter(prefix="/stats", tags=["stats"])

# Documentos que son una venta. En los reportes la ND (56) suma y la NC (61)
# resta; la guía (52) no cuenta: la venta es la factura que la cobra.
TIPOS_VENTA = (33, 34, 39, 41)
TIPOS_REPORTE = TIPOS_VENTA + (56, 61)
SIGNO = case((Sale.tipo_dte == 61, -1), else_=1)


def _signo(sale: Sale) -> int:
    return -1 if sale.tipo_dte == 61 else 1


def get_period_stats(db: Session, start_date: datetime) -> StatPeriod:
    """Calcula totales de venta y margen para un periodo dado."""
    
    # Ventas en el periodo
    sales = db.query(Sale).filter(
        Sale.fecha_emision >= start_date, Sale.tipo_dte.in_(TIPOS_REPORTE)
    ).all()
    
    total_sales = sum(_signo(s) * s.monto_total for s in sales)
    # Neto e IVA se acumulan desde lo registrado en cada venta. Derivarlos de
    # `total_sales` asumiendo 19% da cifras falsas en cuanto hay documentos
    # exentos o productos con otra tasa.
    total_net = sum(_signo(s) * (s.monto_neto or Decimal(0)) for s in sales)
    total_tax = sum(_signo(s) * (s.iva or Decimal(0)) for s in sales)
    count_sales = sum(1 for s in sales if s.tipo_dte in TIPOS_VENTA)
    
    # Calcular margen (Detalle por detalle para mayor precisión)
    # Margen = Suma(cantidad * (precio_unitario - costo_unitario))
    margin_total = db.query(
        func.sum(SIGNO * SaleDetail.cantidad * (SaleDetail.precio_unitario - SaleDetail.costo_unitario))
    ).join(Product, SaleDetail.product_id == Product.id)\
     .join(Sale, SaleDetail.sale_id == Sale.id)\
     .filter(Sale.fecha_emision >= start_date, Sale.tipo_dte.in_(TIPOS_REPORTE)).scalar() or Decimal(0)

    period_name = "Personalizado"
    now = get_now()
    if start_date.date() == now.date():
        period_name = "Diario"
    elif (now - start_date).days <= 7:
        period_name = "Semanal"
    elif (now - start_date).days <= 31:
        period_name = "Mensual"

    return StatPeriod(
        sales_total=total_sales,
        sales_net=total_net,
        sales_tax=total_tax,
        sales_count=count_sales,
        margin_total=margin_total,
        period=period_name
    )


@router.get("/summary", response_model=DashboardSummary, dependencies=[Depends(require_admin)])
def get_dashboard_summary(db: Session = Depends(get_tenant_db)):
    """Obtiene resumen de ventas y margen diario, semanal y mensual."""
    now = get_now()
    
    # Inicio del día (00:00:00)
    today_start = get_today()
    # Hace 7 días
    week_start = now - timedelta(days=7)
    # Hace 30 días
    month_start = now - timedelta(days=30)
    
    def con_anterior(start: datetime, largo: timedelta) -> StatPeriod:
        # El mismo tramo del periodo anterior: hoy hasta ahora contra ayer hasta esta hora.
        stats = get_period_stats(db, start)
        stats.sales_total_prev = db.query(func.sum(SIGNO * Sale.monto_total)).filter(
            Sale.fecha_emision >= start - largo, Sale.fecha_emision < now - largo,
            Sale.tipo_dte.in_(TIPOS_REPORTE),
        ).scalar() or Decimal(0)
        return stats

    return DashboardSummary(
        daily=con_anterior(today_start, timedelta(days=1)),
        weekly=con_anterior(week_start, timedelta(days=7)),
        monthly=con_anterior(month_start, timedelta(days=30)),
    )


@router.get("/top-products", response_model=TopProductsResponse)
def get_top_products(days: int = 30, limit: int = 5, db: Session = Depends(get_tenant_db)):
    """Ranking de productos más vendidos y más rentables."""
    start_date = get_now() - timedelta(days=days)
    
    # Alias para el padre en caso de variantes
    from sqlalchemy.orm import aliased
    ParentProduct = aliased(Product)

    def get_query():
        return db.query(
            SaleDetail.product_id,
            Product.nombre.label("product_nombre"),
            ParentProduct.nombre.label("parent_nombre"),
            func.sum(SIGNO * SaleDetail.cantidad).label("total_qty"),
            func.sum(SIGNO * SaleDetail.subtotal).label("total_sales"),
            func.sum(SIGNO * SaleDetail.cantidad * (SaleDetail.precio_unitario - SaleDetail.costo_unitario)).label("total_margin")
        ).join(Product, SaleDetail.product_id == Product.id)\
         .outerjoin(ParentProduct, Product.parent_id == ParentProduct.id)\
         .join(Sale, SaleDetail.sale_id == Sale.id)\
         .filter(Sale.fecha_emision >= start_date, Sale.tipo_dte.in_(TIPOS_REPORTE))\
         .group_by(SaleDetail.product_id, Product.nombre, ParentProduct.nombre)

    # 1. Top por Cantidad
    qty_query = get_query().order_by(desc("total_qty")).limit(limit).all()
    
    # 2. Top por Margen
    margin_query = get_query().order_by(desc("total_margin")).limit(limit).all()
    
    def process_result(r):
        full_name = f"{r.parent_nombre} {r.product_nombre}" if r.parent_nombre else r.product_nombre
        return TopProduct(
            product_id=r.product_id,
            nombre=r.product_nombre,
            full_name=full_name,
            total_qty=r.total_qty,
            total_sales=r.total_sales,
            total_margin=r.total_margin
        )

    return TopProductsResponse(
        by_quantity=[process_result(r) for r in qty_query],
        by_margin=[process_result(r) for r in margin_query]
    )


@router.get("/report", response_model=ReportOut, dependencies=[Depends(require_admin)])
def get_report(
    period: str = "day",  # day, week, month
    date: str = None,     # YYYY-MM-DD
    db: Session = Depends(get_tenant_db)
):
    """Genera reporte detallado de ventas y utilidad para un periodo específico."""
    
    # Determinar fecha de referencia
    if date:
        try:
            ref_date = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=get_now().tzinfo)
        except ValueError:
            ref_date = get_now()
    else:
        ref_date = get_now()

    # Calcular rango de fechas (start_date, end_date)
    # start_date inclusivo, end_date exclusivo (o hasta el final del día)
    start_date = ref_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_date = ref_date.replace(hour=23, minute=59, second=59, microsecond=999999)

    period_label = "Diario"

    if period == "week":
        # Inicio de semana (Lunes = 0)
        start_date = start_date - timedelta(days=start_date.weekday())
        end_date = start_date + timedelta(days=6)
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
        period_label = "Semanal"
    
    elif period == "month":
        # Inicio de mes
        start_date = start_date.replace(day=1)
        # Fin de mes (inicio del proximo mes - 1 microsegundo)
        next_month = start_date.replace(day=28) + timedelta(days=4)
        end_date = next_month - timedelta(days=next_month.day)
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
        period_label = "Mensual"

    # Alias para el padre en caso de variantes
    from sqlalchemy.orm import aliased
    ParentProduct = aliased(Product)

    # Consulta principal
    items_query = db.query(
        SaleDetail.product_id,
        Product.nombre.label("product_nombre"),
        ParentProduct.nombre.label("parent_nombre"),
        func.sum(SIGNO * SaleDetail.cantidad).label("total_qty"),
        func.sum(SIGNO * SaleDetail.subtotal).label("total_sales"),
        # Utilidad = (Venta Neta - Costo Neta) * Cantidad
        func.sum(SIGNO * SaleDetail.cantidad * (SaleDetail.precio_unitario - SaleDetail.costo_unitario)).label("total_margin")
    ).join(Product, SaleDetail.product_id == Product.id)\
     .outerjoin(ParentProduct, Product.parent_id == ParentProduct.id)\
     .join(Sale, SaleDetail.sale_id == Sale.id)\
     .filter(Sale.fecha_emision >= start_date, Sale.fecha_emision <= end_date,
             Sale.tipo_dte.in_(TIPOS_REPORTE))\
     .group_by(SaleDetail.product_id, Product.nombre, ParentProduct.nombre)\
     .all()

    items = []
    
    for r in items_query:
        full_name = f"{r.parent_nombre} {r.product_nombre}" if r.parent_nombre else r.product_nombre
        items.append(ReportItem(
            product_id=r.product_id,
            full_name=full_name,
            cantidad=r.total_qty,
            monto_total=r.total_sales,
            utilidad=r.total_margin
        ))
    
    # Totales generales del periodo
    # Nota: items_query usa subtotal (neto), pero total_ventas suele ser bruto para el usuario final en Chile?
    # En el reporte anterior usabamos sum(s.monto_total), que es bruto.
    # Mantengamos consistencia con el Daily Report anterior: Total Bruto.
    
    sales_period = db.query(Sale).filter(
        Sale.fecha_emision >= start_date, Sale.fecha_emision <= end_date,
        Sale.tipo_dte.in_(TIPOS_REPORTE),
    ).all()
    total_ventas = sum(_signo(s) * s.monto_total for s in sales_period)
    total_neto = sum(_signo(s) * (s.monto_neto or Decimal(0)) for s in sales_period)
    total_iva = sum(_signo(s) * (s.iva or Decimal(0)) for s in sales_period)
    total_utilidad = sum(item.utilidad for item in items)

    return ReportOut(
        fecha=ref_date, # Devolvemos la fecha referencial solicitada
        period=period_label,
        total_ventas=total_ventas,
        total_neto=total_neto,
        total_iva=total_iva,
        total_utilidad=total_utilidad,
        items=items
    )
