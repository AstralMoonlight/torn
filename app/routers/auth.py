from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session, joinedload
from jose import JWTError, jwt

from app.database import get_db
from app.models.user import User
from app.utils.security import verify_password, create_access_token, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from app.schemas import UserToken, UserLogin

router = APIRouter(prefix="/auth", tags=["auth"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_rut: str = payload.get("sub")
        if user_rut is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(User).options(joinedload(User.role_obj)).filter(User.rut == user_rut).first()
    if user is None:
        raise credentials_exception
    return user

@router.post("/token", response_model=UserToken)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Session = Depends(get_db)
):
    # form_data.username will be the RUT or Email
    # Try finding by RUT first, then Email
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
        "user_id": user.id,
        "rut": user.rut,
        "name": user.razon_social,
        "role": user.role_obj.name if user.role_obj else "CLIENTE"
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
        "user_id": user.id,
        "rut": user.rut,
        "name": user.razon_social,
        "role": user.role_obj.name if user.role_obj else "CLIENTE"
    }

@router.get("/users/me")
async def read_users_me(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user


# ── Dependencias de Autorización ────────────────────────────────────

async def require_admin(current_user: User = Depends(get_current_user)):
    """Verifica que el usuario sea Administrador."""
    if not current_user.role_obj or current_user.role_obj.name != "ADMINISTRADOR":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: se requieren permisos de administrador"
        )
    return current_user

async def require_seller(current_user: User = Depends(get_current_user)):
    """Verifica que el usuario sea Vendedor o Administrador."""
    if not current_user.role_obj or current_user.role_obj.name not in ["ADMINISTRADOR", "VENDEDOR"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: se requieren permisos de vendedor o administrador"
        )
    return current_user
