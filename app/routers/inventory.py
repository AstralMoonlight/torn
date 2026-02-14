"""Router para gestión de Inventario."""

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product import Product
from app.schemas import ProductOut

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("/", response_model=List[ProductOut])
def get_inventory(db: Session = Depends(get_db)):
    """
    Obtiene el estado actual del inventario.
    
    Retorna una lista de todos los productos activos con sus niveles de stock actuales,
    incluyendo stock mínimo y bandera de control de stock.
    """
    products = db.query(Product).filter(Product.is_active == True).all()
    return products
