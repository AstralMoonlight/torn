"""Modelos de Venta y Detalle de Venta."""

from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.customer import Customer


class Sale(Base):
    """Encabezado de Venta (Documento Tributario).

    Representa una transacción comercial completa, ya sea Boleta, Factura
    o Nota de Crédito. Agrupa los detalles de productos y pagos.

    Attributes:
        id (int): Identificador único (PK).
        user_id (int): ID del cliente (FK).
        folio (int): Número de folio fiscal (consecutivo según DTE).
        tipo_dte (int): Código SII del documento (33, 39, 61, etc.).
        fecha_emision (datetime): Fecha y hora de emisión.
        monto_neto (Numeric): Suma de valores netos de los ítems.
        iva (Numeric): Impuesto al Valor Agregado (19%).
        monto_total (Numeric): Total a pagar (Neto + IVA).
        descripcion (str): Glosa u observación global.
        created_at (datetime): Fecha de registro en sistema.
        related_sale_id (int): ID de venta origen en caso de NC (FK).
    """
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, comment="Legacy Seller ID")
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
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
    related_sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True, comment="Venta origen para NC/ND")
    related_sale = relationship("Sale", remote_side=[id], backref="adjustments")

    customer = relationship("Customer", backref="sales")
    
    # Seller
    seller_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    seller = relationship("app.models.user.User", foreign_keys=[seller_id], backref="sales_as_seller")
    
    details = relationship("SaleDetail", back_populates="sale", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<Sale(folio={self.folio}, total={self.monto_total})>"


class SaleDetail(Base):
    """Detalle de Venta (Línea de Producto).

    Representa un ítem específico dentro de una venta.

    Attributes:
        id (int): Identificador único (PK).
        sale_id (int): ID de la venta padre (FK).
        product_id (int): ID del producto vendido (FK).
        cantidad (Numeric): Cantidad vendida.
        precio_unitario (Numeric): Precio al momento de la venta.
        descuento (Numeric): Monto de descuento aplicado.
        subtotal (Numeric): Total de la línea (precio * cantidad - descuento).
    """
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

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<SaleDetail(sale={self.sale_id}, product={self.product_id}, qty={self.cantidad})>"
