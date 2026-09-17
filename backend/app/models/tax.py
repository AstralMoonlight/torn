"""Modelo de Impuestos."""

from sqlalchemy import Column, Integer, String, Numeric, Boolean
from sqlalchemy.orm import relationship

from app.database import Base


class Tax(Base):
    """Modelo de Impuestos (IVA, ILA, Exento, etc.).
    
    Permite configurar diferentes tasas impositivas aplicables a productos.
    
    Attributes:
        id (int): Identificador único.
        name (str): Nombre del impuesto (ej: 'IVA 19%', 'Exento').
        rate (Numeric): Tasa impositiva (ej: 0.19, 0.00).
        is_active (bool): Si el impuesto está disponible para su uso.
        is_default (bool): Si es el impuesto que se asigna por defecto a nuevos productos.
    """
    __tablename__ = "taxes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False)
    rate = Column(Numeric(5, 4), nullable=False, default=0.19)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)

    def __repr__(self) -> str:
        return f"<Tax(name='{self.name}', rate={self.rate})>"
