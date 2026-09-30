"""Router para estadísticas y reportes del Dashboard."""

from collections import defaultdict
from datetime import date as date_, datetime, time, timedelta, timezone
from app.utils.dates import CHILE_TZ, get_now, get_today
from typing import Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func, desc, case, or_

from app.models.sale import Sale, SaleDetail
from app.models.payment import PaymentMethod, SalePayment
from app.models.product import Product
from app.schemas import DashboardSummary, StatPeriod, TopProductsResponse, TopProduct
from app.dependencies.tenant import get_tenant_db, requiere_permiso

router = APIRouter(prefix="/stats", tags=["stats"])

# Documentos que son una venta. En los reportes la ND (56) suma y la NC (61)
# resta; la guía (52) no cuenta: la venta es la factura que la cobra.
TIPOS_VENTA = (33, 34, 39, 41)
TIPOS_REPORTE = TIPOS_VENTA + (56, 61)
SIGNO = case((Sale.tipo_dte == 61, -1), else_=1)
#: Lo que el SII rechazó se vuelve a emitir: contarlo duplicaría la venta. Los
#: reportes solo informan cuántos hay (el mismo criterio que el Historial).
RECHAZADOS = ("RECHAZADO", "ERROR_VALIDACION")
CUENTA = or_(Sale.dte_estado.is_(None), Sale.dte_estado.notin_(RECHAZADOS))


def _signo(sale: Sale) -> int:
    return -1 if sale.tipo_dte == 61 else 1


def get_period_stats(db: Session, start_date: datetime) -> StatPeriod:
    """Calcula totales de venta y margen para un periodo dado."""
    
    # Ventas en el periodo
    sales = db.query(Sale).filter(
        Sale.fecha_emision >= start_date, Sale.tipo_dte.in_(TIPOS_REPORTE), CUENTA
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
     .filter(Sale.fecha_emision >= start_date, Sale.tipo_dte.in_(TIPOS_REPORTE), CUENTA).scalar() or Decimal(0)

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


@router.get("/summary", response_model=DashboardSummary, dependencies=[Depends(requiere_permiso("Dashboard"))])
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
            Sale.tipo_dte.in_(TIPOS_REPORTE), CUENTA,
        ).scalar() or Decimal(0)
        return stats

    return DashboardSummary(
        daily=con_anterior(today_start, timedelta(days=1)),
        weekly=con_anterior(week_start, timedelta(days=7)),
        monthly=con_anterior(month_start, timedelta(days=30)),
    )


@router.get("/top-products", dependencies=[Depends(requiere_permiso("Dashboard"))], response_model=TopProductsResponse)
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
         .filter(Sale.fecha_emision >= start_date, Sale.tipo_dte.in_(TIPOS_REPORTE), CUENTA)\
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


# ── Reporte de ventas ────────────────────────────────────────────────

#: Receptor genérico de las boletas: no es un cliente que valga la pena rankear.
CONSUMIDOR_FINAL = "66666666-6"
CERO = Decimal(0)


def _inicio(dia: date_) -> datetime:
    return datetime.combine(dia, time.min, tzinfo=CHILE_TZ)


def _en(ini: datetime, fin: datetime) -> tuple:
    """Documentos del rango que cuentan como venta: sin guías ni rechazados."""
    return (Sale.fecha_emision >= ini, Sale.fecha_emision < fin, Sale.tipo_dte.in_(TIPOS_REPORTE), CUENTA)


