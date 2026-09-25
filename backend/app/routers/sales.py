"""Router para gestión de Ventas (Facturas)."""

import logging
from urllib.parse import quote
from decimal import Decimal
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse, Response
from jinja2 import Environment, FileSystemLoader
from sqlalchemy.orm import Session, joinedload

from app.models.issuer import Issuer
from app.models.product import Product
from app.models.sale import Sale, SaleDetail
from app.models.user import User
from app.models.customer import Customer
from app.models.cash import CashSession
from app.models.settings import SystemSettings
from app.models.payment import SalePayment, PaymentMethod
from app.schemas import FacturarGuias, SaleCreate, SaleOut, ReturnCreate, PaymentMethodOut
from app.services import dte_client, dte_impreso
from app.utils.formatters import format_clp, format_number
from app.utils.pricing import resolve_unit_price
from app.utils.dates import get_now
from app.utils.taxes import (
    BOLETAS, TASA_IVA_DTE, monto_linea_dte, precio_dte, quantize_money,
    resolve_tax_rate, round_to_nearest_ten, totales_dte,
)
from app.utils.print_settings import PAPEL_TICKET_MM, resolve_print_format
from app.dependencies.tenant import get_current_tenant_user, get_tenant_db, get_global_db, get_current_local_user, get_current_global_user
from app.models.saas import TenantUser, SaaSUser

router = APIRouter(prefix="/sales", tags=["sales"])
log = logging.getLogger(__name__)

# ── Jinja2 para plantillas HTML ──────────────────────────────────────
_HTML_TEMPLATES = Path(__file__).resolve().parent.parent / "templates" / "html"
_html_env = Environment(
    loader=FileSystemLoader(str(_HTML_TEMPLATES)),
    autoescape=True,
)
_html_env.filters["clp"] = format_clp
_html_env.filters["number"] = format_number


def _linea_dte(tipo: int, product: Product, cantidad: Decimal, precio_neto: Decimal, descuento: Decimal,
               tipo_impuesto: int | None = None):
    """Línea tal como va a dte-torn, con su `MontoItem` y si es exenta.

    `tipo_impuesto`: tipo de DTE que decide el IVA, si no es `tipo` (una NC
    hereda el del documento que anula: devolver una boleta exenta no genera IVA).
    """
    rate = resolve_tax_rate(product, tipo_impuesto or tipo)
    if rate not in (Decimal("0"), TASA_IVA_DTE):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{product.nombre}: la facturación electrónica solo admite IVA 19% o exento (tasa {rate}).",
        )
    precio = precio_dte(tipo, precio_neto, rate)
    if tipo in BOLETAS:
        descuento = descuento * (1 + rate)
    monto = monto_linea_dte(cantidad, precio, descuento)
    item = {
        "nombre": product.nombre,
        "codigo": product.codigo_interno,
        "unidad": product.unidad_medida,
        "cantidad": str(cantidad),
        "precio": str(precio),
        "descuento": int(quantize_money(descuento)),
        "exento": rate == 0,
    }
    return item, monto, rate == 0


def _emitir_dte(db: Session, tenant, sale: Sale, customer: Customer, items: list, referencias: list, actor: str,
                tipo_despacho: int | None = None) -> None:
    """Pide el folio a dte-torn y lo deja en `sale.folio`.

    Si dte-torn rechaza o no responde, se revierte la venta entera: no se
    entrega un documento sin folio autorizado.
    """
    documento = {
        "external_id": f"venta-{sale.id}",
        "tipo_dte": sale.tipo_dte,
        "fecha_emision": get_now().date().isoformat(),
        "items": items,
        "referencias": referencias,
    }
    if sale.tipo_dte not in BOLETAS:
        documento["receptor"] = {
            "rut": customer.rut, "razon_social": customer.razon_social, "giro": customer.giro,
            "direccion": customer.direccion, "comuna": customer.comuna, "ciudad": customer.ciudad,
            "correo": customer.email,
        }
    if sale.tipo_dte == GUIA_DESPACHO:
        documento["ind_traslado"] = sale.ind_traslado
        documento["tipo_despacho"] = tipo_despacho
        if sale.ind_traslado == TRASLADO_INTERNO:
            # Traslado entre bodegas propias: el receptor es el mismo emisor.
            issuer = db.query(Issuer).first()
            documento["receptor"] = {
                "rut": issuer.rut, "razon_social": issuer.razon_social, "giro": issuer.giro,
                "direccion": issuer.direccion, "comuna": issuer.comuna, "ciudad": issuer.ciudad,
            }
    try:
        emitido = dte_client.emitir(tenant, documento, actor)
    except dte_client.DteError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    sale.folio = emitido["folio"]
    sale.modo = tenant.sii_ambiente
    _guardar_estado(sale, emitido)
    if Decimal(emitido["monto_total"]) != sale.monto_total:
        # No debería pasar: `totales_dte` replica el cálculo de dte-torn. El
        # documento ya está emitido, así que la venta se guarda igual.
        log.error("Venta %s: total cobrado %s, total del DTE %s", sale.id, sale.monto_total, emitido["monto_total"])


