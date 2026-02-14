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
    )
    db.add(new_sale)
    db.flush()  # Genera new_sale.id sin hacer commit todavía

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

