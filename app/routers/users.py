from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User, Role
from app.models.saas import SaaSUser, TenantUser
from app.schemas import UserCreate, UserUpdate, UserOut
from app.dependencies.tenant import get_tenant_db, get_global_db, get_current_tenant_user
from app.utils.security import get_password_hash

router = APIRouter(prefix="/users", tags=["users"])

# --- Endpoints ---

@router.get("/sellers", response_model=List[UserOut], summary="Listar Vendedores")
def list_sellers(db: Session = Depends(get_tenant_db)):
    """Lista todos los usuarios con rol SELLER activos."""
    return db.query(User).filter(User.role == "SELLER", User.is_active == True).all()

@router.get("/", response_model=List[UserOut], summary="Listar Todos los Usuarios")
def list_all_users(
    role: Optional[str] = None, 
    db: Session = Depends(get_tenant_db),
    global_user_info: TenantUser = Depends(get_current_tenant_user),
    global_db: Session = Depends(get_global_db)
):
    """Lista usuarios del esquema local (Solo activos)."""
    query = db.query(User).filter(User.is_active == True)
    if role:
        query = query.filter(User.role == role)
    local_users = query.all()

    # Para saber quién es el dueño real si lo necesitamos (ej. el primer admin)
    owner_email = None
    first_admin = global_db.query(TenantUser).filter(
        TenantUser.tenant_id == global_user_info.tenant_id,
        TenantUser.role_name == "ADMINISTRADOR"
    ).order_by(TenantUser.id.asc()).first()
    
    if first_admin and first_admin.user:
        owner_email = first_admin.user.email

    results = []
    
    for u in local_users:
        results.append(UserOut(
            id=u.id,
            rut=u.rut,
            email=u.email,
            name=u.full_name or u.email,
            role=u.role,
            role_id=u.role_id,
            is_active=u.is_active,
            is_owner=(u.email == owner_email),
            role_obj=u.role_obj
        ))

    return results

@router.post("/", response_model=UserOut, status_code=status.HTTP_201_CREATED, summary="Crear Usuario")
def create_user(
    user: UserCreate, 
    db: Session = Depends(get_tenant_db),
    global_user_info: TenantUser = Depends(get_current_tenant_user),
    global_db: Session = Depends(get_global_db)
):
    """Crea un nuevo usuario (Vendedor/Admin/etc) tanto a nivel Global como Local."""
    if not user.email:
        raise HTTPException(status_code=400, detail="El Email es requerido para el login")

    # 1. Validar Email único a nivel global
    saas_user = global_db.query(SaaSUser).filter(SaaSUser.email == user.email).first()
    if not saas_user:
        if not user.password:
            raise HTTPException(status_code=400, detail="Se requiere una contraseña para nuevos usuarios")
            
        saas_user = SaaSUser(
            email=user.email,
            full_name=user.full_name,
            hashed_password=get_password_hash(user.password),
            is_active=True,
            is_superuser=False
        )
        global_db.add(saas_user)
        global_db.commit()
        global_db.refresh(saas_user)
        
    # 2. Vincular usuario global al tenant actual
    tenant_user_link = global_db.query(TenantUser).filter(
        TenantUser.user_id == saas_user.id,
        TenantUser.tenant_id == global_user_info.tenant_id
    ).first()
    
    # Resolver nombre de rol
    role_name = "VENDEDOR"
    if user.role_id:
        db_role = db.query(Role).filter(Role.id == user.role_id).first()
        if db_role:
            role_name = db_role.name
            
    if not tenant_user_link:
        tenant_user_link = TenantUser(
            tenant_id=global_user_info.tenant_id,
            user_id=saas_user.id,
            role_name=role_name,
            is_active=True
        )
        global_db.add(tenant_user_link)
        global_db.commit()

    # 3. Validar RUT único si viene a nivel local
    if user.rut and db.query(User).filter(User.rut == user.rut).first():
        raise HTTPException(status_code=409, detail="El RUT ya existe en esta sucursal")
        
    # 4. Crear reflejo local del usuario
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user:
        user_data = user.model_dump(exclude={"password"})
        db_user = User(**user_data)
        if user.password:
            db_user.password_hash = saas_user.hashed_password
            
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        
    return db_user

@router.put("/{user_id}", response_model=UserOut, summary="Actualizar Usuario")
def update_user(
    user_id: int, 
    user_update: UserUpdate, 
    db: Session = Depends(get_tenant_db),
    global_user_info: TenantUser = Depends(get_current_tenant_user),
    global_db: Session = Depends(get_global_db)
):
    # Caso 1: Es el dueño (ID global)
    if global_user_info.user_id == user_id:
        # El dueño solo puede editar su nombre y password a través de este modulo (SaaSUser)
        saas_user = global_db.query(SaaSUser).filter(SaaSUser.id == user_id).first()
        if not saas_user:
             raise HTTPException(status_code=404, detail="Administrador no encontrado")
        
        if user_update.full_name:
            saas_user.full_name = user_update.full_name
        if user_update.password:
            saas_user.hashed_password = get_password_hash(user_update.password)
        
        global_db.commit()
        
        return UserOut(
            id=saas_user.id,
            email=saas_user.email,
            name=saas_user.full_name,
            role="ADMINISTRADOR",
            is_active=True,
            is_owner=True
        )

    # Caso 2: Usuario Local
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
        
    old_email = db_user.email
    
    update_data = user_update.model_dump(exclude_unset=True, exclude={"password"})
    for key, value in update_data.items():
        setattr(db_user, key, value)
    
    if user_update.password:
        db_user.password_hash = get_password_hash(user_update.password)
        
    # Sincronizar con SaaSUser (Global) y su rol
    saas_user = None
    if old_email:
        saas_user = global_db.query(SaaSUser).filter(SaaSUser.email == old_email).first()
        
    if saas_user:
        if user_update.email and user_update.email != old_email:
            saas_user.email = user_update.email
        if user_update.full_name:
            saas_user.full_name = user_update.full_name
        if user_update.password:
            saas_user.hashed_password = db_user.password_hash
            
        # Actualizar Rol Local en TenantUser Global
        if user_update.role_id is not None:
            db_role = db.query(Role).filter(Role.id == user_update.role_id).first()
            if db_role:
                tenant_user_link = global_db.query(TenantUser).filter(
                    TenantUser.user_id == saas_user.id,
                    TenantUser.tenant_id == global_user_info.tenant_id
                ).first()
                if tenant_user_link:
                    tenant_user_link.role_name = db_role.name
                    
        global_db.commit()
    
    db.commit()
    db.refresh(db_user)
    return db_user

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Desactivar Usuario")
def delete_user(
    user_id: int, 
    db: Session = Depends(get_tenant_db),
    global_user_info: TenantUser = Depends(get_current_tenant_user)
):
    """Soft delete: marca el usuario como inactivo."""
    # Proteccion: el dueño no puede desactivarse a sí mismo desde aquí
    if global_user_info.user_id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes desactivar al administrador principal.")

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    db_user.is_active = False
    db.commit()
    return None
