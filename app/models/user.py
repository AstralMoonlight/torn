"""Modelo de Usuario / Contribuyente."""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


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
    razon_social = Column(String(200), nullable=False)
    giro = Column(String(200))
    direccion = Column(String(300))
    comuna = Column(String(100))
    ciudad = Column(String(100))
    email = Column(String(150))
    current_balance = Column(Numeric(15, 2), default=0, comment="Saldo de Cuenta Corriente (Positivo=Deuda)")
    is_active = Column(Boolean, default=True)
    role = Column(String(20), default="CUSTOMER", comment="ADMIN, SELLER, CUSTOMER")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<User(rut='{self.rut}', razon_social='{self.razon_social}')>"
