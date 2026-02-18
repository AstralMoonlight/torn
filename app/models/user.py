"""Modelo de Usuario / Contribuyente."""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric, ForeignKey, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class Role(Base):
    """Modelo de Rol de Usuario.

    Define los permisos y capacidades de un grupo de usuarios.
    """
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False, index=True) # ADMINISTRADOR, VENDEDOR, CLIENTE
    description = Column(String(200))
    
    # Permisos Granulares
    can_manage_users = Column(Boolean, default=False)
    can_view_reports = Column(Boolean, default=False)
    can_edit_products = Column(Boolean, default=True)
    can_perform_sales = Column(Boolean, default=True)
    can_perform_returns = Column(Boolean, default=False)
    
    # Permisos Dinámicos (UI/Menus)
    # Estructura Sugerida: {"dashboard": true, "pos": true, "caja": true, "inventario": false, ...}
    permissions = Column(JSON, default={}, server_default='{}')

    users = relationship("User", back_populates="role_obj")

    def __repr__(self) -> str:
        return f"<Role(name='{self.name}')>"


class User(Base):
    """Modelo de Usuario / Contribuyente / Cliente.

    Representa a cualquier entidad que interactúa con el sistema, ya sea un
    operador (cajero) o un cliente (comprador).

    Attributes:
        id (int): Identificador único (PK).
        rut (str): Rol Único Tributario (único).
        razon_social (str): Nombre o Razón Social.
        giro (str): Giro comercial (opcional).
        direccion (str): Dirección física (opcional).
        comuna (str): Comuna de residencia (opcional).
        ciudad (str): Ciudad de residencia (opcional).
        email (str): Correo electrónico de contacto.
        current_balance (Numeric): Deuda acumulada en Cuenta Corriente.
            Valor positivo indica deuda del cliente hacia el negocio.
        is_active (bool): Si el usuario está habilitado.
        created_at (datetime): Fecha de creación del registro.
        updated_at (datetime): Última fecha de actualización.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    rut = Column(String(12), unique=True, nullable=False, index=True)
    email = Column(String(150))
    is_active = Column(Boolean, default=True)
    # Personal Operativo
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    role_obj = relationship("Role", back_populates="users")
    
    role = Column(String(20), default="SELLER") 
    full_name = Column(String(100))
    password_hash = Column(String(255), nullable=True)
    pin = Column(String(10), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    @property
    def name(self):
        return self.full_name

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<User(rut='{self.rut}', full_name='{self.full_name}')>"
