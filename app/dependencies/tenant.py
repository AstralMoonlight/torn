"""Dependencias de Inquilino (Tenant) para SaaS Multi-Tenant.

Provee la sesión de base de datos enrutada dinámicamente al esquema
correspondiente al Tenant solicitado, garantizando aislamiento de datos físicos.

Todas estas dependencias son `def` y no `async def` **a propósito**. FastAPI
ejecuta las dependencias `async` en el event loop, y aquí las consultas son
síncronas (psycopg2): declararlas `async` hace que cada request bloquee el loop
mientras espera a la base, en vez de delegarse al threadpool. Ninguna usa
`await`, así que nada gana con ser corrutina. No las conviertas a `async` sin
migrar antes a un driver asíncrono.
"""

from typing import Annotated, Optional
from fastapi import Depends, HTTPException, Header, status
from sqlalchemy.orm import Session, joinedload

from app.database import SessionLocal, engine
from app.models.saas import SaaSUser, Tenant, TenantUser
from app.models.user import User
from app.utils.schemas import safe_schema_name
from jose import JWTError, jwt

# Importamos variables de seguridad (asumiendo que están en su utils original o auth.py)
# Importamos variables de seguridad
from app.utils.security import SECRET_KEY, ALGORITHM
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def get_global_db():
    """Retorna una sesión global sin mapeo de esquema (apunta a public).

    Ligada explícitamente a una `Connection` (no al `Engine`) para que
    `get_tenant_db` pueda reusarla como su única conexión (issue #38): una
    sesión ligada al Engine devuelve la conexión al pool en cada `commit()`
    y la próxima consulta toma otra de cero, sin el `schema_translate_map`
    que `get_tenant_db` le haya aplicado. Ligada a una Connection propia, la
    sesión se queda con la misma conexión durante toda la petición pase lo
    que pase con los commits; nosotros la cerramos al final.
    """
    connection = engine.connect()
    db = SessionLocal(bind=connection)
    try:
        yield db
    finally:
        db.close()
        connection.close()


def get_current_global_user(
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


def get_current_tenant_user(
    x_tenant_id: Annotated[int, Header(description="ID del Tenant a consultar")],
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
) -> TenantUser:
    """Valida y retorna la membresía (TenantUser) del usuario global en el Inquilino solicitado."""
    # joinedload evita que `get_tenant_db` dispare una segunda consulta (lazy
    # load de `.tenant`) sobre esta misma conexión sólo para leer schema_name.
    tenant_user = global_db.query(TenantUser).options(joinedload(TenantUser.tenant)).filter(
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


def get_tenant_db(
    x_tenant_id: Annotated[int, Header()],
    tenant_user: Annotated[TenantUser, Depends(get_current_tenant_user)],
    global_db: Session = Depends(get_global_db)
) -> Session:
    """Retorna una sesión DB mapeada al esquema del Tenant.

    Reusa la conexión de `global_db` en vez de abrir una segunda (issue #38):
    cada petición con inquilino pasaba de una conexión a dos —la de
    `get_global_db` y una propia aquí para el `schema_translate_map`—, lo que
    reducía a la mitad el techo de peticiones concurrentes que el pool podía
    atender.

    Esto es seguro porque cada modelo declara su esquema explícitamente:
    `SaaSUser`, `Tenant`, `TenantUser` y `SaaSPlan` fijan
    `__table_args__ = {'schema': 'public'}` (igual que `Acteco`); el resto de
    los modelos no declara esquema (`None`). `schema_translate_map` sólo
    traduce las tablas cuyo esquema coincide con una clave del mapa — aquí
    sólo `None` está mapeado — así que las tablas 'public' explícitas siguen
    resolviendo a 'public' sin que importe en qué orden una misma conexión
    alterne entre consultas de una y otra (como hace `app/routers/users.py`,
    que consulta `SaaSUser`/`TenantUser` y `User`/`Role` dentro del mismo
    request). Verificado con tests/test_tenant_dependencies.py contra
    PostgreSQL real (SQLite no soporta esquemas).
    """

    # Obtener la metadata del tenant (el schema_name real)
    tenant = tenant_user.tenant if hasattr(tenant_user, "tenant") and tenant_user.tenant is not None else global_db.query(Tenant).filter(Tenant.id == x_tenant_id).first()

    if not tenant or not tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inquilino no encontrado o inactivo."
        )

    # Mapear la conexión ya abierta por `global_db` al esquema del tenant, en
    # vez de abrir (`engine.connect()`) y cerrar una conexión aparte.
    # `execution_options` en un `Connection` muta y devuelve el mismo objeto
    # (no una copia), así que esto también afecta a las consultas que el
    # propio `global_db` haga después dentro de esta misma petición — lo cual
    # es correcto, por el punto anterior sobre el esquema 'public' explícito.
    connection = global_db.connection()
    connection.execution_options(
        schema_translate_map={None: safe_schema_name(tenant.schema_name)}
    )

    # No hay conexión propia que cerrar: el ciclo de vida de `connection` lo
    # controla `get_global_db`, que la libera al pool en su propio `finally`.
    yield global_db

def get_current_local_user(
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    tenant_db: Session = Depends(get_tenant_db)
) -> User:
    """Retorna el usuario operativo local, con bypass para el administrador global SaaS."""
    if current_user.is_superuser:
        local_user = tenant_db.query(User).filter(User.is_system_user == True).first()
        if not local_user:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Usuario de soporte inyectado no encontrado en el inquilino local."
            )
        return local_user
    
    local_user = tenant_db.query(User).filter(User.email == current_user.email).first()
    if not local_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Usuario local no encontrado en la sucursal actual."
        )
    return local_user


def require_admin(tenant_user: Annotated[TenantUser, Depends(get_current_tenant_user)]):
    """Dependencia para verificar que el usuario operativo tiene rol ADMINISTRADOR."""
    if tenant_user.role_name != "ADMINISTRADOR" and not tenant_user.user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: se requieren permisos de administrador de empresa."
        )
    return tenant_user
