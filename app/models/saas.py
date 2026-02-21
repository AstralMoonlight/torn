"""Modelos Globales del SaaS (Esquema 'public').

Estos modelos gestionan la infraestructura multi-tenant, usuarios globales
y los planes de suscripción. Residen exclusivamente en el esquema 'public'.
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Numeric
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class SaaSPlan(Base):
    """Planes de suscripción del SaaS."""
    __tablename__ = "saas_plans"
    __table_args__ = {'schema': 'public'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    price_monthly = Column(Numeric(10, 2), default=0)
    is_active = Column(Boolean, default=True)
    max_users = Column(Integer, default=3)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Tenant(Base):
    """La entidad Empresa / Inquilino.
    
    El `schema_name` es la clave para la arquitectura Tenant-per-Schema.
    Determina a qué esquema físico de PostgreSQL apunta la sesión de SQLAlchemy.
    """
    __tablename__ = "tenants"
    __table_args__ = {'schema': 'public'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    rut = Column(String(20), unique=True, index=True, nullable=True)
    schema_name = Column(String(63), unique=True, index=True, nullable=False, comment="Nombre del esquema en PG")
    
    is_active = Column(Boolean, default=True)
    plan_id = Column(Integer, ForeignKey("public.saas_plans.id"), nullable=True)
    max_users_override = Column(Integer, nullable=True, comment="Sobrescribe el limite del plan")
    
    # Datos DTE / Facturación
    address = Column(String(300), nullable=True)
    commune = Column(String(100), nullable=True)
    city = Column(String(100), nullable=True)
    giro = Column(String(200), nullable=True)
    billing_day = Column(Integer, default=1, comment="Día del mes para pago/facturación")
    
    # Actividades económicas (Lista de objetos JSON)
    # Ejemplo: [{"code": "464903", "name": "...", "category": "1ra", "taxable": true}]
    from sqlalchemy.dialects.postgresql import JSONB
    economic_activities = Column(JSONB, nullable=True, server_default='[]')
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    @property
    def plan_max_users(self):
        return self.plan.max_users if self.plan else 3

    # Relaciones
    plan = relationship("SaaSPlan")
    users = relationship("TenantUser", back_populates="tenant")


class SaaSUser(Base):
    """Usuario Global del Sistema.
    
    Un usuario físico real. Puede tener acceso a múltiples Tenants.
    """
    __tablename__ = "saas_users"
    __table_args__ = {'schema': 'public'}

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(200))
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False, comment="Admin del SaaS (nosotros)")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    tenants = relationship("TenantUser", back_populates="user")


class TenantUser(Base):
    """Tabla intermedia: Usuario Global <-> Tenant.
    
    Define a qué empresa tiene acceso un Usuario Global y con qué rol.
    """
    __tablename__ = "tenant_users"
    __table_args__ = {'schema': 'public'}

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("public.tenants.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("public.saas_users.id"), nullable=False)
    
    # El rol operativo (Admin de empresa, Cajero, Bodeguero, etc.)
    role_name = Column(String(50), nullable=False, default="user")
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    tenant = relationship("Tenant", back_populates="users")
    user = relationship("SaaSUser", back_populates="tenants")
