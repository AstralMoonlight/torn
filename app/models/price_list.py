"""Modelo de Lista de Precios."""

from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class PriceListProduct(Base):
    """Asociación Many-to-Many entre PriceList y Product con el precio fijo definido."""
    __tablename__ = "price_list_product"

    price_list_id = Column(Integer, ForeignKey("price_lists.id", ondelete="CASCADE"), primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)
    fixed_price = Column(Numeric(15, 2), nullable=False)
    
    # Navigation references as strings to prevent circular imports
    price_list = relationship("PriceList", back_populates="product_associations")
    product = relationship("Product", back_populates="price_list_associations")


class PriceList(Base):
    """Modelo de Lista de Precios personalizada."""
    __tablename__ = "price_lists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relación One-to-Many con Clientes
    customers = relationship("Customer", back_populates="price_list")
    
    # Relación a la tabla pivote
    product_associations = relationship("PriceListProduct", back_populates="price_list", cascade="all, delete-orphan")
