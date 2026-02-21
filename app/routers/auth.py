from datetime import timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session, joinedload
from jose import JWTError, jwt

from app.database import get_db
from app.dependencies.tenant import get_global_db, get_current_global_user
from app.models.saas import SaaSUser, TenantUser
from app.schemas_saas import SaaSUserLogin, SaaSToken, SaaSUserOut, AvailableTenant
from app.utils.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

def _get_user_tenants(global_db: Session, user_id: int) -> list[AvailableTenant]:
    """Helper to get a list of tenants the user can access."""
    tenant_users = global_db.query(TenantUser).options(
        joinedload(TenantUser.tenant)
    ).filter(
        TenantUser.user_id == user_id,
        TenantUser.is_active == True
    ).all()
    
    return [
        AvailableTenant(
            id=tu.tenant.id,
            name=tu.tenant.name,
            rut=tu.tenant.rut,
            role_name=tu.role_name,
            is_active=tu.tenant.is_active
        )
        for tu in tenant_users
    ]

@router.post("/token", response_model=SaaSToken)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    global_db: Session = Depends(get_global_db),
):
    """OAuth2 compatible token login for SaaS Users."""
    user = global_db.query(SaaSUser).filter(SaaSUser.email == form_data.username).first()

    if not user or not user.hashed_password or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        subject=user.email, expires_delta=access_token_expires
    )
    
    # Obtener la lista de empresas a las que tiene acceso para que el Frontend renderice un selector
    tenants = _get_user_tenants(global_db, user.id)
    
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user": user,
        "available_tenants": tenants
    }

@router.post("/login", response_model=SaaSToken)
async def login_json(
    login_data: SaaSUserLogin,
    global_db: Session = Depends(get_global_db)
):
    """JSON login alternative to OAuth2 form."""
    user = global_db.query(SaaSUser).filter(SaaSUser.email == login_data.email).first()

    if not user or not user.hashed_password or not verify_password(login_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        subject=user.email, expires_delta=access_token_expires
    )

    tenants = _get_user_tenants(global_db, user.id)

    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user": user,
        "available_tenants": tenants
    }

@router.get("/users/me", response_model=SaaSUserOut)
async def read_users_me(current_user: Annotated[SaaSUser, Depends(get_current_global_user)]):
    """Obtiene el perfil del usuario actual (Nivel SaaS)."""
    return current_user

@router.get("/validate")
async def validate_session(
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
):
    """Valida la sesión actual y refresca la lista de empresas disponibles."""
    tenants = _get_user_tenants(global_db, current_user.id)
    return {
        "user": current_user,
        "available_tenants": tenants
    }
