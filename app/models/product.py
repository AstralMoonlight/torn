"""Modelo de Producto."""

from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, Text
from sqlalchemy.sql import func

from app.database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    codigo_interno = Column(String(50), unique=True, nullable=False, index=True,
                            comment="SKU / código interno del producto")
    codigo_barras = Column(String(50), unique=True, index=True,
                           comment="Código de barras EAN/UPC")
    nombre = Column(String(200), nullable=False)
    descripcion = Column(Text)
    precio_neto = Column(Numeric(15, 2), nullable=False, comment="Precio sin IVA")
    unidad_medida = Column(String(20), default="unidad",
                           comment="unidad, kg, lt, mt, etc.")

    # Inventario
    controla_stock = Column(Boolean, default=False)
    stock_actual = Column(Numeric(15, 2), default=0)
    stock_minimo = Column(Numeric(15, 2), default=0)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self):
        return f"<Product(sku='{self.codigo_interno}', nombre='{self.nombre}')>"
