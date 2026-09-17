"""Modelo de Configuración del Sistema."""

from sqlalchemy import Column, Integer, String, ForeignKey, JSON
from sqlalchemy.orm import relationship

from app.database import Base


class SystemSettings(Base):
    """Configuraciones globales del sistema (Singleton).

    Almacena preferencias que afectan el comportamiento general, como formatos de impresión.

    Attributes:
        id (int): Identificador único (siempre 1).
        print_format (str): Formato de impresión de respaldo ('carta' | '80mm'), usado
            para cualquier tipo de documento que no tenga entrada propia en `print_formats`.
        print_formats (dict): Formato de impresión por tipo de documento, p.ej.
            {"33": "carta", "39": "80mm", "purchase": "80mm"}. Claves: "33"/"34"/"39"/"41"/
            "56"/"61" (tipo_dte) y "purchase" (compras). Ver `app/utils/print_settings.py`.
        iva_default_id (int): ID del impuesto por defecto (FK).
    """
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    print_format = Column(String(20), default="80mm") # '80mm' o 'carta'
    print_formats = Column(JSON, nullable=False, default=dict, server_default="{}")

    # Referencia al impuesto base para cálculos rápidos o defecto global
    iva_default_id = Column(Integer, ForeignKey("taxes.id"), nullable=True)

    def __repr__(self) -> str:
        return f"<SystemSettings(print_format='{self.print_format}')>"
