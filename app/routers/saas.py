from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Annotated

from app.database import get_db
from app.dependencies.tenant import get_global_db, get_current_global_user
from app.models.saas import SaaSUser

# Asumiremos la existencia de schemas Pydantic para el payload, 
# pero los definiremos en app/schemas/saas_schemas.py después.
from app.schemas_saas import TenantCreate, TenantOut, TenantUserOut, TenantUserCreate, TenantUpdate, TenantUserUpdate
from app.models.saas import Tenant, TenantUser, SaaSPlan
from app.utils.security import get_password_hash
from app.services.tenant_service import provision_new_tenant

router = APIRouter(prefix="/saas", tags=["SaaS Management"])

@router.get("/tenants", response_model=list[TenantOut])
async def list_tenants(
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
):
    """Obtiene la lista de todas las empresas (exclusivo para superusuarios)."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    tenants = global_db.query(Tenant).all()
    return tenants

@router.post("/tenants", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
async def register_tenant(
    tenant_data: TenantCreate,
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
):
    """
    Registra una nueva empresa en el SaaS.
    
    Crea la entidad globalmente, le genera un esquema exclusivo y migra
    todas las tablas operativas de la instancia hacia su propio entorno físico.
    """
    try:
        new_tenant = provision_new_tenant(
            global_db=global_db,
            tenant_name=tenant_data.name,
            rut=tenant_data.rut,
            owner_id=current_user.id,
            address=tenant_data.address,
            commune=tenant_data.commune,
            city=tenant_data.city,
            giro=tenant_data.giro,
            billing_day=tenant_data.billing_day,
            economic_activities=tenant_data.economic_activities
        )
        return new_tenant
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error creando el inquilino: {str(e)}"
        )

@router.patch("/tenants/{tenant_id}", response_model=TenantOut)
async def update_tenant(
    tenant_id: int,
    tenant_data: TenantUpdate,
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
):
    """Actualiza datos de un inquilino (exclusivo superusuarios)."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    tenant = global_db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
        
    update_data = tenant_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(tenant, key, value)
        
    global_db.commit()
    global_db.refresh(tenant)

    # SINCRONIZACIÓN: Si se actualizaron campos DTE, impactar en el esquema local
    dte_fields = {"name", "address", "commune", "city", "giro", "economic_activities"}
    if any(field in update_data for field in dte_fields):
        from app.database import engine
        from sqlalchemy import text
        connection = engine.connect()
        try:
            # Seleccionar acteco primario si cambió economic_activities
            acteco = None
            if "economic_activities" in update_data and update_data["economic_activities"]:
                acteco = update_data["economic_activities"][0].get("code")

            update_issuer_sql = text(f"""
                UPDATE "{tenant.schema_name}".issuers
                SET razon_social = :name,
                    giro = :giro,
                    acteco = COALESCE(:acteco, acteco),
                    direccion = :address,
                    comuna = :commune,
                    ciudad = :city,
                    updated_at = NOW()
                WHERE rut = :rut
            """)
            connection.execute(update_issuer_sql, {
                "name": tenant.name,
                "giro": tenant.giro or "",
                "acteco": acteco,
                "address": tenant.address or "",
                "commune": tenant.commune or "",
                "city": tenant.city or "",
                "rut": tenant.rut
            })
            connection.commit()
        except Exception as e:
            # No bloqueamos el update global por un fallo en la sync local, 
            # pero sería bueno loguearlo.
            print(f"Error sincronizando Issuer para tenant {tenant.id}: {e}")
        finally:
            connection.close()

    return tenant

@router.delete("/tenants/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant(
    tenant_id: int,
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
):
    """Desactiva lógicamente una empresa (Soft Delete)."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    tenant = global_db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
        
    tenant.is_active = False
    global_db.commit()
    return None


@router.get("/tenants/{tenant_id}/users", response_model=list[TenantUserOut])
async def list_tenant_users(
    tenant_id: int,
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
):
    """Obtiene los usuarios asignados a un inquilino."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")

    users = global_db.query(TenantUser).filter(TenantUser.tenant_id == tenant_id).all()
    return users

@router.post("/tenants/{tenant_id}/users", response_model=TenantUserOut)
async def assign_user_to_tenant(
    tenant_id: int,
    user_data: TenantUserCreate,
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
):
    """
    Asigna un usuario a un Tenant. Si el usuario no existe, lo crea.
    Aplica límites de usuarios por suscripción.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")

    # 1. Validar límite del Plan
    tenant = global_db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
        
    plan = global_db.query(SaaSPlan).filter(SaaSPlan.id == tenant.plan_id).first()
    
    # Evaluar override o plan
    if tenant.max_users_override is not None:
        max_users = tenant.max_users_override
    else:
        max_users = plan.max_users if plan else 1
    
    current_users_count = global_db.query(TenantUser).filter(
        TenantUser.tenant_id == tenant_id, 
        TenantUser.is_active == True
    ).count()

    # Si ya lo tiene, revisemos si el que invita ya estaba y solo está actualizando el rol (omitido por simpleza real, acá bloqueamos)
    if current_users_count >= max_users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El plan actual (Max {max_users}) no permite agregar más usuarios a la empresa."
        )

    # 2. Buscar o crear cuenta global
    target_user = global_db.query(SaaSUser).filter(SaaSUser.email == user_data.email).first()
    
    if not target_user:
        if not user_data.password:
            raise HTTPException(status_code=400, detail="Password is required for new core users")
            
        target_user = SaaSUser(
            email=user_data.email,
            hashed_password=get_password_hash(user_data.password),
            full_name=user_data.full_name
        )
        global_db.add(target_user)
        global_db.flush() # Para obtener ID
        
    # 3. Vincular al Tenant
    existing_link = global_db.query(TenantUser).filter(
        TenantUser.tenant_id == tenant_id,
        TenantUser.user_id == target_user.id
    ).first()
    
    if existing_link:
        raise HTTPException(status_code=400, detail="El usuario ya pertenece a esta empresa")
        
    new_tenant_user = TenantUser(
        tenant_id=tenant_id,
        user_id=target_user.id,
        role_name=user_data.role_name
    )
    global_db.add(new_tenant_user)
    global_db.commit()
    global_db.refresh(new_tenant_user)
    
    return new_tenant_user

@router.patch("/tenants/{tenant_id}/users/{user_id}", response_model=TenantUserOut)
async def update_tenant_user(
    tenant_id: int,
    user_id: int,
    update_data: TenantUserUpdate,
    current_user: Annotated[SaaSUser, Depends(get_current_global_user)],
    global_db: Session = Depends(get_global_db)
):
    """Actualiza rol o desactiva a un usuario de un tenant."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    tenant_user = global_db.query(TenantUser).filter(
        TenantUser.tenant_id == tenant_id,
        TenantUser.user_id == user_id
    ).first()
    
    if not tenant_user:
        raise HTTPException(status_code=404, detail="Tenant user link not found")
        
    data_dict = update_data.model_dump(exclude_unset=True)
    
    # Manejar actualización de contraseña y nombre en la cuenta global
    pwd = data_dict.pop("password", None)
    if pwd:
        tenant_user.user.hashed_password = get_password_hash(pwd)
        
    fn = data_dict.pop("full_name", None)
    if fn is not None:
        tenant_user.user.full_name = fn

    for key, value in data_dict.items():
        setattr(tenant_user, key, value)
        
    global_db.commit()
    global_db.refresh(tenant_user)
    return tenant_user