def _anterior(desde: date_, hasta: date_, ini: datetime, fin: datetime) -> tuple:
    """El periodo con el que se compara. Si el rango parte el día 1, los meses
    anteriores (el año, el mismo tramo del año pasado); si no, los mismos días justo
    antes. Un periodo en curso se compara hasta la misma hora: hoy a las 11 contra
    ayer a las 11, este mes hasta el día de hoy del mes pasado."""
    if desde.day == 1:
        meses = (hasta.year - desde.year) * 12 + hasta.month - desde.month + 1
        if desde.month == 1 and meses > 1:
            meses = 12
        n = desde.year * 12 + desde.month - 1 - meses
        ini_prev = _inicio(date_(n // 12, n % 12 + 1, 1))
    else:
        ini_prev = ini - (fin - ini)
    fin_prev = min(ini_prev + (min(fin, get_now()) - ini), ini)
    return ini_prev, fin_prev


def _resumen(db: Session, ini: datetime, fin: datetime) -> dict:
    """Totales del periodo. El margen es la venta neta (con descuentos) menos el
    costo guardado en cada línea al vender."""
    total, neto, iva, num = db.query(
        func.sum(SIGNO * Sale.monto_total), func.sum(SIGNO * Sale.monto_neto), func.sum(SIGNO * Sale.iva),
        func.sum(case((Sale.tipo_dte.in_(TIPOS_VENTA), 1), else_=0)),
    ).filter(*_en(ini, fin)).one()
    costo = db.query(func.sum(SIGNO * SaleDetail.cantidad * SaleDetail.costo_unitario)) \
        .join(Sale, SaleDetail.sale_id == Sale.id).filter(*_en(ini, fin)).scalar()
    total, neto, iva, costo, num = total or CERO, neto or CERO, iva or CERO, costo or CERO, int(num or 0)
    return {
        "venta_total": float(total), "neto": float(neto), "iva": float(iva), "costo": float(costo),
        "margen": float(neto - costo), "num_ventas": num,
        "ticket_promedio": float(total / num) if num else 0.0,
    }


def _local(dt: datetime) -> datetime:
    """Fecha en hora de Chile. SQLite (tests) la devuelve sin zona y en UTC."""
    return (dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt).astimezone(CHILE_TZ)


@router.get("/report", dependencies=[Depends(requiere_permiso("Reportes de Ventas"))])
def get_report(
    desde: Optional[date_] = Query(None, description="Primer día, en hora de Chile (default: hoy)"),
    hasta: Optional[date_] = Query(None, description="Último día, incluido (default: desde)"),
    db: Session = Depends(get_tenant_db),
):
    """Reporte de ventas de un rango de días: totales contra el periodo anterior,
    evolución, medios de pago, documentos, vendedores, clientes y productos."""
    desde = desde or get_today().date()
    hasta = max(hasta or desde, desde)
    ini, fin = _inicio(desde), _inicio(hasta + timedelta(days=1))
    ini_prev, fin_prev = _anterior(desde, hasta, ini, fin)

    ventas = (
        db.query(Sale)
        .options(selectinload(Sale.details).joinedload(SaleDetail.product).joinedload(Product.parent),
                 joinedload(Sale.customer), joinedload(Sale.seller))
        .filter(*_en(ini, fin))
        .all()
    )

    # Evolución: por hora si es un día, por día hasta dos meses, si no por mes.
    dias = (hasta - desde).days + 1
    agrupacion = "hora" if dias == 1 else "dia" if dias <= 62 else "mes"
    serie = defaultdict(lambda: [CERO, 0])
    documentos = defaultdict(lambda: {"num": 0, "neto": CERO, "iva": CERO, "total": CERO})
    vendedores = defaultdict(lambda: {"num": 0, "total": CERO, "margen": CERO})
    clientes = defaultdict(lambda: {"num": 0, "total": CERO})
    productos = {}
    descuentos = CERO
    devoluciones = {"num": 0, "total": CERO}

    for s in ventas:
        signo = _signo(s)
        es_venta = s.tipo_dte in TIPOS_VENTA
        local = _local(s.fecha_emision)
        clave = local.hour if agrupacion == "hora" else \
            local.date().isoformat() if agrupacion == "dia" else local.strftime("%Y-%m")
        serie[clave][0] += signo * s.monto_total
        serie[clave][1] += es_venta

        doc = documentos[s.tipo_dte]
        doc["num"] += 1
        doc["neto"] += signo * s.monto_neto
        doc["iva"] += signo * s.iva
        doc["total"] += signo * s.monto_total
        if s.tipo_dte == 61:
            devoluciones["num"] += 1
            devoluciones["total"] += s.monto_total

        # El descuento al total no está en las líneas: se reparte en proporción
        # para que la suma de los productos cuadre con la venta neta.
        base = sum((d.subtotal for d in s.details), CERO)
        factor = s.monto_neto / base if base else CERO
        costo_venta = CERO
        for d in s.details:
            p = productos.setdefault(d.product_id, {
                "product_id": d.product_id, "codigo": d.product.codigo_interno, "nombre": d.product.full_name,
                "cantidad": CERO, "venta": CERO, "costo": CERO,
            })
            costo = d.cantidad * d.costo_unitario
            p["cantidad"] += signo * d.cantidad
            p["venta"] += signo * d.subtotal * factor
            p["costo"] += signo * costo
            costo_venta += costo
            if es_venta:
                descuentos += d.descuento or CERO
        if es_venta and s.descuento_global:
            descuentos += max(base - s.monto_neto, CERO)

        v = vendedores[(s.seller.full_name or s.seller.email) if s.seller else "Sin vendedor"]
        v["num"] += es_venta
        v["total"] += signo * s.monto_total
        v["margen"] += signo * (s.monto_neto - costo_venta)

        if s.customer and s.customer.rut != CONSUMIDOR_FINAL:
            c = clientes[(s.customer.rut, s.customer.razon_social)]
            c["num"] += es_venta
            c["total"] += signo * s.monto_total

    # Medios de pago: lo cobrado. El vuelto sale del efectivo y la NC devuelve.
    pagos = db.query(PaymentMethod.code, PaymentMethod.name, func.count(SalePayment.id),
                     func.sum(SIGNO * SalePayment.amount)) \
        .join(SalePayment, SalePayment.payment_method_id == PaymentMethod.id) \
        .join(Sale, Sale.id == SalePayment.sale_id).filter(*_en(ini, fin)) \
        .group_by(PaymentMethod.code, PaymentMethod.name).all()
    vuelto = sum((s.vuelto or CERO for s in ventas), CERO)
    medios = [{"codigo": c, "nombre": n, "num": k, "total": float(t - (vuelto if c == "EFECTIVO" else 0))}
              for c, n, k, t in pagos]

    rechazados = db.query(func.count(Sale.id), func.coalesce(func.sum(Sale.monto_total), 0)).filter(
        Sale.fecha_emision >= ini, Sale.fecha_emision < fin,
        Sale.tipo_dte.in_(TIPOS_REPORTE), Sale.dte_estado.in_(RECHAZADOS),
    ).one()

    # Serie completa, con los huecos en cero, para que el gráfico no se salte días.
    if agrupacion == "hora":
        claves = list(range(min(serie, default=9), max(serie, default=18) + 1))
    elif agrupacion == "dia":
        claves = [(desde + timedelta(days=i)).isoformat() for i in range(dias)]
    else:
        claves, mes = [], desde.replace(day=1)
        while mes <= hasta:
            claves.append(mes.strftime("%Y-%m"))
            mes = (mes + timedelta(days=32)).replace(day=1)

    resumen = _resumen(db, ini, fin)
    resumen.update(descuentos=float(descuentos),
                   devoluciones={"num": devoluciones["num"], "total": float(devoluciones["total"])})
    return {
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "resumen": resumen,
        "anterior": {
            "desde": ini_prev.date().isoformat(),
            "hasta": (fin_prev - timedelta(microseconds=1)).date().isoformat(),
            **_resumen(db, ini_prev, fin_prev),
        },
        "agrupacion": agrupacion,
        "serie": [{"clave": str(k), "total": float(serie[k][0]) if k in serie else 0.0,
                   "num": serie[k][1] if k in serie else 0} for k in claves],
        "medios_pago": sorted(medios, key=lambda m: -m["total"]),
        "documentos": [{"tipo_dte": t, "num": d["num"], **{k: float(d[k]) for k in ("neto", "iva", "total")}}
                       for t, d in sorted(documentos.items())],
        "vendedores": sorted(({"nombre": n, "num": v["num"], "total": float(v["total"]),
                               "margen": float(v["margen"])} for n, v in vendedores.items()),
                             key=lambda v: -v["total"]),
        "clientes": sorted(({"rut": r, "razon_social": n, "num": c["num"], "total": float(c["total"])}
                            for (r, n), c in clientes.items()), key=lambda c: -c["total"])[:10],
        "productos": sorted(({**p, "cantidad": float(p["cantidad"]), "venta": float(p["venta"]),
                              "costo": float(p["costo"]), "margen": float(p["venta"] - p["costo"])}
                             for p in productos.values()), key=lambda p: -p["venta"]),
        "rechazados": {"num": rechazados[0], "total": float(rechazados[1])},
    }
