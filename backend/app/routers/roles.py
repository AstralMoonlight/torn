from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.models.user import Role
from app.schemas import RoleOut, RoleUpdate
from app.dependencies.tenant import require_admin, get_tenant_db

router = APIRouter(prefix="/roles", tags=["roles"])

@router.get("/", response_model=List[RoleOut], dependencies=[Depends(require_admin)])
def list_roles(db: Session = Depends(get_tenant_db)):
    """Lista todos los roles disponibles."""
    return db.query(Role).all()

@router.get("/{role_id}", response_model=RoleOut, dependencies=[Depends(require_admin)])
def get_role(role_id: int, db: Session = Depends(get_tenant_db)):
    """Obtiene detalles de un rol específico."""
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return role

@router.put("/{role_id}", response_model=RoleOut, dependencies=[Depends(require_admin)])
def update_role(role_id: int, role_in: RoleUpdate, db: Session = Depends(get_tenant_db)):
    """Actualiza la configuración y permisos de un rol."""
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    
    update_data = role_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(role, field, value)
    
    db.commit()
    db.refresh(role)
    return role
