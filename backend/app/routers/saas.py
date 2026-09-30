"""Panel de administración de Factureando: empresas, suscripciones, pagos y planes.

Cada endpoint pide un permiso de `dependencies/saas.PERMISOS`: el dueño los
tiene todos y el resto del equipo, los de su cargo.
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session, joinedload

from app.database import engine
from app.dependencies.saas import requiere_permiso_saas, tiene_permiso
from app.dependencies.tenant import get_global_db
from app.models.acteco import Acteco
from app.models.saas import SaaSAjustes, SaaSPago, SaaSPlan, SaaSUser, Tenant, TenantUser
from app.schemas_saas import (
    ActecoOut, AjustesCobranza, LinkPagoIn, LinkPagoOut, PagoManualIn, PagoOut, PlanIn, PlanOut,
    ProblemaOut, ProrrogaIn, ResumenOut, SuscripcionIn, TenantCreate, TenantOut, TenantUpdate,
    TenantUserCreate, TenantUserOut, TenantUserUpdate,
)
from app.services import dte_client, flow, salud_empresas
from app.services import suscripciones as sus
from app.services.tenant_service import provision_new_tenant
from app.utils.dates import CHILE_TZ
from app.utils.schemas import safe_schema_name
from app.utils.security import get_password_hash

router = APIRouter(prefix="/saas", tags=["SaaS Management"])


def _permiso(clave: str):
    return Annotated[SaaSUser, Depends(requiere_permiso_saas(clave))]


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _empresa(db: Session, tenant_id: int) -> Tenant:
    tenant = db.query(Tenant).options(joinedload(Tenant.plan)).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Empresa no encontrada.")
    return tenant


def _con_estado(tenant: Tenant, reglas: SaaSAjustes, ahora: datetime) -> Tenant:
    # Atributo de paso para TenantOut: el estado no se guarda (ver services/suscripciones.py).
    tenant.suscripcion_estado = sus.estado(tenant, reglas, ahora)
    return tenant


@router.get("/actecos", response_model=list[ActecoOut])
def search_actecos(
    _: _permiso("empresas.ver"),
    global_db: Session = Depends(get_global_db),
    q: str | None = None,
    limit: int = 30,
):
    """Busca códigos ACTECO por código o descripción (máximo 100)."""
    limit = min(max(1, limit), 100)
    query = global_db.query(Acteco)
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.filter((Acteco.code.ilike(term)) | (Acteco.name.ilike(term)))
    return query.order_by(Acteco.code).limit(limit).all()


# ── Empresas ───────────────────────────────────────────────────────────

@router.get("/tenants", response_model=list[TenantOut])
def list_tenants(_: _permiso("empresas.ver"), global_db: Session = Depends(get_global_db)):
    reglas, ahora = sus.ajustes(global_db), _ahora()
    tenants = global_db.query(Tenant).options(joinedload(Tenant.plan)).order_by(Tenant.name).all()
    return [_con_estado(t, reglas, ahora) for t in tenants]


@router.get("/tenants/{tenant_id}", response_model=TenantOut)
def get_tenant(tenant_id: int, _: _permiso("empresas.ver"), global_db: Session = Depends(get_global_db)):
    return _con_estado(_empresa(global_db, tenant_id), sus.ajustes(global_db), _ahora())


@router.post("/tenants", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
def register_tenant(
    tenant_data: TenantCreate,
    current_user: _permiso("empresas.editar"),
    global_db: Session = Depends(get_global_db),
):
    """Crea la empresa con su propio esquema y todas las tablas operativas."""
    if tenant_data.plan_id is not None and not global_db.get(SaaSPlan, tenant_data.plan_id):
        raise HTTPException(status_code=400, detail="Ese plan no existe.")
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
            economic_activities=tenant_data.economic_activities,
            plan_id=tenant_data.plan_id,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Error creando la empresa: {e}")
    return _con_estado(new_tenant, sus.ajustes(global_db), _ahora())


_CAMPOS_SII = {"sii_ambiente", "sii_resolucion_numero", "sii_resolucion_fecha", "sii_oficina"}


@router.patch("/tenants/{tenant_id}", response_model=TenantOut)
def update_tenant(
    tenant_id: int,
    tenant_data: TenantUpdate,
    current_user: _permiso("empresas.editar"),
    global_db: Session = Depends(get_global_db),
):
    """Datos de la empresa. Los del SII piden además el permiso `empresas.sii`."""
    tenant = _empresa(global_db, tenant_id)
    update_data = tenant_data.model_dump(exclude_unset=True)
    if _CAMPOS_SII & update_data.keys() and not tiene_permiso(current_user, "empresas.sii"):
        raise HTTPException(status_code=403, detail="Su cargo no permite cambiar los datos del SII.")
    for key, value in update_data.items():
        setattr(tenant, key, value)
    global_db.commit()
    global_db.refresh(tenant)

    # Los datos de empresa se copian también al emisor de su esquema.
    dte_fields = {"name", "address", "commune", "city", "giro", "economic_activities"}
    if any(field in update_data for field in dte_fields):
        connection = engine.connect()
        try:
            acteco = None
            if update_data.get("economic_activities"):
                acteco = update_data["economic_activities"][0].get("code")
            connection.execute(text(f"""
                UPDATE "{safe_schema_name(tenant.schema_name)}".issuers
                SET razon_social = :name,
                    giro = :giro,
                    acteco = COALESCE(:acteco, acteco),
                    direccion = :address,
                    comuna = :commune,
                    ciudad = :city,
                    updated_at = NOW()
                WHERE rut = :rut
            """), {
                "name": tenant.name,
                "giro": tenant.giro or "",
                "acteco": acteco,
                "address": tenant.address or "",
                "commune": tenant.commune or "",
                "city": tenant.city or "",
                "rut": tenant.rut,
            })
            connection.commit()
        except Exception as e:
            # No se bloquea el cambio global por un fallo en la copia local.
            print(f"Error sincronizando Issuer para tenant {tenant.id}: {e}")
        finally:
            connection.close()

    # dte-torn guarda su propia copia del emisor.
    if any(field in update_data for field in dte_fields | _CAMPOS_SII | {"is_active"}):
        _sincronizar_con_dte(tenant)

    return _con_estado(tenant, sus.ajustes(global_db), _ahora())


def _sincronizar_con_dte(tenant: Tenant) -> None:
    with engine.connect() as connection:
        issuer = connection.execute(
            text(f'SELECT * FROM "{safe_schema_name(tenant.schema_name)}".issuers LIMIT 1')
        ).first()
    try:
        dte_client.sincronizar_emisor(tenant, issuer)
    except dte_client.DteError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=f"Datos guardados, pero no se pudieron copiar a facturación electrónica: {exc.detail}. "
                   "Vuelve a guardar para reintentar.",
        ) from exc


@router.delete("/tenants/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant(tenant_id: int, _: _permiso("empresas.editar"), global_db: Session = Depends(get_global_db)):
    """Desactiva la empresa (no borra nada)."""
    tenant = _empresa(global_db, tenant_id)
    tenant.is_active = False
    global_db.commit()


@router.get("/tenants/{tenant_id}/problemas", response_model=list[ProblemaOut])
def tenant_problemas(tenant_id: int, _: _permiso("empresas.ver"), global_db: Session = Depends(get_global_db)):
    return salud_empresas.revisar_empresas(global_db, [_empresa(global_db, tenant_id)], _ahora())


# ── Usuarios de una empresa ────────────────────────────────────────────

@router.get("/tenants/{tenant_id}/users", response_model=list[TenantUserOut])
def list_tenant_users(tenant_id: int, _: _permiso("empresas.usuarios"), global_db: Session = Depends(get_global_db)):
    return global_db.query(TenantUser).filter(TenantUser.tenant_id == tenant_id).all()


@router.post("/tenants/{tenant_id}/users", response_model=TenantUserOut)
def assign_user_to_tenant(
    tenant_id: int,
    user_data: TenantUserCreate,
    _: _permiso("empresas.usuarios"),
    global_db: Session = Depends(get_global_db),
):
    """Asigna un usuario a la empresa (lo crea si no existe), dentro del cupo del plan."""
    tenant = _empresa(global_db, tenant_id)
    max_users = tenant.max_users_override if tenant.max_users_override is not None else tenant.plan_max_users
    activos = global_db.query(TenantUser).filter(
        TenantUser.tenant_id == tenant_id, TenantUser.is_active == True  # noqa: E712
    ).count()
    if activos >= max_users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El plan actual (máximo {max_users}) no permite agregar más usuarios a la empresa.",
        )

    target_user = global_db.query(SaaSUser).filter(SaaSUser.email == user_data.email).first()
    if not target_user:
        if not user_data.password:
            raise HTTPException(status_code=400, detail="La cuenta es nueva: falta la contraseña.")
        target_user = SaaSUser(
            email=user_data.email,
            hashed_password=get_password_hash(user_data.password),
            full_name=user_data.full_name,
        )
        global_db.add(target_user)
        global_db.flush()

    if global_db.query(TenantUser).filter(TenantUser.tenant_id == tenant_id, TenantUser.user_id == target_user.id).first():
        raise HTTPException(status_code=400, detail="El usuario ya pertenece a esta empresa")

    new_tenant_user = TenantUser(tenant_id=tenant_id, user_id=target_user.id, role_name=user_data.role_name)
    global_db.add(new_tenant_user)
    global_db.commit()
    global_db.refresh(new_tenant_user)

    # Copia en la tabla `users` del esquema de la empresa.
    try:
        esquema = safe_schema_name(tenant.schema_name)
        res_role = global_db.execute(
            text(f'SELECT id FROM "{esquema}".roles WHERE name = :role_name LIMIT 1'),
            {"role_name": user_data.role_name},
        ).fetchone()
        global_db.execute(text(f'''
            INSERT INTO "{esquema}".users (email, full_name, password_hash, role, role_id, is_active)
            VALUES (:email, :full_name, :pwd, :role, :role_id, true)
            ON CONFLICT (email) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            role_id = EXCLUDED.role_id,
            is_active = true
        '''), {
            "email": target_user.email,
            "full_name": target_user.full_name or "",
            "pwd": target_user.hashed_password or "",
            "role": user_data.role_name,
            "role_id": res_role[0] if res_role else None,
        })
        global_db.commit()
    except Exception as e:
        print(f"Error syncing user {target_user.email} to tenant schema: {e}")

    return new_tenant_user


@router.patch("/tenants/{tenant_id}/users/{user_id}", response_model=TenantUserOut)
def update_tenant_user(
    tenant_id: int,
    user_id: int,
    update_data: TenantUserUpdate,
    _: _permiso("empresas.usuarios"),
    global_db: Session = Depends(get_global_db),
):
    """Rol, nombre, contraseña o activo de un usuario de la empresa."""
    tenant_user = global_db.query(TenantUser).filter(
        TenantUser.tenant_id == tenant_id, TenantUser.user_id == user_id
    ).first()
    if not tenant_user:
        raise HTTPException(status_code=404, detail="Ese usuario no pertenece a la empresa.")
    if tenant_user.user.is_superuser:
        raise HTTPException(status_code=403, detail="Un superusuario se edita en Equipo.")

    data_dict = update_data.model_dump(exclude_unset=True)
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

    tenant = global_db.get(Tenant, tenant_id)
    if tenant and tenant.schema_name:
        try:
            esquema = safe_schema_name(tenant.schema_name)
            updates, params = [], {"email": tenant_user.user.email}
            if update_data.is_active is not None:
                updates.append("is_active = :is_active")
                params["is_active"] = update_data.is_active
            if pwd:
                updates.append("password_hash = :pwd")
                params["pwd"] = tenant_user.user.hashed_password
            if fn is not None:
                updates.append("full_name = :full_name")
                params["full_name"] = fn
            if "role_name" in data_dict:
                res_role = global_db.execute(
                    text(f'SELECT id FROM "{esquema}".roles WHERE name = :role_name LIMIT 1'),
                    {"role_name": data_dict["role_name"]},
                ).fetchone()
                updates += ["role = :role", "role_id = :role_id"]
                params["role"] = data_dict["role_name"]
                params["role_id"] = res_role[0] if res_role else None
            if updates:
                global_db.execute(text(f'UPDATE "{esquema}".users SET {", ".join(updates)} WHERE email = :email'), params)
                global_db.commit()
        except Exception as e:
            print(f"Error syncing user update {tenant_user.user.email} to tenant schema: {e}")

    return tenant_user


# ── Planes y reglas de cobranza ────────────────────────────────────────

@router.get("/planes", response_model=list[PlanOut])
def list_planes(_: _permiso("empresas.ver"), global_db: Session = Depends(get_global_db)):
    """Los pagables por duración; Cortesía (0 meses) al final."""
    planes = global_db.query(SaaSPlan).order_by(SaaSPlan.meses, SaaSPlan.id).all()
    return sorted(planes, key=lambda p: p.meses == 0)


@router.post("/planes", response_model=PlanOut, status_code=201)
def create_plan(datos: PlanIn, _: _permiso("planes.editar"), global_db: Session = Depends(get_global_db)):
    plan = SaaSPlan(**datos.model_dump())
    global_db.add(plan)
    global_db.commit()
    return plan


@router.put("/planes/{plan_id}", response_model=PlanOut)
def update_plan(plan_id: int, datos: PlanIn, _: _permiso("planes.editar"), global_db: Session = Depends(get_global_db)):
    """Cambiar el precio no toca los pagos ya hechos: rige desde el próximo."""
    plan = _plan(global_db, plan_id)
    for k, v in datos.model_dump().items():
        setattr(plan, k, v)
    global_db.commit()
    return plan


@router.get("/ajustes", response_model=AjustesCobranza)
def get_ajustes(_: _permiso("empresas.ver"), global_db: Session = Depends(get_global_db)):
    return sus.ajustes(global_db)


@router.put("/ajustes", response_model=AjustesCobranza)
def put_ajustes(datos: AjustesCobranza, _: _permiso("planes.editar"), global_db: Session = Depends(get_global_db)):
    reglas = global_db.get(SaaSAjustes, 1) or SaaSAjustes(id=1)
    for k, v in datos.model_dump().items():
        setattr(reglas, k, v)
    global_db.add(reglas)
    global_db.commit()
    return reglas


# ── Suscripción y pagos ────────────────────────────────────────────────

def _pago_out(p: SaaSPago) -> PagoOut:
    return PagoOut(
        id=p.id, tenant_id=p.tenant_id, empresa=p.tenant.name, plan_id=p.plan_id, plan=p.plan.name,
        monto=p.monto, medio=p.medio, estado=p.estado, periodo_desde=p.periodo_desde,
        periodo_hasta=p.periodo_hasta, nota=p.nota, created_at=p.created_at, pagado_at=p.pagado_at,
    )


def _plan(db: Session, plan_id: int) -> SaaSPlan:
    plan = db.get(SaaSPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado.")
    return plan


@router.get("/pagos", response_model=list[PagoOut])
def list_pagos(
    _: _permiso("cobros.ver"),
    global_db: Session = Depends(get_global_db),
    tenant_id: int | None = None,
    estado: str | None = None,
    limit: int = 200,
):
    """Los más nuevos primero."""
    q = global_db.query(SaaSPago).options(joinedload(SaaSPago.tenant), joinedload(SaaSPago.plan))
    if tenant_id:
        q = q.filter(SaaSPago.tenant_id == tenant_id)
    if estado:
        q = q.filter(SaaSPago.estado == estado)
    return [_pago_out(p) for p in q.order_by(SaaSPago.id.desc()).limit(min(max(limit, 1), 1000))]


@router.post("/tenants/{tenant_id}/pagos", response_model=PagoOut, status_code=201)
def registrar_pago(
    tenant_id: int,
    datos: PagoManualIn,
    current_user: _permiso("cobros.registrar"),
    global_db: Session = Depends(get_global_db),
):
    """Pago recibido fuera de la pasarela (transferencia, efectivo): extiende el vencimiento."""
    tenant = _empresa(global_db, tenant_id)
    plan = _plan(global_db, datos.plan_id)
    if plan.meses < 1:
        raise HTTPException(status_code=400, detail="El plan Cortesía no se paga: asígnelo con Cambiar plan.")
    pago = SaaSPago(
        tenant=tenant, plan=plan, plan_id=plan.id, monto=datos.monto if datos.monto is not None else plan.precio,
        medio=datos.medio, estado="PENDIENTE", nota=datos.nota, creado_por=current_user.id,
    )
    global_db.add(pago)
    sus.aplicar_pago(pago, sus.ajustes(global_db), _ahora())
    global_db.commit()
    return _pago_out(pago)


@router.post("/pagos/{pago_id}/anular", response_model=PagoOut)
def anular_pago(pago_id: int, _: _permiso("cobros.registrar"), global_db: Session = Depends(get_global_db)):
    pago = global_db.get(SaaSPago, pago_id)
    if not pago:
        raise HTTPException(status_code=404, detail="Pago no encontrado.")
    try:
        sus.anular_pago(pago)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    global_db.commit()
    return _pago_out(pago)


@router.put("/tenants/{tenant_id}/suscripcion", response_model=TenantOut)
def cambiar_suscripcion(
    tenant_id: int,
    datos: SuscripcionIn,
    _: _permiso("cobros.registrar"),
    global_db: Session = Depends(get_global_db),
):
    """Cambia el plan o corrige el vencimiento a mano (p.ej. pasar a Cortesía)."""
    tenant = _empresa(global_db, tenant_id)
    tenant.plan = _plan(global_db, datos.plan_id)
    tenant.suscripcion_vence = datos.suscripcion_vence
    global_db.commit()
    return _con_estado(tenant, sus.ajustes(global_db), _ahora())


@router.post("/tenants/{tenant_id}/prorroga", response_model=TenantOut)
def dar_prorroga(
    tenant_id: int,
    datos: ProrrogaIn,
    _: _permiso("cobros.prorroga"),
    global_db: Session = Depends(get_global_db),
):
    """Horas extra para una empresa suspendida (el panel propone `horas_prorroga`). 0 la quita."""
    tenant = _empresa(global_db, tenant_id)
    sus.dar_prorroga(tenant, datos.horas, _ahora())
    global_db.commit()
    return _con_estado(tenant, sus.ajustes(global_db), _ahora())


@router.post("/tenants/{tenant_id}/link-pago", response_model=LinkPagoOut)
def link_pago(
    tenant_id: int,
    datos: LinkPagoIn,
    current_user: _permiso("cobros.registrar"),
    global_db: Session = Depends(get_global_db),
):
    """Link de Flow para mandarle al cliente. El correo es el del pagador en Flow."""
    tenant = _empresa(global_db, tenant_id)
    email = datos.email
    if not email:
        admin = global_db.query(TenantUser).filter(
            TenantUser.tenant_id == tenant_id, TenantUser.role_name == "ADMINISTRADOR",
            TenantUser.is_active == True,  # noqa: E712
        ).first()
        if not admin:
            raise HTTPException(status_code=400, detail="La empresa no tiene administrador: indique el correo del pagador.")
        email = admin.user.email
    try:
        return LinkPagoOut(url=sus.iniciar_pago_pasarela(global_db, tenant, _plan(global_db, datos.plan_id), email, current_user.id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except flow.FlowError as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Resumen ────────────────────────────────────────────────────────────

@router.get("/resumen", response_model=ResumenOut)
def resumen(_: _permiso("empresas.ver"), global_db: Session = Depends(get_global_db)):
    """Contadores, lo cobrado en el mes y la lista "Requiere atención"."""
    ahora = _ahora()
    reglas = sus.ajustes(global_db)
    activas = global_db.query(Tenant).options(joinedload(Tenant.plan)).filter(Tenant.is_active == True).all()  # noqa: E712
    por_estado: dict[str, int] = {}
    for t in activas:
        e = sus.estado(t, reglas, ahora)
        por_estado[e] = por_estado.get(e, 0) + 1

    inicio_mes = ahora.astimezone(CHILE_TZ).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    cobrado, cantidad = global_db.query(func.coalesce(func.sum(SaaSPago.monto), 0), func.count(SaaSPago.id)).filter(
        SaaSPago.estado == "PAGADO", SaaSPago.pagado_at >= inicio_mes
    ).one()

    return ResumenOut(
        empresas_activas=len(activas),
        por_estado=por_estado,
        cobrado_mes=int(cobrado),
        pagos_mes=cantidad,
        problemas=[ProblemaOut.model_validate(p) for p in salud_empresas.revisar_empresas(global_db, activas, ahora)],
    )
