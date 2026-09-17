"""Modelos de Compra y Detalle de Compra (Ingreso de Mercadería)."""

from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class Purchase(Base):
    """Encabezado de Compra (Ingreso de Mercadería).

    Representa un documento de compra recibido de un proveedor.

    Attributes:
        id (int): Identificador único (PK).
        provider_id (int): ID del proveedor (FK).
        folio (str): Número del documento (factura o boleta).
        tipo_documento (str): 'FACTURA' | 'BOLETA' | 'SIN_DOCUMENTO'.
        fecha_compra (datetime): Fecha del documento.
        monto_neto (Numeric): Subtotal neto.
        iva (Numeric): IVA (19%).
        monto_total (Numeric): Total de la compra.
        observacion (str): Nota adicional.
        created_at (datetime): Fecha de registro.
    """
    __tablename__ = "purchases"

    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(Integer, ForeignKey("providers.id"), nullable=False)
    folio = Column(String(50))
    tipo_documento = Column(String(20), default="FACTURA", comment="FACTURA | BOLETA | SIN_DOCUMENTO")
    fecha_compra = Column(DateTime(timezone=True), server_default=func.now())
    
    monto_neto = Column(Numeric(15, 2), default=0)
    iva = Column(Numeric(15, 2), default=0)
    monto_total = Column(Numeric(15, 2), default=0)
    
    observacion = Column(String(500))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    provider = relationship("app.models.provider.Provider", backref="purchases")
    details = relationship("PurchaseDetail", back_populates="purchase", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Purchase(id={self.id}, total={self.monto_total})>"


class PurchaseDetail(Base):
    """Detalle de Compra (Ítem de mercadería).

    Representa un producto específico dentro de una compra.

    Attributes:
        id (int): Identificador único (PK).
        purchase_id (int): ID de la compra padre (FK).
        product_id (int): ID del producto (FK).
        cantidad (Numeric): Cantidad comprada.
        precio_costo_unitario (Numeric): Precio neto pagado por unidad.
        subtotal (Numeric): Cantidad * Precio Costo.
    """
    __tablename__ = "purchase_details"

    id = Column(Integer, primary_key=True, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    cantidad = Column(Numeric(15, 4), nullable=False)
    precio_costo_unitario = Column(Numeric(15, 2), nullable=False)
    subtotal = Column(Numeric(15, 2), nullable=False)

    # Relaciones
    purchase = relationship("Purchase", back_populates="details")
    product = relationship("app.models.product.Product")

    def __repr__(self) -> str:
        return f"<PurchaseDetail(purchase={self.purchase_id}, product={self.product_id}, qty={self.cantidad})>"