GUIA_DESPACHO = 52
TRASLADO_INTERNO = 5
#: IndTraslado de guías que después se facturan (venta, venta por efectuar, consignación).
TRASLADOS_FACTURABLES = {1, 2, 3}

#: Estados de dte-torn que ya no cambian (`ERROR` no está: se reintenta).
#: SIMULADO: emitido en modo Desarrollador, nunca va al SII.
ESTADOS_DTE_FINALES = {"ACEPTADO", "REPAROS", "RECHAZADO", "ANULADO", "ERROR_VALIDACION", "SIMULADO"}


def _guardar_estado(sale: Sale, doc: dict) -> None:
    sale.dte_estado = doc["estado"]
    glosa = doc.get("glosa_sii") or doc.get("ultimo_error")
    sale.dte_glosa = glosa[:500] if glosa else None


def _referencias_dte(referencias) -> list:
    return [
        {"tipo_doc": r["tipo_documento"], "folio": r["folio"], "fecha": r["fecha"], "codigo": r.get("sii_reason_code"),
         "razon": r.get("razon")}
        for r in referencias or []
    ]


@router.get("/payment-methods/", response_model=List[PaymentMethodOut],
            summary="Listar Medios de Pago",
            description="Lista todos los medios de pago activos.")
def list_payment_methods(db: Session = Depends(get_tenant_db)):
    """Lista todos los medios de pago activos."""
    return db.query(PaymentMethod).filter(PaymentMethod.is_active == True).all()  # noqa: E712


@router.get("/", response_model=List[SaleOut],
            summary="Listar Ventas",
            description="Lista las ventas con filtros opcionales.")
