"""Modelo de Configuración del Sistema."""

from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship

from app.database import Base


class SystemSettings(Base):
    """Configuraciones globales del sistema (Singleton).
    
    Almacena preferencias que afectan el comportamiento general, como formatos de impresión.
    
    Attributes:
        id (int): Identificador único (siempre 1).
        print_format (str): Formato de impresión por defecto ('carta' | '80mm').
        iva_default_id (int): ID del impuesto por defecto (FK).
    """
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    print_format = Column(String(20), default="80mm") # '80mm' o 'carta'
    
    # Referencia al impuesto base para cálculos rápidos o defecto global
    iva_default_id = Column(Integer, ForeignKey("taxes.id"), nullable=True)

    def __repr__(self) -> str:
        return f"<SystemSettings(print_format='{self.print_format}')>"
