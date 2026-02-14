"""Modelo de Emisor (empresa que emite los DTE)."""

from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func

from app.database import Base


class Issuer(Base):
    """Datos del contribuyente emisor (singleton — una sola empresa)."""
    __tablename__ = "issuers"

    id = Column(Integer, primary_key=True, index=True)
    rut = Column(String(12), unique=True, nullable=False, index=True)
    razon_social = Column(String(200), nullable=False)
    giro = Column(String(200), nullable=False)
    acteco = Column(String(10), nullable=False,
                    comment="Código de actividad económica SII")
    direccion = Column(String(300))
    comuna = Column(String(100))
    ciudad = Column(String(100))
    telefono = Column(String(20))
    email = Column(String(150))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self):
        return f"<Issuer(rut='{self.rut}', razon_social='{self.razon_social}')>"