def list_sales(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_tenant_db),
):
    """Lista ventas paginadas, ordenadas por fecha descendente."""
    sales = (
        db.query(Sale)
        .options(
            joinedload(Sale.customer),
            joinedload(Sale.details).joinedload(SaleDetail.product),
        )
        .order_by(Sale.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return sales


@router.post("/dte-estados", summary="Actualizar estado SII",
             description="Consulta a dte-torn las ventas cuyo estado todavía puede cambiar.")
def actualizar_estados_dte(
    db: Session = Depends(get_tenant_db),
    tenant_user: TenantUser = Depends(get_current_tenant_user),
):
    """Refresca `dte_estado` de las ventas pendientes. Devuelve cuántas cambiaron."""
    # ponytail: una llamada por venta pendiente; casi siempre son pocas porque el
    # SII responde en minutos. Si crece, pedir a dte-torn un listado por external_id.
    pendientes = (
        db.query(Sale)
        .filter(Sale.dte_estado.isnot(None), Sale.dte_estado.notin_(ESTADOS_DTE_FINALES))
        .limit(100)
        .all()
    )
    cambiadas = 0
    for sale in pendientes:
        try:
            doc = dte_client.request("GET", f"/documents/venta-{sale.id}", tenant_user.tenant).json()
        except dte_client.DteError as exc:
            if exc.status_code == 404:
                continue
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        if doc["estado"] != sale.dte_estado:
            cambiadas += 1
        _guardar_estado(sale, doc)
    db.commit()
    return {"pendientes": len(pendientes), "cambiadas": cambiadas}


@router.post("/", response_model=SaleOut, status_code=status.HTTP_201_CREATED,
             summary="Crear Venta",
             description="Registra una nueva venta de forma atómica.",
             response_description="Objeto de venta creado con detalles y folio.")
def create_sale(
    sale_in: SaleCreate,
    db: Session = Depends(get_tenant_db),
    local_user: User = Depends(get_current_local_user),
    global_user: SaaSUser = Depends(get_current_global_user),
    tenant_user: TenantUser = Depends(get_current_tenant_user),
):
    return _registrar_venta(sale_in, db, local_user, global_user, tenant_user)


@router.get("/guias-pendientes", response_model=List[SaleOut], summary="Guías por facturar")
def guias_pendientes(db: Session = Depends(get_tenant_db)):
    """Guías de venta (no traslados internos) que todavía no se facturan, las más antiguas primero."""
    return (
        db.query(Sale)
        .options(joinedload(Sale.customer), joinedload(Sale.details).joinedload(SaleDetail.product))
        .filter(Sale.tipo_dte == GUIA_DESPACHO, Sale.facturada_por_id.is_(None),
                Sale.ind_traslado.in_(TRASLADOS_FACTURABLES))
        .order_by(Sale.fecha_emision)
        .all()
    )


@router.post("/facturar-guias", response_model=SaleOut, status_code=status.HTTP_201_CREATED,
             summary="Facturar guías de despacho")
def facturar_guias(
    datos: FacturarGuias,
    db: Session = Depends(get_tenant_db),
    local_user: User = Depends(get_current_local_user),
    global_user: SaaSUser = Depends(get_current_global_user),
    tenant_user: TenantUser = Depends(get_current_tenant_user),
):
    """Factura con las líneas y precios de las guías, que referencia a cada una.

    No mueve stock (ya salió con la guía) y cobra el total con un solo medio de pago.
    """
    if datos.tipo_dte not in (33, 34):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Las guías se facturan con factura (33) o factura exenta (34).")
    guias = (
        db.query(Sale).options(joinedload(Sale.customer), joinedload(Sale.details).joinedload(SaleDetail.product))
        .filter(Sale.id.in_(datos.guia_ids)).with_for_update(of=Sale).all()
    )
    if len(guias) != len(set(datos.guia_ids)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alguna de las guías no existe.")
    for g in guias:
        if g.tipo_dte != GUIA_DESPACHO or g.ind_traslado not in TRASLADOS_FACTURABLES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El documento folio {g.folio} no es una guía facturable.")
        if g.facturada_por_id is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, f"La guía folio {g.folio} ya está facturada.")
    if len({g.customer_id for g in guias}) > 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Las guías de una factura deben ser del mismo cliente.")
    metodo = db.get(PaymentMethod, datos.payment_method_id)
    if metodo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Medio de pago no encontrado.")

    # El pago cubre justo el total: se calcula igual que lo hará `_registrar_venta`.
    lineas = [
        _linea_dte(datos.tipo_dte, d.product, d.cantidad, d.precio_unitario, d.descuento)[1:]
        for g in guias for d in g.details
    ]
    total = totales_dte(datos.tipo_dte, lineas)[3]
    if metodo.code == "EFECTIVO":
        total = round_to_nearest_ten(total)
    venta = SaleCreate(
        rut_cliente=guias[0].customer.rut, tipo_dte=datos.tipo_dte, items=[],
        payments=[{"payment_method_id": metodo.id, "amount": total}],
    )
    return _registrar_venta(venta, db, local_user, global_user, tenant_user, guias)


def _registrar_venta(sale_in: SaleCreate, db: Session, local_user: User, global_user: SaaSUser,
                     tenant_user: TenantUser, guias: list = ()):
    """
    Registra una nueva venta en el sistema.

    Esta función orquesta todo el proceso de venta:
    1. Valida que la caja esté abierta.
    2. Valida cliente y productos (existencia y stock).
    3. Descuenta inventario y genera movimientos (Kardex).
    4. Procesa pagos (múltiples medios de pago).
    5. Emite el DTE en dte-torn, que asigna el folio y firma.
    6. Persiste todo en una transacción atómica.

    Args:
        sale_in (SaleCreate): Datos de la venta (cliente, items, pagos).
        db (Session): Sesión de base de datos.

    Returns:
        SaleOut: Objeto de venta creado con todas sus relaciones.

    Raises:
        HTTPException(409): Si la caja está cerrada o no hay stock.
        HTTPException(404): Si cliente o producto no existen.
        HTTPException(400): Si los montos no cuadran.
        HTTPException(409/422/503): Si dte-torn rechaza el documento o no responde.
    """
    # 0. Validar Caja Abierta (si la empresa usa control de caja)
    seller_id_to_use = local_user.id
    settings = db.query(SystemSettings).first()
    control_caja = settings is None or settings.control_caja

    active_session = db.query(CashSession).filter(
        CashSession.user_id == seller_id_to_use,
        CashSession.status == "OPEN"
    ).first()

    # La guía no se cobra (se cobra al facturarla), así que no pasa por caja.
    if control_caja and not active_session and sale_in.tipo_dte != GUIA_DESPACHO:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El vendedor (ID {seller_id_to_use}) no tiene turno de caja abierto."
        )

    # 1. Validar Cliente
    customer = db.query(Customer).filter(Customer.rut == sale_in.rut_cliente).first()
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con RUT {sale_in.rut_cliente} no encontrado",
        )

    # 1.5 Validar Referencias para Documentos de Ajuste
    ADJUSTMENT_DTES = [56, 61, 111, 112]
    if sale_in.tipo_dte in ADJUSTMENT_DTES:
        if not sale_in.referencias:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Los documentos de ajuste (DTE {sale_in.tipo_dte}) requieren obligatoriamente referencias al documento original."
            )
        for ref in sale_in.referencias:
            if not ref.tipo_documento or not ref.folio or not ref.sii_reason_code:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Las referencias de un documento de ajuste deben incluir tipo_documento, folio y sii_reason_code."
                )

    tipo = sale_in.tipo_dte
    if tipo == GUIA_DESPACHO:
        if sale_in.ind_traslado is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "La guía de despacho requiere el tipo de traslado.")
        if sale_in.payments:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "La guía no se cobra: se cobra al facturarla.")
    elif sale_in.ind_traslado or sale_in.tipo_despacho:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tipo de traslado y de despacho son solo para guías (52).")

    # (producto, cantidad, precio neto, descuento, mueve stock). Las líneas de
    # guías que se facturan ya descontaron stock al emitir la guía.
    lineas = []
    for item in sale_in.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Producto ID {item.product_id} no encontrado",
            )
        if not product.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Producto {product.nombre} (SKU {product.codigo_interno}) no está activo",
            )
        lineas.append((product, item.cantidad, resolve_unit_price(db, product, customer), item.descuento, True))
    for guia in guias:
        lineas.extend((d.product, d.cantidad, d.precio_unitario, d.descuento, False) for d in guia.details)

    # 2. Validar Productos y Calcular Totales
    lineas_dte = []
    items_dte = []
    sale_details = []
    stock_movements = []

    for product, cantidad, precio_unitario, descuento, mueve_stock in lineas:
        # Validar Stock
        if mueve_stock and product.controla_stock:
            if product.stock_actual < cantidad:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Stock insuficiente para {product.nombre}. Disponible: {product.stock_actual}, Solicitado: {cantidad}"
                )

            # Descontar Stock y Registrar Movimiento (se guardará al hacer commit de la venta)
            product.stock_actual -= cantidad

            # Importar localmente para evitar dependencias circulares
            from app.models.inventory import StockMovement
            
            movement = StockMovement(
                product_id=product.id,
                user_id=seller_id_to_use, # Usuario caja
                tipo="SALIDA",
                motivo="GUIA" if tipo == GUIA_DESPACHO else "VENTA",
                cantidad=cantidad,
                description=f"Venta en proceso", 
            )
            # No hacemos db.add(movement) aquí, lo vinculamos a la venta
            stock_movements.append(movement)

        subtotal_bruto_linea = precio_unitario * cantidad

        if descuento> subtotal_bruto_linea:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"El descuento (${descuento}) supera el subtotal de la línea "
                    f"(${subtotal_bruto_linea}) para {product.nombre}"
                ),
            )
        subtotal_linea = subtotal_bruto_linea - descuento

        item_dte, monto, exenta = _linea_dte(tipo, product, cantidad, precio_unitario, descuento)
        items_dte.append(item_dte)
        lineas_dte.append((monto, exenta))

        detail_obj = SaleDetail(
            product_id=product.id,
            cantidad=cantidad,
            precio_unitario=precio_unitario,
            subtotal=subtotal_linea,
            descuento=descuento,
        )
        sale_details.append(detail_obj)

    # 3. Totales con las reglas del DTE (ver `totales_dte`)
    neto, exento, iva, total = totales_dte(tipo, lineas_dte)
    total_neto = neto + exento

    cash_method_ids = {
        pm.id for pm in db.query(PaymentMethod).filter(PaymentMethod.code == "EFECTIVO").all()
    }
    cash_declared = sum(
        p.amount for p in sale_in.payments if p.payment_method_id in cash_method_ids
    )
    non_cash_declared = sum(
        p.amount for p in sale_in.payments if p.payment_method_id not in cash_method_ids
    )

    # Redondeo a la decena (regla chilena): sólo se aplica a la porción que se
    # paga en efectivo, no es vuelto sino un ajuste legal del monto cobrado.
    # Con pago mixto, la tarjeta/crédito interno cubre su parte exacta y el
    # redondeo cae sobre lo que queda por cubrir en efectivo.
    ajuste_redondeo = Decimal("0")
    if cash_declared > 0:
        cash_owed = max(total - non_cash_declared, Decimal("0"))
        ajuste_redondeo = round_to_nearest_ten(cash_owed) - cash_owed

    total_ajustado = quantize_money(total + ajuste_redondeo)

    # Validar Pagos
    total_payments = sum(p.amount for p in sale_in.payments)
    if tipo != GUIA_DESPACHO and total_payments < total_ajustado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Monto de pagos ({total_payments}) inferior al total de la venta "
                f"(${total_ajustado}, incluye ${ajuste_redondeo} de ajuste por redondeo)"
            ),
        )

    # El excedente sobre el total ajustado se entrega como vuelto, siempre en
    # efectivo: no tiene sentido devolver cambio de un pago con tarjeta o
    # crédito interno. Si no hay efectivo suficiente en los pagos para
    # cubrirlo, la combinación de pagos no es válida.
    vuelto = quantize_money(max(total_payments - total_ajustado, Decimal("0")))
    if vuelto > 0 and cash_declared < vuelto:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El vuelto (${vuelto}) no puede superar el efectivo recibido "
                f"(${cash_declared}); los demás medios de pago no dan cambio."
            ),
        )

    # Serializar referencias para columna JSON (solo para Factura)
    referencias_json = [r.model_dump() for r in sale_in.referencias or []]
    referencias_json += [
        {"tipo_documento": "52", "folio": str(g.folio), "fecha": g.fecha_emision.strftime("%Y-%m-%d")}
        for g in guias
    ]
    referencias_json = referencias_json or None

    # 5. Crear Venta
    new_sale = Sale(
        customer_id=customer.id,
        folio=0,  # provisorio: _emitir_dte pone el real antes del commit
        tipo_dte=tipo,
        monto_neto=total_neto,
        iva=iva,
        monto_total=total,
        vuelto=vuelto,
        ajuste_redondeo=ajuste_redondeo,
        descripcion=sale_in.descripcion,
        seller_id=seller_id_to_use,
        user_id=seller_id_to_use,
        details=sale_details,
        stock_movements=stock_movements, # Vinculación automática
        audit_metadata={"saas_admin_email": global_user.email} if local_user.is_system_user else None,
        referencias=referencias_json,
        ind_traslado=sale_in.ind_traslado,
    )
    db.add(new_sale)
    db.flush()  # Genera new_sale.id sin hacer commit todavía
    for guia in guias:
        guia.facturada_por_id = new_sale.id

    # 5.1 Guardar Pagos
    for payment_in in sale_in.payments:
        pm = SalePayment(
            sale_id=new_sale.id,
            payment_method_id=payment_in.payment_method_id,
            amount=payment_in.amount,
            transaction_code=payment_in.transaction_code,
        )
        db.add(pm)

        # Lógica de Crédito Interno
        # Validamos si el medio de pago es CREDITO_INTERNO para sumar deuda
        pay_method = db.query(PaymentMethod).get(payment_in.payment_method_id)
        if pay_method and pay_method.code == "CREDITO_INTERNO":
            customer.current_balance += payment_in.amount
            db.add(customer)

    # 5.2 Los movimientos de stock ya quedan vinculados a la venta: se pasan en
    # `stock_movements=` al construir `Sale`, y SQLAlchemy propaga el sale_id.

    # 6. Emitir en dte-torn (asigna el folio) y confirmar
    _emitir_dte(db, tenant_user.tenant, new_sale, customer, items_dte,
                _referencias_dte(referencias_json), global_user.email, sale_in.tipo_despacho)
    db.commit()

    # Eager load para respuesta
    sale_loaded = (
        db.query(Sale)
        .options(
            joinedload(Sale.customer),
            joinedload(Sale.details).joinedload(SaleDetail.product),
        )
        .filter(Sale.id == new_sale.id)
        .one()
    )

    return sale_loaded


