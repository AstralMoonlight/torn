"""Modelo de Configuración del Sistema."""

from sqlalchemy import Boolean, Column, Integer, String, ForeignKey, JSON, true
from sqlalchemy.orm import relationship

from app.database import Base


class SystemSettings(Base):
    """Configuraciones globales del sistema (Singleton).

    Almacena preferencias que afectan el comportamiento general, como formatos de impresión.

    Attributes:
        id (int): Identificador único (siempre 1).
        print_format (str): Formato de impresión de respaldo ('carta' | '80mm' | '57mm'), usado
            para cualquier tipo de documento que no tenga entrada propia en `print_formats`.
        print_formats (dict): Formato de impresión por tipo de documento, p.ej.
            {"33": "carta", "39": "80mm", "purchase": "80mm"}. Claves: "33"/"34"/"39"/"41"/
            "56"/"61" (tipo_dte) y "purchase" (compras). Ver `app/utils/print_settings.py`.
        iva_default_id (int): ID del impuesto por defecto (FK).
        control_caja (bool): Si el POS exige un turno de caja abierto para vender.
            Apagado, Caja desaparece del menú y las ventas no pasan por turno.
        color_mode (str): 'empresa' (el administrador fija el color para todos) o
            'usuario' (cada usuario elige el suyo en su navegador).
        color_primario (str): Clave de la paleta (`COLORES_PRIMARIOS` en `app/schemas.py`).
    """
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    print_format = Column(String(20), default="80mm") # '80mm', '57mm' o 'carta'
    print_formats = Column(JSON, nullable=False, default=dict, server_default="{}")

    # Referencia al impuesto base para cálculos rápidos o defecto global
    iva_default_id = Column(Integer, ForeignKey("taxes.id"), nullable=True)

    control_caja = Column(Boolean, nullable=False, default=True, server_default=true())
    color_mode = Column(String(10), nullable=False, default="empresa", server_default="empresa")
    color_primario = Column(String(20), nullable=False, default="azul", server_default="azul")

    def __repr__(self) -> str:
        return f"<SystemSettings(print_format='{self.print_format}')>"
