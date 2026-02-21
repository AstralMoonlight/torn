"""Router para gestión de Productos."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func

from app.dependencies.tenant import get_tenant_db
from app.models.product import Product
from app.schemas import (
    ProductCreate,
    ProductCreateWithVariants,
    ProductOut,
    ProductUpdate,
)

router = APIRouter(prefix="/products", tags=["products"])


# ── Utilidades de auto-generación ─────────────────────────────────────


def generate_sku(db: Session, prefix: str = "PROD") -> str:
    """Genera un SKU único auto-incremental.

    Formato: PROD-00001, PROD-00002, etc.
    """
    # Find highest existing numeric suffix for this prefix
    like_pattern = f"{prefix}-%"
    last = (
        db.query(Product.codigo_interno)
        .filter(Product.codigo_interno.like(like_pattern))
        .order_by(Product.id.desc())
        .first()
    )

    if last and last[0]:
        try:
            num = int(last[0].split("-")[-1]) + 1
        except (ValueError, IndexError):
            num = db.query(sql_func.count(Product.id)).scalar() + 1
    else:
        num = 1

    return f"{prefix}-{num:05d}"


def generate_ean13(product_id: int) -> str:
    """Genera un código EAN-13 para uso interno.

    Usa el prefijo GS1 '200' (reservado para uso interno/in-store).
    Formato: 200 + 9 dígitos del ID (con padding) + 1 dígito verificador.
    """
    body = f"200{product_id:09d}"  # 12 dígitos
    # Calcular dígito verificador EAN-13
    total = 0
    for i, digit in enumerate(body):
        weight = 1 if i % 2 == 0 else 3
        total += int(digit) * weight
    check = (10 - (total % 10)) % 10
    return f"{body}{check}"


# ── Endpoints ─────────────────────────────────────────────────────────


@router.post("/", response_model=ProductOut, status_code=status.HTTP_201_CREATED,
             summary="Crear Producto Simple",
             description="Agrega un nuevo producto al catálogo. SKU y código de barras se auto-generan si no se proporcionan.")
def create_product(product: ProductCreate, db: Session = Depends(get_tenant_db)):
    """Registra un nuevo producto en la base de datos."""
    data = product.model_dump()

    # Auto-generate SKU if not provided
    if not data.get("codigo_interno"):
        data["codigo_interno"] = generate_sku(db)

    # Check uniqueness
    existing = db.query(Product).filter(
        Product.codigo_interno == data["codigo_interno"]
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un producto con código {data['codigo_interno']}",
        )

    db_product = Product(**data)
    db.add(db_product)
    db.commit()
    db.refresh(db_product)

    # Auto-generate barcode if not provided (only for simple products, not variants)
    if not db_product.codigo_barras and not db_product.parent_id:
        db_product.codigo_barras = generate_ean13(db_product.id)
        db.commit()
        db.refresh(db_product)

    return db_product


@router.post("/with-variants", response_model=ProductOut, status_code=status.HTTP_201_CREATED,
             summary="Crear Producto con Variantes",
             description="Crea un producto padre y sus variantes en un solo request.")
def create_product_with_variants(payload: ProductCreateWithVariants, db: Session = Depends(get_tenant_db)):
    """Crea un producto padre con variantes simplificadas."""

    # 1. Create parent product
    parent_sku = payload.codigo_interno or generate_sku(db)

    existing = db.query(Product).filter(Product.codigo_interno == parent_sku).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un producto con código {parent_sku}",
        )

    parent = Product(
        codigo_interno=parent_sku,
        nombre=payload.nombre,
        descripcion=payload.descripcion,
        precio_neto=payload.precio_neto,
        unidad_medida=payload.unidad_medida,
        controla_stock=False,  # Parent doesn't control stock directly
        stock_actual=0,
        stock_minimo=payload.stock_minimo,
        brand_id=payload.brand_id,
        tax_id=payload.tax_id,
    )
    db.add(parent)
    db.commit()
    db.refresh(parent)

    # If no variants, auto-generate barcode for parent
    if not payload.variants:
        if not payload.codigo_barras:
            parent.codigo_barras = generate_ean13(parent.id)
        else:
            parent.codigo_barras = payload.codigo_barras
        db.commit()
        db.refresh(parent)
    else:
        # 2. Create each variant as child
        for idx, v in enumerate(payload.variants, 1):
            variant_sku = v.codigo_interno or f"{parent_sku}-V{idx:02d}"

            # Check variant SKU uniqueness
            if db.query(Product).filter(Product.codigo_interno == variant_sku).first():
                variant_sku = f"{parent_sku}-V{idx:02d}-{parent.id}"

            variant = Product(
                codigo_interno=variant_sku,
                nombre=v.nombre,
                descripcion=v.descripcion,
                precio_neto=v.precio_neto,
                controla_stock=payload.controla_stock,  # Inherited from parent
                stock_actual=v.stock_actual,
                stock_minimo=0,
                parent_id=parent.id,
                brand_id=payload.brand_id,
                tax_id=payload.tax_id,  # Inherited from parent
            )
            db.add(variant)
            db.commit()
            db.refresh(variant)

            # Auto-generate barcode for variant if not provided
            if not v.codigo_barras:
                variant.codigo_barras = generate_ean13(variant.id)
            else:
                variant.codigo_barras = v.codigo_barras
            db.commit()

    # Refresh parent to load variants relationship
    db.refresh(parent)
    return parent


@router.get("/", response_model=List[ProductOut])
def list_products(db: Session = Depends(get_tenant_db)):
    """Lista todos los productos activos (no eliminados)."""
    return db.query(Product).filter(
        Product.is_deleted == False  # noqa: E712
    ).order_by(Product.id.desc()).all()


@router.put("/{product_id}", response_model=ProductOut,
            summary="Actualizar Producto",
            description="Actualiza parcialmente un producto.")
def update_product(product_id: int, product_in: ProductUpdate, db: Session = Depends(get_tenant_db)):
    """Actualiza un producto existente."""
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Producto no encontrado",
        )

    update_data = product_in.model_dump(exclude_unset=True)
    
    # Validation unique code if changing
    if "codigo_interno" in update_data and update_data["codigo_interno"] != product.codigo_interno:
        existing = db.query(Product).filter(
            Product.codigo_interno == update_data["codigo_interno"]
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe un producto con código {update_data['codigo_interno']}",
            )

    for field, value in update_data.items():
        setattr(product, field, value)

    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT,
               summary="Eliminar Producto",
               description="Realiza un borrado lógico del producto y sus variantes.")
def delete_product(product_id: int, db: Session = Depends(get_tenant_db)):
    """Soft delete de un producto y sus variantes."""
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Producto no encontrado",
        )

    # Soft delete parent
    product.is_deleted = True
    product.is_active = False  # Also deactivate
    
    # Soft delete variants
    variants = db.query(Product).filter(Product.parent_id == product_id).all()
    for variant in variants:
        variant.is_deleted = True
        variant.is_active = False

    db.commit()
    return None


@router.get("/{codigo}", response_model=ProductOut,
             summary="Buscar Producto",
             description="Busca un producto por su SKU.")
def get_product_by_sku(codigo: str, db: Session = Depends(get_tenant_db)):
    """Busca un producto por su código interno (SKU)."""
    product = db.query(Product).filter(Product.codigo_interno == codigo).first()
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró un producto con código {codigo}",
        )
    return product