@router.post("/return", response_model=SaleOut, status_code=status.HTTP_201_CREATED,
             summary="Crear Devolución (NC)",
             description="Genera una Nota de Crédito por devolución de productos.",
             response_description="Nota de Crédito generada.")
def create_return(
    return_in: ReturnCreate, 
    db: Session = Depends(get_tenant_db),
    local_user: User = Depends(get_current_local_user),
    global_user: SaaSUser = Depends(get_current_global_user),
    tenant_user: TenantUser = Depends(get_current_tenant_user),
):
    """
    Registra una Devolución de mercadería (Nota de Crédito).

    Proceso inverso a la venta:
    1. Valida existencia de venta original.
    2. Reingresa stock al inventario (Movimiento 'ENTRADA' motivo 'DEVOLUCION').
    3. Genera un nuevo DTE Tipo 61 (Nota de Crédito).
    4. Vincula la NC con la venta original (`related_sale_id`).
    5. Realiza la devolución del dinero (Abono a Cta Cte o Caja).

    Args:
        return_in (ReturnCreate): Datos de la devolución (venta origen, items).
        db (Session): Sesión de base de datos.
    
    Returns:
        SaleOut: La Nota de Crédito generada.

    Raises:
        HTTPException(404): Si la venta original no existe.
        HTTPException(400): Si el medio de devolución es inválido.
    """
    # 0. Validar Caja Abierta (si se devuelve efectivo)
    user_id = local_user.id
    
    # 1. Buscar Venta Original
    original_sale = db.query(Sale).get(return_in.original_sale_id)
    if not original_sale:
        raise HTTPException(status_code=404, detail="Venta original no encontrada")

    # 1.5 Cuánto queda por devolver de cada producto.
    # Sin este control se puede devolver más de lo vendido, o devolver la misma
    # venta varias veces: cada devolución reingresa stock, emite una NC y abona
    # la cuenta corriente del cliente, así que el exceso se traduce en
    # inventario y dinero inventados.
    vendido = {}
    for d in original_sale.details:
        vendido[d.product_id] = vendido.get(d.product_id, Decimal("0")) + d.cantidad

    devuelto = {}
    notas_previas = db.query(Sale).filter(Sale.related_sale_id == original_sale.id).all()
    for nc in notas_previas:
        for d in nc.details:
            devuelto[d.product_id] = devuelto.get(d.product_id, Decimal("0")) + d.cantidad

    for item in return_in.items:
        disponible = vendido.get(item.product_id, Decimal("0")) - devuelto.get(
            item.product_id, Decimal("0")
        )
        if item.cantidad > disponible:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"No se puede devolver {item.cantidad} unidad(es) del producto "
                    f"{item.product_id}: la venta #{original_sale.folio} tiene "
                    f"{disponible} disponible(s) para devolución."
                ),
            )

    # 2. Calcular Montos de Devolución
    # La NC hereda el tipo de DTE del documento original para efectos de IVA:
    # devolver una Boleta Exenta no puede generar impuesto.
    tipo = return_in.tipo_dte
    lineas_dte = []
    items_dte = []
    sale_details = []
    stock_movements = []

    for item in return_in.items:
        product = db.query(Product).get(item.product_id)
        if not product:
            raise HTTPException(status_code=404, detail=f"Producto {item.product_id} no encontrado")

        # Reingreso de Stock
        if product.controla_stock:
            product.stock_actual += item.cantidad
            from app.models.inventory import StockMovement
            movement = StockMovement(
                product_id=product.id,
                user_id=user_id,
                tipo="ENTRADA",
                motivo="DEVOLUCION",
                cantidad=item.cantidad,
                description=f"Devolución venta f.{original_sale.folio}: {return_in.reason}"
            )
            stock_movements.append(movement)
        
        precio_unitario = product.precio_neto # Usamos precio actual o histórico? Ideal histórico.
        # Por simplicidad usamos precio actual del producto, pero DEBERIAMOS buscar precio venta original.
        # Buscamos en detalle original?
        original_detail = db.query(SaleDetail).filter(
            SaleDetail.sale_id == original_sale.id,
            SaleDetail.product_id == product.id
        ).first()
        if original_detail:
            precio_unitario = original_detail.precio_unitario
        
        subtotal = precio_unitario * item.cantidad
        item_dte, monto, exenta = _linea_dte(
            tipo, product, item.cantidad, precio_unitario, Decimal("0"), tipo_impuesto=original_sale.tipo_dte
        )
        items_dte.append(item_dte)
        lineas_dte.append((monto, exenta))

        sale_details.append(SaleDetail(
            product_id=product.id,
            cantidad=item.cantidad,
            precio_unitario=precio_unitario,
            subtotal=subtotal
        ))

    neto, exento, iva, total = totales_dte(tipo, lineas_dte)
    total_neto = neto + exento

    # 3. Registrar Documento de Ajuste
    ADJUSTMENT_DTES = [56, 61, 111, 112]
    if tipo not in ADJUSTMENT_DTES:
        raise HTTPException(status_code=400, detail="El tipo de DTE para ajuste debe ser 56, 61, 111 o 112.")

    # Generar la referencia al documento original automáticamente
    referencias_json = [{
        "tipo_documento": str(original_sale.tipo_dte),
        "folio": str(original_sale.folio),
        "fecha": original_sale.fecha_emision.strftime("%Y-%m-%d"),
        "sii_reason_code": return_in.sii_reason_code,
        "razon": return_in.reason[:90],
    }]

    nc_sale = Sale(
        customer_id=original_sale.customer_id,
        folio=0,  # provisorio: _emitir_dte pone el real antes del commit
        tipo_dte=tipo,
        monto_neto=total_neto,
        iva=iva,
        monto_total=total,
        descripcion=f"Ajuste Venta #{original_sale.folio}: {return_in.reason}",
        # La NC queda a nombre de quien la emite, igual que una venta: sin esto
        # sales.user_id viola su NOT NULL y la devolución falla al persistir.
        user_id=user_id,
        seller_id=user_id,
        details=sale_details,
        stock_movements=stock_movements,
        related_sale_id=original_sale.id,
        referencias=referencias_json,
        audit_metadata={"saas_admin_email": global_user.email} if local_user.is_system_user else None
    )
    db.add(nc_sale)
    db.flush()

    # 4. Registrar Devolución de Dinero (SalePayment negativo o positivo con metodo Devolucion?)
    # Usamos SalePayment normal linkeado a la NC. 
    # Si es abono a cta cte:
    method = db.query(PaymentMethod).get(return_in.return_method_id)
    if not method: 
         raise HTTPException(status_code=400, detail="Medio de devolución invalido")

    # Si es CREDITO_INTERNO (Abono), disminuimos deuda
    if method.code == "CREDITO_INTERNO":
        customer = db.query(Customer).get(original_sale.customer_id)
        customer.current_balance -= total
        db.add(customer)
    elif method.code == "EFECTIVO":
        # Verificar caja?
        # Por ahora asumimos que hay caja.
        pass

    pm = SalePayment(
        sale_id=nc_sale.id,
        payment_method_id=method.id,
        amount=total, # Monto positivo asociado a la NC
        transaction_code="DEVOLUCION"
    )
    db.add(pm)
    
    # 5. Emitir en dte-torn y confirmar
    _emitir_dte(db, tenant_user.tenant, nc_sale, original_sale.customer, items_dte,
                _referencias_dte(referencias_json), global_user.email)
    db.commit()
    return nc_sale


