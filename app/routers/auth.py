from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload
from jose import JWTError, jwt

from app.database import get_db
from app.models.user import User, Role
from app.schemas import UserLogin, UserToken, UserOut
from app.utils.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    SECRET_KEY,
    ALGORITHM,
    create_access_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)):
    """Dependencia para obtener el usuario actual desde el token JWT."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar la sesión",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(User).options(joinedload(User.role_obj)).filter(User.rut == username).first()
    if user is None:
        raise credentials_exception
    return user

@router.post("/token", response_model=UserToken)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Session = Depends(get_db),
):
    """OAuth2 compatible token login, retrieving user profile and role."""
    user = db.query(User).options(joinedload(User.role_obj)).filter(User.rut == form_data.username).first()
    if not user:
        user = db.query(User).options(joinedload(User.role_obj)).filter(User.email == form_data.username).first()

    if not user or not user.password_hash or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        subject=user.rut, expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user": user
    }

@router.post("/login", response_model=UserToken)
async def login_json(
    login_data: UserLogin,
    db: Session = Depends(get_db)
):
    """JSON login alternative to OAuth2 form."""
    user = db.query(User).options(joinedload(User.role_obj)).filter(User.rut == login_data.rut).first()
    if not user:
         user = db.query(User).options(joinedload(User.role_obj)).filter(User.email == login_data.rut).first()

    if not user or not user.password_hash or not verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        subject=user.rut, expires_delta=access_token_expires
    )

    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user": user
    }

@router.get("/users/me", response_model=UserOut)
async def read_users_me(current_user: Annotated[User, Depends(get_current_user)]):
    """Obtiene el perfil del usuario actual."""
    return current_user


# ── Dependencias de Autorización ────────────────────────────────────

async def require_admin(current_user: User = Depends(get_current_user)):
    """Verifica que el usuario sea Administrador."""
    if not current_user.role_obj or current_user.role_obj.name != "ADMINISTRADOR":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: se requieren permisos de administrador",
        )
    return current_user

async def require_seller(current_user: User = Depends(get_current_user)):
    """Verifica que el usuario sea al menos Vendedor o Administrador."""
    allowed = ["ADMINISTRADOR", "VENDEDOR"]
    if not current_user.role_obj or current_user.role_obj.name not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: permisos insuficientes",
        )
    return current_user

def require_role(allowed_roles: list[str]):
    """Dependencia parametrizada para requerir roles específicos."""
    async def role_checker(current_user: User = Depends(get_current_user)):
        if not current_user.role_obj or current_user.role_obj.name not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acceso denegado: se requiere uno de los siguientes roles: {', '.join(allowed_roles)}",
            )
        return current_user
    return role_checker
