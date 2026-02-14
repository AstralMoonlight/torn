"""Modelos de Medios de Pago."""

from sqlalchemy import Column, Integer, String, Numeric, ForeignKey, Boolean
from sqlalchemy.orm import relationship

from app.database import Base


class PaymentMethod(Base):
    """Catalog de medios de pago (Efectivo, Débito, Crédito, etc)."""
    __tablename__ = "payment_methods"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False, index=True, comment="CASH, DEBIT, CREDIT, TRANSFER")
    name = Column(String(50), nullable=False)
    is_active = Column(Boolean, default=True)

    def __repr__(self):
        return f"<PaymentMethod(code={self.code}, name={self.name})>"


class SalePayment(Base):
    """Registro de pago asociado a una venta (soporta pagos mixtos)."""
    __tablename__ = "sale_payments"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    payment_method_id = Column(Integer, ForeignKey("payment_methods.id"), nullable=False)
    
    amount = Column(Numeric(15, 2), nullable=False)
    transaction_code = Column(String(100), nullable=True, comment="Nro operación Transbank/Banco")

    # Relaciones
    sale = relationship("app.models.sale.Sale", backref="payments")
    payment_method = relationship("PaymentMethod")

    def __repr__(self):
        return f"<SalePayment(sale={self.sale_id}, method={self.payment_method_id}, amount={self.amount})>"
