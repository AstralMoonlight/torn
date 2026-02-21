"""Esquemas Pydantic para el API Global del SaaS (Usuarios y Tenants)."""

from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional

class TenantCreate(BaseModel):
    name: str
    rut: str
    address: Optional[str] = None
    commune: Optional[str] = None
    city: Optional[str] = None
    giro: Optional[str] = None
    billing_day: Optional[int] = 1
    economic_activities: Optional[list] = []

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
    billing_day: int
    economic_activities: Optional[list] = []
    
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
    billing_day: Optional[int] = None
    economic_activities: Optional[list] = None

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
