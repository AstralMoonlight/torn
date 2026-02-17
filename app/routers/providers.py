"""Router para gestión de Proveedores."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.provider import Provider
from app.schemas import ProviderCreate, ProviderOut, ProviderUpdate

router = APIRouter(prefix="/providers", tags=["providers"])


@router.post("/", response_model=ProviderOut, status_code=status.HTTP_201_CREATED)
def create_provider(provider: ProviderCreate, db: Session = Depends(get_db)):
    """Registra un nuevo proveedor."""
    existing = db.query(Provider).filter(Provider.rut == provider.rut).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un proveedor con RUT {provider.rut}",
        )
    
    db_provider = Provider(**provider.model_dump())
    db.add(db_provider)
    db.commit()
    db.refresh(db_provider)
    return db_provider


@router.get("/", response_model=List[ProviderOut])
def list_providers(db: Session = Depends(get_db)):
    """Lista todos los proveedores activos."""
    return db.query(Provider).filter(Provider.is_active == True).all()


@router.get("/{provider_id}", response_model=ProviderOut)
def get_provider(provider_id: int, db: Session = Depends(get_db)):
    """Obtiene un proveedor por ID."""
    provider = db.query(Provider).filter(Provider.id == provider_id).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return provider


@router.put("/{provider_id}", response_model=ProviderOut)
def update_provider(provider_id: int, provider_in: ProviderUpdate, db: Session = Depends(get_db)):
    """Actualiza datos de un proveedor."""
    provider = db.query(Provider).filter(Provider.id == provider_id).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    
    update_data = provider_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(provider, field, value)
    
    db.commit()
    db.refresh(provider)
    return provider


@router.delete("/{provider_id}")
def delete_provider(provider_id: int, db: Session = Depends(get_db)):
    """Desactiva un proveedor (soft-delete lógico)."""
    provider = db.query(Provider).filter(Provider.id == provider_id).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    
    provider.is_active = False
    db.commit()
    return {"detail": "Proveedor desactivado"}
