"""Router para gestión de Ventas (Facturas)."""

from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.dte import CAF, DTE
from app.models.issuer import Issuer
from app.models.product import Product
from app.models.sale import Sale, SaleDetail
from app.models.user import User
from app.models.cash import CashSession
from app.models.payment import SalePayment, PaymentMethod
from app.schemas import SaleCreate, SaleOut
from app.services.xml_generator import render_factura_xml

router = APIRouter(prefix="/sales", tags=["sales"])

# ── Jinja2 para plantillas HTML ──────────────────────────────────────
_HTML_TEMPLATES = Path(__file__).resolve().parent.parent / "templates" / "html"
_html_env = Environment(
    loader=FileSystemLoader(str(_HTML_TEMPLATES)),
    autoescape=True,
)


@router.post("/", response_model=SaleOut, status_code=status.HTTP_201_CREATED)
def create_sale(sale_in: SaleCreate, db: Session = Depends(get_db)):
    """
    Registra una nueva venta + genera DTE XML atómicamente.
    Si algo falla, se hace rollback completo.
    """
    # 0. Validar Caja Abierta (Simulado usuario 1)
    user_id = 1 
    active_session = db.query(CashSession).filter(
        CashSession.user_id == user_id,
        CashSession.status == "OPEN"
    ).first()
    
    if not active_session:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No hay turno de caja abierto. Debe abrir caja para vender."
        )

    # 1. Validar Cliente
    customer = db.query(User).filter(User.rut == sale_in.rut_cliente).first()
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con RUT {sale_in.rut_cliente} no encontrado",
        )

    # 2. Validar Productos y Calcular Totales
    total_neto = Decimal("0")
    sale_details = []
    stock_movements = []

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
        
        # Validar Stock
        if product.controla_stock:
            if product.stock_actual < item.cantidad:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Stock insuficiente para {product.nombre}. Disponible: {product.stock_actual}, Solicitado: {item.cantidad}"
                )
            
            # Descontar Stock y Registrar Movimiento (se guardará al hacer commit de la venta)
            product.stock_actual -= item.cantidad
            
            # Importar localmente para evitar dependencias circulares
            from app.models.inventory import StockMovement
            
            movement = StockMovement(
                product_id=product.id,
                user_id=user_id, # Usuario caja
                tipo="SALIDA",
                motivo="VENTA",
                cantidad=item.cantidad,
                description=f"Venta en proceso", 
            )
            # No hacemos db.add(movement) aquí, lo vinculamos a la venta
            stock_movements.append(movement)

        precio_unitario = product.precio_neto
        cantidad = item.cantidad
        subtotal_linea = precio_unitario * cantidad
        total_neto += subtotal_linea

        detail_obj = SaleDetail(
            product_id=product.id,
            cantidad=cantidad,
            precio_unitario=precio_unitario,
            subtotal=subtotal_linea,
            descuento=0,
        )
        sale_details.append(detail_obj)

    # 3. Calcular IVA y Total
    iva = total_neto * Decimal("0.19")
    total = total_neto + iva

    # Validar Pagos
    total_payments = sum(p.amount for p in sale_in.payments)
    # Permitimos margen de error de 1 peso por redondeo? O exacto?
    # Por ahora exacto o mayor (si es efectivo da vuelto, pero no registramos vuelto aun)
    if total_payments < total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Monto de pagos ({total_payments}) inferior al total de la venta ({total})"
        )

    # 4. Asignar Folio (CAF según tipo de DTE)
    tipo = sale_in.tipo_dte
    caf = db.query(CAF).filter(
        CAF.tipo_documento == tipo,
        CAF.ultimo_folio_usado < CAF.folio_hasta,
    ).order_by(CAF.id.asc()).first()

    if not caf:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"No hay folios disponibles para tipo DTE {tipo}.",
        )

    nuevo_folio = caf.ultimo_folio_usado + 1
    caf.ultimo_folio_usado = nuevo_folio
    db.add(caf)

    # 5. Crear Venta
    new_sale = Sale(
        user_id=customer.id,
        folio=nuevo_folio,
        tipo_dte=tipo,
        monto_neto=total_neto,
        iva=iva,
        monto_total=total,
        descripcion=sale_in.descripcion,
        details=sale_details,
        stock_movements=stock_movements, # Vinculación automática
    )
    db.add(new_sale)
    db.flush()  # Genera new_sale.id sin hacer commit todavía

    # 5.1 Guardar Pagos
    for payment_in in sale_in.payments:
        pm = SalePayment(
            sale_id=new_sale.id,
            payment_method_id=payment_in.payment_method_id,
            amount=payment_in.amount,
            transaction_code=payment_in.transaction_code,
        )
        db.add(pm)

    # 5.2 Actualizar sale_id en movimientos de stock (Si los hubo)
    # Buscamos los movimientos en la sesión que tengan sale_id nulo y sean de estos productos?
    # Mas facil: Lo hacemos arriba si tuvieramos el ID, pero no lo teniamos.
    # Hack: Iterar details y buscar movimiento? 
    # Mejor: Al crear movement arriba, no teniamos sale_id.
    # Solucion: Flush sale primero (ya hecho) y luego recorrer items de nuevo? No eficiente.
    # Solucion correcta: Agregar movements a una lista temporal y asignarle sale_id aqui.
    
    # Re-implements stock logic inside loop? No.
    # Just set sale_id on flush? SQLAlchemy handles relationships?
    # If we added `sale.stock_movements.append(movement)`?
    
    # 6. Generar XML DTE y guardarlo atómicamente
    try:
        issuer = db.query(Issuer).first()
        xml_content = render_factura_xml(new_sale, issuer, customer) if issuer else ""

        dte = DTE(
            sale_id=new_sale.id,
            tipo_dte=tipo,
            folio=nuevo_folio,
            xml_content=xml_content,
            estado_sii="GENERADO",
        )
        db.add(dte)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al generar el DTE. Transacción revertida.",
        )

    # Eager load para respuesta
    sale_loaded = (
        db.query(Sale)
        .options(
            joinedload(Sale.user),
            joinedload(Sale.details).joinedload(SaleDetail.product),
        )
        .filter(Sale.id == new_sale.id)
        .one()
    )

    return sale_loaded


# ── PDF Preview ──────────────────────────────────────────────────────


@router.get("/{sale_id}/pdf", response_class=HTMLResponse)
def get_sale_pdf(sale_id: int, db: Session = Depends(get_db)):
    """
    Genera una vista previa HTML de la factura (lista para imprimir como PDF).
    """

    # Cargar venta con relaciones
    sale = (
        db.query(Sale)
        .options(
            joinedload(Sale.user),
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

    # Renderizar HTML
    template = _html_env.get_template("factura_print.html")
    html_content = template.render(
        sale=sale,
        issuer=issuer,
        customer=sale.user,
    )

    return HTMLResponse(content=html_content)

