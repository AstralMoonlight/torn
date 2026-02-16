"""Router para gestión de Productos."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product import Product
from app.schemas import ProductCreate, ProductOut, ProductUpdate

router = APIRouter(prefix="/products", tags=["products"])


@router.post("/", response_model=ProductOut, status_code=status.HTTP_201_CREATED,
             summary="Crear Producto",
             description="Agrega un nuevo producto al catálogo.")
def create_product(product: ProductCreate, db: Session = Depends(get_db)):
    """Registra un nuevo producto en la base de datos.
    
    Args:
        product (ProductCreate): Datos del producto.
        db (Session): Sesión DB.
        
    Returns:
        ProductOut: Producto creado.
        
    Raises:
        HTTPException(409): Si ya existe un producto con el mismo código interno.
    """
    existing = db.query(Product).filter(
        Product.codigo_interno == product.codigo_interno
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un producto con código {product.codigo_interno}",
        )

    db_product = Product(**product.model_dump())
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product


@router.get("/", response_model=List[ProductOut])
def list_products(db: Session = Depends(get_db)):
    """Lista todos los productos activos (no eliminados)."""
    return db.query(Product).filter(
        Product.is_deleted == False  # noqa: E712
    ).order_by(Product.id.desc()).all()


@router.put("/{product_id}", response_model=ProductOut,
            summary="Actualizar Producto",
            description="Actualiza parcialmente un producto.")
def update_product(product_id: int, product_in: ProductUpdate, db: Session = Depends(get_db)):
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
def delete_product(product_id: int, db: Session = Depends(get_db)):
    """Soft delete de un producto y sus variantes."""
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Producto no encontrado",
        )

    # Soft delete parent
    product.is_deleted = True
    product.is_active = False # Also deactivate
    
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
def get_product_by_sku(codigo: str, db: Session = Depends(get_db)):
    """Busca un producto por su código interno (SKU).
    
    Args:
        codigo (str): SKU del producto.
        db (Session): Sesión DB.
        
    Returns:
        ProductOut: Producto encontrado.
        
    Raises:
        HTTPException(404): Si no existe el producto.
    """

    product = db.query(Product).filter(Product.codigo_interno == codigo).first()
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró un producto con código {codigo}",
        )
    return product
