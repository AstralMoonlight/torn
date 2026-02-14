"""Modelo de Producto."""

from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship, backref
from sqlalchemy.sql import func

from app.database import Base


class Product(Base):
    """Modelo de Producto o Servicio.

    Representa un ítem vendible en el catálogo. Soporta control de inventario
    y variantes jerárquicas (padre-hijo).

    Attributes:
        id (int): Identificador único (PK).
        codigo_interno (str): SKU o código interno del negocio (único).
        nombre (str): Nombre descriptivo del producto.
        descripcion (str): Detalles adicionales (opcional).
        precio_neto (Numeric): Precio de venta sin IVA.
        unidad_medida (str): Unidad (ej: 'unidad', 'kg', 'lt').
        codigo_barras (str): Código EAN/UPC para escáner (opcional).
        controla_stock (bool): Si True, se valida y descuenta stock al vender.
        stock_actual (Numeric): Cantidad física disponible.
        stock_minimo (Numeric): Umbral para alertas de reposición.
        is_active (bool): Si el producto está habilitado para venta.
        parent_id (int): ID del producto padre (si es una variante).
        created_at (datetime): Fecha de creación.
        updated_at (datetime): Última actualización.
    """
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    codigo_interno = Column(String(50), unique=True, index=True, nullable=False)
    nombre = Column(String(200), nullable=False)
    descripcion = Column(String(500))
    precio_neto = Column(Numeric(15, 2), nullable=False)
    unidad_medida = Column(String(20), default="unidad")
    
    # Inventario
    codigo_barras = Column(String(100), index=True, nullable=True)
    controla_stock = Column(Boolean, default=False)
    stock_actual = Column(Numeric(15, 4), default=0)
    stock_minimo = Column(Numeric(15, 4), default=0)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Variantes (Relación Jerárquica)
    parent_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    variants = relationship("Product", backref=backref("parent", remote_side=[id]))

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<Product(sku='{self.codigo_interno}', nombre='{self.nombre}')>"
