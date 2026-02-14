"""Modelo de Usuario / Contribuyente."""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric
from sqlalchemy.sql import func

from app.database import Base


class User(Base):
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self):
        return f"<User(rut='{self.rut}', razon_social='{self.razon_social}')>"
