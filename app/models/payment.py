"""Modelos de Medios de Pago."""

from sqlalchemy import Column, Integer, String, Numeric, ForeignKey, Boolean
from sqlalchemy.orm import relationship

from app.database import Base


class PaymentMethod(Base):
    """Catálogo de Medios de Pago.

    Lista de formas de pago aceptadas (Efectivo, Débito, Crédito, etc.).

    Attributes:
        id (int): Identificador único (PK).
        code (str): Código nemotécnico (CASH, DEBIT, CREDIT_INTERNO).
        name (str): Nombre visible para el cajero.
        is_active (bool): Si está habilitado para su uso.
    """
    __tablename__ = "payment_methods"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False, index=True, comment="CASH, DEBIT, CREDIT, TRANSFER")
    name = Column(String(50), nullable=False)
    is_active = Column(Boolean, default=True)

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<PaymentMethod(code={self.code}, name={self.name})>"


class SalePayment(Base):
    """Registro de Pago.

    Asocia un monto pagado en una venta a un medio de pago específico. 
    Una venta puede tener múltiples registros de pago (pago mixto).

    Attributes:
        id (int): Identificador único (PK).
        sale_id (int): Venta pagada (FK).
        payment_method_id (int): Medio de pago utilizado (FK).
        amount (Numeric): Monto cubierto con este medio.
        transaction_code (str): Código de autorización (voucher) si aplica.
    """
    __tablename__ = "sale_payments"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    payment_method_id = Column(Integer, ForeignKey("payment_methods.id"), nullable=False)
    
    amount = Column(Numeric(15, 2), nullable=False)
    transaction_code = Column(String(100), nullable=True, comment="Nro operación Transbank/Banco")

    # Relaciones
    sale = relationship("app.models.sale.Sale", backref="payments")
    payment_method = relationship("PaymentMethod")

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<SalePayment(sale={self.sale_id}, method={self.payment_method_id}, amount={self.amount})>"
