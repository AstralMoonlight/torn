"""Router para gestión de Compras (Ingreso de Mercadería)."""

from typing import List
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.purchase import Purchase, PurchaseDetail
from app.models.product import Product
from app.models.inventory import StockMovement
from app.schemas import PurchaseCreate, PurchaseOut

router = APIRouter(prefix="/purchases", tags=["purchases"])


@router.post("/", response_model=PurchaseOut, status_code=status.HTTP_201_CREATED)
def create_purchase(purchase_in: PurchaseCreate, db: Session = Depends(get_db)):
    """Registra una compra y actualiza stock/costos de forma atómica."""
    
    # 1. Crear encabezado
    db_purchase = Purchase(
        provider_id=purchase_in.provider_id,
        folio=purchase_in.folio,
        tipo_documento=purchase_in.tipo_documento,
        observacion=purchase_in.observacion,
        monto_neto=0,
        iva=0,
        monto_total=0
    )
    
    if purchase_in.fecha_compra:
        db_purchase.fecha_compra = purchase_in.fecha_compra
    
    db.add(db_purchase)
    db.flush()  # Para obtener el ID

    total_neto = Decimal(0)
    
    # 2. Procesar ítems
    for item in purchase_in.items:
        # Buscar producto
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            db.rollback()
            raise HTTPException(status_code=404, detail=f"Producto {item.product_id} no encontrado")
        
        # Calcular subtotal del ítem
        subtotal = item.cantidad * item.precio_costo_unitario
        total_neto += subtotal
        
        # Crear detalle de compra
        detail = PurchaseDetail(
            purchase_id=db_purchase.id,
            product_id=item.product_id,
            cantidad=item.cantidad,
            precio_costo_unitario=item.precio_costo_unitario,
            subtotal=subtotal
        )
        db.add(detail)
        
        # ACTUALIZAR PRODUCTO: Costo y Stock
        # Usamos el precio de la última compra como costo unitario
        product.costo_unitario = item.precio_costo_unitario
        
        if product.controla_stock:
            product.stock_actual += item.cantidad
            
            # Registrar Movimiento de Inventario
            movement = StockMovement(
                product_id=product.id,
                tipo="ENTRADA",
                motivo="COMPRA",
                cantidad=item.cantidad,
                balance_after=product.stock_actual,
                description=f"Compra Folio {db_purchase.folio or 'S/N'}"
            )
            db.add(movement)

    # 3. Finalizar totales (asumiendo IVA 19% si es Factura)
    db_purchase.monto_neto = total_neto
    if db_purchase.tipo_documento == "FACTURA":
        db_purchase.iva = total_neto * Decimal("0.19")
    else:
        db_purchase.iva = Decimal(0)
        
    db_purchase.monto_total = db_purchase.monto_neto + db_purchase.iva
    
    db.commit()
    db.refresh(db_purchase)
    return db_purchase


@router.get("/", response_model=List[PurchaseOut])
def list_purchases(db: Session = Depends(get_db)):
    """Lista las compras registradas."""
    return db.query(Purchase).order_by(Purchase.id.desc()).all()
