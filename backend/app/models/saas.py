"""Modelos Globales del SaaS (Esquema 'public').

Estos modelos gestionan la infraestructura multi-tenant, usuarios globales
y los planes de suscripción. Residen exclusivamente en el esquema 'public'.
"""

from sqlalchemy import JSON, Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Numeric, Date, Uuid
from sqlalchemy.dialects.postgresql import JSONB
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
    #: Precio de todo el período (`meses`), en pesos con IVA incluido.
    precio = Column(Integer, nullable=False, default=0, server_default="0")
    is_active = Column(Boolean, default=True)
    max_users = Column(Integer, default=3)
    #: Meses que paga el plan (1, 6, 12). 0 = Cortesía: la empresa no vence.
    meses = Column(Integer, nullable=False, default=1, server_default="1")
    #: Cuotas sin interés en la pasarela: la comisión la paga Factureando (packs).
    cuotas_sin_interes = Column(Boolean, nullable=False, default=False, server_default="false")
    incluye_impresora = Column(String(40), nullable=True, comment="p.ej. 'Térmica 58 mm'")

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

    # Actividades económicas (Lista de objetos JSON)
    # Ejemplo: [{"code": "464903", "name": "...", "category": "1ra", "taxable": true}]
    # JSONB en PostgreSQL; JSON en SQLite para que la suite pueda crear la tabla.
    economic_activities = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=True, server_default='[]')

    # Suscripción (ver `services/suscripciones.py`). Sin fecha = no vence (Cortesía).
    suscripcion_vence = Column(Date, nullable=True, comment="Último día pagado, inclusive")
    #: Prórroga que da un superusuario a una empresa suspendida: funciona hasta esta hora.
    prorroga_hasta = Column(DateTime(timezone=True), nullable=True)

    # Datos del SII que se copian a dte-torn (ver `dte_client.sincronizar_emisor`).
    # Solo los edita un superusuario: pasar a producción o cambiar la
    # resolución no es algo que la empresa haga sola.
    sii_ambiente = Column(String(4), nullable=False, default="CERT", server_default="CERT", comment="CERT | PROD | DEV (Desarrollador: emite sin el SII)")
    sii_resolucion_numero = Column(Integer, nullable=False, default=0, server_default="0")
    sii_resolucion_fecha = Column(Date, nullable=True)
    sii_oficina = Column(String(60), nullable=True, comment="Unidad del SII, p.ej. 'S.I.I. - CONCEPCION'")
    #: Id de la empresa en dte-torn cuando no es el derivado (ver `dte_client.tenant_uuid`).
    dte_tenant_id = Column(Uuid, nullable=True, unique=True)
    
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
    #: Superusuario con cargo: solo tiene los permisos del cargo. Sin cargo: dueño, todos.
    cargo_id = Column(Integer, ForeignKey("public.saas_cargos.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    tenants = relationship("TenantUser", back_populates="user")
    cargo = relationship("SaaSCargo")

    @property
    def es_dueno(self) -> bool:
        return bool(self.is_superuser and self.cargo_id is None)

    @property
    def permisos(self) -> list[str]:
        """Permisos del panel de administración (`dependencies/saas.py`)."""
        from app.dependencies.saas import permisos_de
        return permisos_de(self)


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


class SaaSCargo(Base):
    """Cargo del equipo de Factureando (p.ej. Soporte, Cobranza) con sus permisos."""
    __tablename__ = "saas_cargos"
    __table_args__ = {'schema': 'public'}

    id = Column(Integer, primary_key=True)
    nombre = Column(String(60), unique=True, nullable=False)
    #: Claves de `dependencies/saas.PERMISOS`.
    permisos = Column(JSON, nullable=False, default=list)


class SaaSPago(Base):
    """Pago de la suscripción de una empresa (pasarela o registrado a mano)."""
    __tablename__ = "saas_pagos"
    __table_args__ = {'schema': 'public'}

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("public.tenants.id"), nullable=False, index=True)
    plan_id = Column(Integer, ForeignKey("public.saas_plans.id"), nullable=False)
    monto = Column(Integer, nullable=False, comment="Pesos, IVA incluido")
    medio = Column(String(20), nullable=False, comment="PASARELA | TRANSFERENCIA | EFECTIVO")
    estado = Column(String(12), nullable=False, default="PENDIENTE", comment="PENDIENTE | PAGADO | FALLIDO | ANULADO")
    #: Token de la orden en la pasarela (Flow). Único: la misma orden no se aplica dos veces.
    referencia = Column(String(100), unique=True, nullable=True)
    periodo_desde = Column(Date, nullable=True)
    periodo_hasta = Column(Date, nullable=True)
    #: Vencimiento antes de este pago, para poder anularlo.
    vence_anterior = Column(Date, nullable=True)
    nota = Column(String(300), nullable=True)
    creado_por = Column(Integer, ForeignKey("public.saas_users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    pagado_at = Column(DateTime(timezone=True), nullable=True)

    tenant = relationship("Tenant")
    plan = relationship("SaaSPlan")


class SaaSAjustes(Base):
    """Reglas de cobranza, una sola fila (id=1). Las cambia un superusuario."""
    __tablename__ = "saas_ajustes"
    __table_args__ = {'schema': 'public'}

    id = Column(Integer, primary_key=True)
    dias_aviso = Column(Integer, nullable=False, default=7)
    dias_gracia = Column(Integer, nullable=False, default=5)
    horas_prorroga = Column(Integer, nullable=False, default=12)
