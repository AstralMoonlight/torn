"""Modelo de Proveedor."""

from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class Provider(Base):
    """Modelo de Proveedor.

    Representa una entidad externa que suministra productos al negocio.

    Attributes:
        id (int): Identificador único (PK).
        rut (str): RUT del proveedor (único).
        razon_social (str): Nombre legal o comercial.
        giro (str): Actividad económica.
        direccion (str): Dirección física.
        email (str): Email de contacto.
        telefono (str): Teléfono de contacto.
        is_active (bool): Si el proveedor está habilitado.
    """
    __tablename__ = "providers"

    id = Column(Integer, primary_key=True, index=True)
    rut = Column(String(20), unique=True, index=True, nullable=False)
    razon_social = Column(String(200), nullable=False)
    giro = Column(String(200))
    direccion = Column(String(200))
    email = Column(String(100))
    telefono = Column(String(50))
    ciudad = Column(String(100))
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<Provider(rut='{self.rut}', razon_social='{self.razon_social}')>"
