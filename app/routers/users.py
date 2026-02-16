from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])

# --- Schemas ---
class UserBase(BaseModel):
    rut: str
    razon_social: str
    email: Optional[str] = None
    role: str = "SELLER"

class UserCreate(UserBase):
    pass

class UserUpdate(BaseModel):
    razon_social: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None

class UserOut(UserBase):
    id: int
    is_active: bool

    class Config:
        from_attributes = True

# --- Endpoints ---

@router.get("/sellers", response_model=List[UserOut], summary="Listar Vendedores")
def list_sellers(db: Session = Depends(get_db)):
    """Lista todos los usuarios con rol SELLER activos."""
    return db.query(User).filter(User.role == "SELLER", User.is_active == True).all()

@router.get("/", response_model=List[UserOut], summary="Listar Todos los Usuarios")
def list_all_users(role: Optional[str] = None, db: Session = Depends(get_db)):
    """Lista usuarios, opcionalmente filtrados por rol."""
    query = db.query(User)
    if role:
        query = query.filter(User.role == role)
    return query.all()

@router.post("/", response_model=UserOut, status_code=status.HTTP_201_CREATED, summary="Crear Usuario (Vendedor)")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    """Crea un nuevo usuario (Vendedor/Admin/etc)."""
    # Validar RUT único
    if db.query(User).filter(User.rut == user.rut).first():
        raise HTTPException(status_code=409, detail="RUT ya existe")
    
    db_user = User(**user.model_dump())
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.put("/{user_id}", response_model=UserOut, summary="Actualizar Usuario")
def update_user(user_id: int, user_update: UserUpdate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    update_data = user_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_user, key, value)
    
    db.commit()
    db.refresh(db_user)
    return db_user

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Desactivar Usuario")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    """Soft delete: marca el usuario como inactivo."""
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    db_user.is_active = False
    db.commit()
    return None
