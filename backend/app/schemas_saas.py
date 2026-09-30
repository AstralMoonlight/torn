"""Esquemas Pydantic para el API Global del SaaS (Usuarios y Tenants)."""

from pydantic import BaseModel, ConfigDict, Field
from datetime import date, datetime
from typing import Literal, Optional


class ActecoOut(BaseModel):
    code: str
    name: str
    taxable: bool = True
    category: Optional[str] = None
    internet_available: bool = True

    model_config = ConfigDict(from_attributes=True)

class TenantCreate(BaseModel):
    name: str
    rut: str
    address: Optional[str] = None
    commune: Optional[str] = None
    city: Optional[str] = None
    giro: Optional[str] = None
    economic_activities: Optional[list] = []
    plan_id: Optional[int] = None

class TenantOut(BaseModel):
    id: int
    name: str
    rut: Optional[str]
    schema_name: str
    max_users_override: Optional[int] = None
    plan_max_users: Optional[int] = None
    is_active: bool
    
    # Campos DTE
    address: Optional[str] = None
    commune: Optional[str] = None
    city: Optional[str] = None
    giro: Optional[str] = None
    economic_activities: Optional[list] = []

    # Suscripción (`services/suscripciones.py`)
    plan_id: Optional[int] = None
    suscripcion_vence: Optional[date] = None
    prorroga_hasta: Optional[datetime] = None
    suscripcion_estado: Optional[str] = None

    # Datos SII (copiados a dte-torn)
    sii_ambiente: str = "CERT"
    sii_resolucion_numero: int = 0
    sii_resolucion_fecha: Optional[date] = None
    sii_oficina: Optional[str] = None

    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

class SaaSUserCreate(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None

class SaaSUserOut(BaseModel):
    id: int
    email: str
    full_name: Optional[str]
    is_active: bool
    is_superuser: bool
    cargo_id: Optional[int] = None
    es_dueno: bool = False
    permisos: list[str] = []

    model_config = ConfigDict(from_attributes=True)

class SaaSUserLogin(BaseModel):
    email: str
    password: str

class AvailableTenant(BaseModel):
    id: int
    name: str
    rut: Optional[str]
    role_name: str
    is_active: bool = True
    max_users: int = 1
    permissions: Optional[dict] = {}
    #: Modo del emisor (CERT, PROD o DEV), para que el cliente vea en qué modo emite.
    sii_ambiente: str = "CERT"
    #: Para el aviso de pago en la barra superior (`services/suscripciones.py`).
    suscripcion_estado: Optional[str] = None
    suscripcion_vence: Optional[date] = None
    prorroga_hasta: Optional[datetime] = None

class TenantUserCreate(BaseModel):
    email: str
    password: Optional[str] = None
    full_name: Optional[str] = None
    role_name: str

class TenantUserOut(BaseModel):
    id: int
    tenant_id: int
    user_id: int
    role_name: str
    is_active: bool
    user: SaaSUserOut
    
    model_config = ConfigDict(from_attributes=True)

class TenantUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    max_users_override: Optional[int] = None
    address: Optional[str] = None
    commune: Optional[str] = None
    city: Optional[str] = None
    giro: Optional[str] = None
    economic_activities: Optional[list] = None
    sii_ambiente: Optional[Literal["CERT", "PROD", "DEV"]] = None
    sii_resolucion_numero: Optional[int] = Field(default=None, ge=0)
    sii_resolucion_fecha: Optional[date] = None
    sii_oficina: Optional[str] = Field(default=None, max_length=60)

class TenantUserUpdate(BaseModel):
    role_name: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    full_name: Optional[str] = None

class SaaSToken(BaseModel):
    access_token: str
    token_type: str
    user: SaaSUserOut
    available_tenants: list[AvailableTenant]


# ── Planes, pagos y cobranza ───────────────────────────────────────────

class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    precio: int = Field(ge=0)
    meses: int = Field(ge=0, le=36)
    max_users: int = Field(ge=1, le=500)
    cuotas_sin_interes: bool = False
    incluye_impresora: Optional[str] = Field(default=None, max_length=40)
    is_active: bool = True

class PlanOut(PlanIn):
    id: int
    model_config = ConfigDict(from_attributes=True)

class AjustesCobranza(BaseModel):
    dias_aviso: int = Field(ge=0, le=60)
    dias_gracia: int = Field(ge=0, le=60)
    horas_prorroga: int = Field(ge=1, le=720)
    model_config = ConfigDict(from_attributes=True)

class PagoManualIn(BaseModel):
    plan_id: int
    medio: Literal["TRANSFERENCIA", "EFECTIVO"]
    monto: Optional[int] = Field(default=None, ge=0, description="Por defecto, el precio del plan")
    nota: Optional[str] = Field(default=None, max_length=300)

class PagoOut(BaseModel):
    id: int
    tenant_id: int
    empresa: str
    plan_id: int
    plan: str
    monto: int
    medio: str
    estado: str
    periodo_desde: Optional[date] = None
    periodo_hasta: Optional[date] = None
    nota: Optional[str] = None
    created_at: Optional[datetime] = None
    pagado_at: Optional[datetime] = None

class SuscripcionIn(BaseModel):
    """Corrección a mano: cambiar el plan o la fecha de vencimiento."""
    plan_id: int
    suscripcion_vence: Optional[date] = None

class ProrrogaIn(BaseModel):
    horas: int = Field(ge=0, le=720, description="0 quita la prórroga")

class LinkPagoIn(BaseModel):
    plan_id: int
    email: Optional[str] = None

class LinkPagoOut(BaseModel):
    url: str

class ProblemaOut(BaseModel):
    tenant_id: int
    empresa: str
    nivel: str
    tipo: str
    mensaje: str
    model_config = ConfigDict(from_attributes=True)

class ResumenOut(BaseModel):
    empresas_activas: int
    por_estado: dict[str, int]
    cobrado_mes: int
    pagos_mes: int
    problemas: list[ProblemaOut]


# ── Equipo de Factureando ──────────────────────────────────────────────

class PermisoOut(BaseModel):
    clave: str
    nombre: str

class CargoIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=60)
    permisos: list[str] = []

class CargoOut(CargoIn):
    id: int
    model_config = ConfigDict(from_attributes=True)

class MiembroIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    full_name: Optional[str] = Field(default=None, max_length=200)
    password: str = Field(min_length=8)
    cargo_id: int

class MiembroUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=200)
    password: Optional[str] = Field(default=None, min_length=8)
    cargo_id: Optional[int] = None
    is_active: Optional[bool] = None
