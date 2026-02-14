"""Modelos de Venta y Detalle de Venta."""

from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    folio = Column(Integer, nullable=False)
    tipo_dte = Column(Integer, nullable=False, default=33,
                      comment="33=Factura, 34=Exenta, 39=Boleta, 61=NC")
    fecha_emision = Column(DateTime(timezone=True), server_default=func.now())
    monto_neto = Column(Numeric(15, 2), default=0)
    iva = Column(Numeric(15, 2), default=0)
    monto_total = Column(Numeric(15, 2), default=0)
    descripcion = Column(String(500))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    user = relationship("User", backref="sales")
    details = relationship("SaleDetail", back_populates="sale", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Sale(folio={self.folio}, total={self.monto_total})>"


class SaleDetail(Base):
    """Línea de detalle dentro de una venta (producto vendido)."""
    __tablename__ = "sale_details"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    cantidad = Column(Numeric(15, 4), nullable=False, default=1)
    precio_unitario = Column(Numeric(15, 2), nullable=False)
    descuento = Column(Numeric(15, 2), default=0)
    subtotal = Column(Numeric(15, 2), nullable=False)

    # Relaciones
    sale = relationship("Sale", back_populates="details")
    product = relationship("Product")

    def __repr__(self):
        return f"<SaleDetail(sale={self.sale_id}, product={self.product_id}, qty={self.cantidad})>"
