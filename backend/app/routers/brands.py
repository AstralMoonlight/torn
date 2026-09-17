"""Router para gestión de Marcas."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies.tenant import get_tenant_db
from app.models.brand import Brand
from app.schemas import BrandCreate, BrandOut, BrandUpdate

router = APIRouter(prefix="/brands", tags=["brands"])


@router.post("/", response_model=BrandOut, status_code=status.HTTP_201_CREATED)
def create_brand(brand: BrandCreate, db: Session = Depends(get_tenant_db)):
    """Crea una nueva marca."""
    existing = db.query(Brand).filter(Brand.name == brand.name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe una marca con nombre '{brand.name}'"
        )
    
    db_brand = Brand(name=brand.name)
    db.add(db_brand)
    db.commit()
    db.refresh(db_brand)
    return db_brand


@router.get("/", response_model=List[BrandOut])
def list_brands(db: Session = Depends(get_tenant_db)):
    """Lista todas las marcas."""
    return db.query(Brand).order_by(Brand.name).all()


@router.put("/{brand_id}", response_model=BrandOut)
def update_brand(brand_id: int, brand_update: BrandUpdate, db: Session = Depends(get_tenant_db)):
    """Actualiza una marca existente."""
    db_brand = db.query(Brand).filter(Brand.id == brand_id).first()
    if not db_brand:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Marca con ID {brand_id} no encontrada"
        )
    
    if brand_update.name:
        # Check duplicate name
        existing = db.query(Brand).filter(Brand.name == brand_update.name).first()
        if existing and existing.id != brand_id:
             raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe una marca con nombre '{brand_update.name}'"
            )
        db_brand.name = brand_update.name
    
    db.commit()
    db.refresh(db_brand)
    return db_brand


@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_brand(brand_id: int, db: Session = Depends(get_tenant_db)):
    """Elimina una marca."""
    db_brand = db.query(Brand).filter(Brand.id == brand_id).first()
    if not db_brand:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Marca con ID {brand_id} no encontrada"
        )
    
    # Check if used in products
    # We need to import Product model to check this relationship if not cascaded, 
    # but for now let's assume DB constraints will handle it or we check manually.
    # Ideally: from app.models.product import Product
    # if db.query(Product).filter(Product.brand_id == brand_id).first(): ...
    # But let's keep simple first, let SQLAlchemy raise IntegrityError if FK constraint exists.
    
    db.delete(db_brand)
    db.commit()
    return None