# ── PDF Preview ──────────────────────────────────────────────────────


def _external_id_dte(tenant, sale: Sale) -> str | None:
    """Documento de dte-torn que corresponde a la venta, buscado por tipo y folio
    (únicos por empresa). None si dte-torn no lo tiene: ventas anteriores a la
    integración."""
    docs = dte_client.request("GET", "/documents", tenant,
                              params={"tipo_dte": sale.tipo_dte, "folio": sale.folio, "limit": 1}).json()
    # Se verifica lo devuelto: un dte-torn sin el filtro `folio` respondería con
    # el documento más reciente del tipo, que no es el de esta venta.
    doc = next((d for d in docs if d["tipo_dte"] == sale.tipo_dte and d["folio"] == sale.folio), None)
    return doc["external_id"] if doc else None


def _impreso_dte(tenant, sale: Sale, papel_mm: int | None, cedible: bool) -> Response | None:
    """Representación impresa desde dte-torn, o None si no tiene el documento.

    Carta: el PDF que arma dte-torn. Ticket: HTML armado acá desde el XML
    firmado, con el timbre en PDF417. Las facturas salen con copia cliente y
    copia cedible; `cedible=True` deja solo la cedible.
    """
    try:
        external_id = _external_id_dte(tenant, sale)
        if external_id is None:
            return None
        ruta = f"/documents/{quote(external_id, safe='')}"
        if papel_mm is None:
            # Facturas: copia cliente y cedible en dos hojas, salvo que se pida solo la cedible.
            pdf = dte_client.request("GET", f"{ruta}/pdf", tenant,
                                     params={"cedible": "true"} if cedible else {"con_cedible": "true"})
            return Response(pdf.content, media_type="application/pdf",
                            headers={"Content-Disposition": pdf.headers.get("content-disposition", "inline")})
        xml = dte_client.request("GET", f"{ruta}/xml", tenant).content
    except dte_client.DteError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    prueba = sale.modo == "DEV"
    # Un documento de prueba se imprime aunque la empresa no tenga resolución.
    if tenant.sii_resolucion_fecha is None and not prueba:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "La empresa no tiene fecha de resolución del SII: va impresa bajo el timbre.")
    doc = dte_impreso.leer_dte(xml)
    html = _html_env.get_template("dte_ticket.html").render(
        doc=doc, papel_mm=papel_mm, timbre=dte_impreso.timbre_svg(doc["ted"], papel_mm),
        copias=([True] if cedible else [False, True]) if doc["tipo"] in dte_impreso.CEDIBLES else [False],
        leyenda=dte_impreso.LEYENDA_PIE,
        prueba=prueba, leyenda_prueba=dte_impreso.LEYENDA_PRUEBA,
        oficina_sii=tenant.sii_oficina, resolucion_numero=tenant.sii_resolucion_numero,
        resolucion_anio=(tenant.sii_resolucion_fecha or get_now()).year,
        rut=dte_impreso.formatear_rut, fecha=dte_impreso.formatear_fecha,
    )
    return HTMLResponse(html)


