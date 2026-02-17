"""Router para gestión de Compras (Ingreso de Mercadería)."""

from pathlib import Path
from typing import List
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.purchase import Purchase, PurchaseDetail
from app.models.product import Product
from app.models.inventory import StockMovement
from app.models.issuer import Issuer
from app.schemas import PurchaseCreate, PurchaseOut

router = APIRouter(prefix="/purchases", tags=["purchases"])

# ── Jinja2 para plantillas HTML ──────────────────────────────────────
_HTML_TEMPLATES = Path(__file__).resolve().parent.parent / "templates" / "html"
_html_env = Environment(
    loader=FileSystemLoader(str(_HTML_TEMPLATES)),
    autoescape=True,
)


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
        
        # VALIDACIÓN: No permitir compras a productos que tienen variantes (son padres)
        has_variants = db.query(Product).filter(Product.parent_id == product.id).first()
        if has_variants:
            db.rollback()
            raise HTTPException(
                status_code=400, 
                detail=f"El producto '{product.nombre}' tiene variantes. Debe ingresar la compra a la variante específica."
            )
        
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


@router.get("/{purchase_id}", response_model=PurchaseOut)
def get_purchase(purchase_id: int, db: Session = Depends(get_db)):
    """Obtiene el detalle de una compra específica."""
    db_purchase = db.query(Purchase).filter(Purchase.id == purchase_id).first()
    if not db_purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")
    return db_purchase


@router.put("/{purchase_id}", response_model=PurchaseOut)
def update_purchase(purchase_id: int, purchase_in: PurchaseCreate, db: Session = Depends(get_db)):
    """Actualiza una compra y ajusta el stock según la diferencia."""
    db_purchase = db.query(Purchase).filter(Purchase.id == purchase_id).first()
    if not db_purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")

    # 1. Mapear cantidades actuales para comparar después
    old_items_map = {d.product_id: d.cantidad for d in db_purchase.details}

    # 2. Reversar stock de los items antiguos antes de aplicar los nuevos
    for product_id, old_qty in old_items_map.items():
        prod = db.query(Product).filter(Product.id == product_id).first()
        if prod and prod.controla_stock:
            prod.stock_actual -= old_qty
            # Registrar movimiento de ajuste (reverso temporal)
            db.add(StockMovement(
                product_id=prod.id,
                tipo="SALIDA",
                motivo="AJUSTE",
                cantidad=old_qty,
                balance_after=prod.stock_actual,
                description=f"Ajuste por edición de Compra #{db_purchase.id}"
            ))

    # 3. Limpiar detalles antiguos
    for d in db_purchase.details:
        db.delete(d)
    db.flush()

    # 4. Actualizar encabezado
    db_purchase.provider_id = purchase_in.provider_id
    db_purchase.folio = purchase_in.folio
    db_purchase.tipo_documento = purchase_in.tipo_documento
    db_purchase.observacion = purchase_in.observacion
    if purchase_in.fecha_compra:
        db_purchase.fecha_compra = purchase_in.fecha_compra

    total_neto = Decimal(0)

    # 5. Procesar nuevos ítems y aplicar stock nuevo
    for item in purchase_in.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            db.rollback()
            raise HTTPException(status_code=404, detail=f"Producto {item.product_id} no encontrado")

        subtotal = item.cantidad * item.precio_costo_unitario
        total_neto += subtotal

        detail = PurchaseDetail(
            purchase_id=db_purchase.id,
            product_id=item.product_id,
            cantidad=item.cantidad,
            precio_costo_unitario=item.precio_costo_unitario,
            subtotal=subtotal
        )
        db.add(detail)

        # Actualizar stock y costo
        product.costo_unitario = item.precio_costo_unitario
        if product.controla_stock:
            product.stock_actual += item.cantidad
            db.add(StockMovement(
                product_id=product.id,
                tipo="ENTRADA",
                motivo="COMPRA",
                cantidad=item.cantidad,
                balance_after=product.stock_actual,
                description=f"Actualización Compra #{db_purchase.id} (Folio {db_purchase.folio or 'S/N'})"
            ))

    # 6. Recalcular totales
    db_purchase.monto_neto = total_neto
    if db_purchase.tipo_documento == "FACTURA":
        db_purchase.iva = total_neto * Decimal("0.19")
    else:
        db_purchase.iva = Decimal(0)
    db_purchase.monto_total = db_purchase.monto_neto + db_purchase.iva

    db.commit()
    db.refresh(db_purchase)
    return db_purchase


@router.delete("/{purchase_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase(purchase_id: int, db: Session = Depends(get_db)):
    """Elimina una compra y reversa el stock."""
    db_purchase = db.query(Purchase).filter(Purchase.id == purchase_id).first()
    if not db_purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")

    # Reversar stock
    for detail in db_purchase.details:
        product = db.query(Product).filter(Product.id == detail.product_id).first()
        if product and product.controla_stock:
            product.stock_actual -= detail.cantidad
            # Registrar salida por eliminación
            db.add(StockMovement(
                product_id=product.id,
                tipo="SALIDA",
                motivo="AJUSTE",
                cantidad=detail.cantidad,
                balance_after=product.stock_actual,
                description=f"Eliminación Compra #{db_purchase.id} (Folio {db_purchase.folio or 'S/N'})"
            ))

    db.delete(db_purchase)
    db.commit()
    return None


@router.get("/", response_model=List[PurchaseOut])
def list_purchases(db: Session = Depends(get_db)):
    """Lista las compras registradas."""
    return db.query(Purchase).order_by(Purchase.id.desc()).all()


@router.get("/{purchase_id}/pdf", response_class=HTMLResponse)
def get_purchase_pdf(purchase_id: int, db: Session = Depends(get_db)):
    """Generat HTML preview of the purchase for printing."""
    purchase = (
        db.query(Purchase)
        .options(
            joinedload(Purchase.provider),
            joinedload(Purchase.details).joinedload(PurchaseDetail.product),
        )
        .filter(Purchase.id == purchase_id)
        .first()
    )

    if not purchase:
        raise HTTPException(status_code=404, detail="Compra no encontrada")

    issuer = db.query(Issuer).first()
    if not issuer:
        raise HTTPException(status_code=404, detail="Emisor no configurado. Use PUT /issuer/ primero.")

    template = _html_env.get_template("purchase_print.html")
    html_content = template.render(
        purchase=purchase,
        issuer=issuer,
        provider=purchase.provider,
    )

    return HTMLResponse(content=html_content)
