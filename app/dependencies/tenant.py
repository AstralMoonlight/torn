"""Dependencias de Inquilino (Tenant) para SaaS Multi-Tenant.

Provee la sesión de base de datos enrutada dinámicamente al esquema
correspondiente al Tenant solicitado, garantizando aislamiento de datos físicos.
"""

from typing import Annotated, Optional
from fastapi import Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from sqlalchemy.engine import Connection

from app.database import engine, SessionLocal
from app.models.saas import SaaSUser, Tenant, TenantUser
from jose import JWTError, jwt

# Importamos variables de seguridad (asumiendo que están en su utils original o auth.py)
# Importamos variables de seguridad
from app.utils.security import SECRET_KEY, ALGORITHM
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def get_global_db():
    """Retorna una sesión global sin mapeo de esquema (apunta a public)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def get_current_global_user(
    token: Annotated[str, Depends(oauth2_scheme)], 
    global_db: Session = Depends(get_global_db)
) -> SaaSUser:
    """Valida el JWT y retorna el Usuario Global del SaaS."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar la sesión global",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        # Historicamente en Torn se usaba RUT o Email como sub
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = global_db.query(SaaSUser).filter(SaaSUser.email == username).first()
    if user is None:
        raise credentials_exception
    return user


async def get_current_tenant_user(
    x_tenant_id: Annotated[int, Header(description="ID del Tenant a consultar")],
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
) -> TenantUser:
    """Valida y retorna la membresía (TenantUser) del usuario global en el Inquilino solicitado."""
    tenant_user = global_db.query(TenantUser).filter(
        TenantUser.user_id == current_user.id,
        TenantUser.tenant_id == x_tenant_id,
        TenantUser.is_active == True
    ).first()

    if not tenant_user and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes acceso a este Inquilino / Empresa."
        )

    # Si es superusuario pero no tiene registro explícito, creamos uno mockeado para salir al paso o permitimos
    if not tenant_user and current_user.is_superuser:
        # Mock de admin para el superusuario
        tenant_user = TenantUser(tenant_id=x_tenant_id, user_id=current_user.id, role_name="ADMINISTRADOR")
        
    return tenant_user


async def get_tenant_db(
    x_tenant_id: Annotated[int, Header()],
    tenant_user: Annotated[TenantUser, Depends(get_current_tenant_user)],
    global_db: Session = Depends(get_global_db)
) -> Session:
    """Retorna una sesión DB mapeada al esquema del Tenant."""
    
    # 2. Obtener la metadata del tenant (el schema_name real)
    tenant = tenant_user.tenant if hasattr(tenant_user, "tenant") and tenant_user.tenant is not None else global_db.query(Tenant).filter(Tenant.id == x_tenant_id).first()
    
    if not tenant or not tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Inquilino no encontrado o inactivo."
        )

    # 3. Configurar SQLAlchemy para apuntar la sesión a ese esquema
    connection = engine.connect()
    connection.execution_options(schema_translate_map={None: tenant.schema_name})
    
    tenant_session = SessionLocal(bind=connection)
    try:
        yield tenant_session
    finally:
        tenant_session.close()
        connection.execution_options(schema_translate_map=None)
        connection.close()


async def require_admin(tenant_user: Annotated[TenantUser, Depends(get_current_tenant_user)]):
    """Dependencia para verificar que el usuario operativo tiene rol ADMINISTRADOR."""
    if tenant_user.role_name != "ADMINISTRADOR" and not tenant_user.user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: se requieren permisos de administrador de empresa."
        )
    return tenant_user