@router.get("/{sale_id}/pdf", response_class=HTMLResponse,
             summary="Vista Previa Factura",
             description="PDF de dte-torn con el timbre (formato carta) o HTML de ticket.")
def get_sale_pdf(
    sale_id: int,
    cedible: bool = False,
    db: Session = Depends(get_tenant_db),
    tenant_user: TenantUser = Depends(get_current_tenant_user),
):
    """
    Representación impresa del documento.

    Sale del XML firmado en dte-torn, con el timbre electrónico: en carta es el
    PDF de dte-torn; en 57/80 mm, un ticket HTML armado acá desde ese XML.
    `?cedible=true` da la copia cedible de las facturas. Las ventas que dte-torn
    no tiene (anteriores a la integración) usan las plantillas antiguas.

    Renderiza una plantilla Jinja2 con los datos de la venta, el emisor
    y el cliente, lista para ser impresa o convertida a PDF.

    Args:
        sale_id (int): ID de la venta.
        db (Session): Sesión de base de datos.

    Returns:
        HTMLResponse: Contenido HTML de la factura.

    Raises:
        HTTPException(404): Si la venta no existe o falta configuración de emisor.
    """

    # Cargar venta con relaciones
    sale = (
        db.query(Sale)
        .options(
            joinedload(Sale.customer),
            joinedload(Sale.details).joinedload(SaleDetail.product),
        )
        .filter(Sale.id == sale_id)
        .first()
    )

    if not sale:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Venta ID {sale_id} no encontrada",
        )

    issuer = db.query(Issuer).first()
    if not issuer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emisor no configurado. Use PUT /issuer/ primero.",
        )

    # Cargar configuración del sistema para el formato de impresión
    settings = db.query(SystemSettings).first()
    print_format = resolve_print_format(settings, str(sale.tipo_dte))
    papel_mm = PAPEL_TICKET_MM.get(print_format)
    impreso = _impreso_dte(tenant_user.tenant, sale, papel_mm, cedible)
    if impreso is not None:
        return impreso

    # Venta sin documento en dte-torn: plantilla antigua, sin timbre.
    template_name = "factura_ticket.html" if papel_mm else "factura_carta.html"
    template = _html_env.get_template(template_name)

    # Renderizar HTML
    html_content = template.render(
        papel_mm=papel_mm,
        sale=sale,
        issuer=issuer,
        customer=sale.customer,
    )

    return HTMLResponse(content=html_content)

