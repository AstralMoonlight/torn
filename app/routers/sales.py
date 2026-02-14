"""Router para gestión de Ventas (Facturas)."""

from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.dte import CAF
from app.models.product import Product
from app.models.sale import Sale, SaleDetail
from app.models.user import User
from app.schemas import SaleCreate, SaleOut

router = APIRouter(prefix="/sales", tags=["sales"])


@router.post("/", response_model=SaleOut, status_code=status.HTTP_201_CREATED)
def create_sale(sale_in: SaleCreate, db: Session = Depends(get_db)):
    """
    Registra una nueva venta (Factura Electrónica).
    - Valida cliente y productos.
    - Calcula montos a partir del precio neto actual de los productos.
    - Asigna folio desde el CAF (tipo 33).
    """

    # 1. Validar Cliente
    customer = db.query(User).filter(User.rut == sale_in.rut_cliente).first()
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con RUT {sale_in.rut_cliente} no encontrado",
        )

    # 2. Validar Productos y Calcular Totales
    total_neto = 0
    sale_details = []

    for item in sale_in.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Producto ID {item.product_id} no encontrado",
            )
        
        # Validar si está activo (opcional, pero buena práctica)
        if not product.is_active:
             raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Producto {product.nombre} (SKU {product.codigo_interno}) no está activo",
            )

        # Cálculos de línea
        precio_unitario = product.precio_neto
        cantidad = item.cantidad
        subtotal_linea = precio_unitario * cantidad

        total_neto += subtotal_linea

        # Preparar objeto de detalle (todavía no guardamos)
        detail_obj = SaleDetail(
            product_id=product.id,
            cantidad=cantidad,
            precio_unitario=precio_unitario,
            subtotal=subtotal_linea,
            descuento=0  # Por ahora sin descuento
        )
        sale_details.append(detail_obj)

    # 3. Calcular IVA y Total
    iva = total_neto * Decimal("0.19")
    total = total_neto + iva

    # 4. Asignar Folio (CAF tipo 33 = Factura)
    # Buscamos un CAF que tenga cupo
    caf = db.query(CAF).filter(
        CAF.tipo_documento == 33,
        CAF.ultimo_folio_usado < CAF.folio_hasta
    ).order_by(CAF.id.asc()).first()

    if not caf:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No hay folios disponibles (CAF agotado o inexistente) para Facturas (33).",
        )
    
    nuevo_folio = caf.ultimo_folio_usado + 1
    
    # Actualizar CAF
    caf.ultimo_folio_usado = nuevo_folio
    db.add(caf)

    # 5. Crear Venta y Guardar
    new_sale = Sale(
        user_id=customer.id,
        folio=nuevo_folio,
        monto_neto=total_neto,
        iva=iva,
        monto_total=total,
        descripcion=sale_in.descripcion,
        details=sale_details # SQLAlchemy maneja la relación y FKs
    )

    db.add(new_sale)
    db.commit()
    db.refresh(new_sale)

    return new_sale
