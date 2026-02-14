"""Router para gestión de Productos."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product import Product
from app.schemas import ProductCreate, ProductOut

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
    """Lista todos los productos activos."""
    return db.query(Product).filter(Product.is_active == True).all()  # noqa: E712


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
