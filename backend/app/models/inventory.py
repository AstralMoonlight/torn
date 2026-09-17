"""Modelo de Inventario (Movimientos de Stock)."""

from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class StockMovement(Base):
    """Movimiento de Inventario (Kardex).

    Registro inmutable de cada cambio en el stock de un producto. Permite
    trazabilidad completa y auditoría de inventario.

    Attributes:
        id (int): Identificador único (PK).
        product_id (int): Producto afectado (FK).
        user_id (int): Usuario que generó el movimiento (FK).
        tipo (str): Naturaleza del movimiento ('ENTRADA' o 'SALIDA').
        motivo (str): Razón de negocio ('VENTA', 'COMPRA', 'AJUSTE', 'DEVOLUCION').
        cantidad (Numeric): Cantidad movida (valor absoluto).
        fecha (datetime): Timestamp del movimiento.
        balance_after (Numeric): Stock resultante tras el movimiento (snapshot).
        description (str): Glosa explicativa libre.
        sale_id (int): Venta asociada si corresponde (FK).
    """
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, comment="Usuario que generó el movimiento")
    
    tipo = Column(String(20), nullable=False, comment="ENTRADA | SALIDA")
    motivo = Column(String(50), nullable=False, comment="VENTA | COMPRA | AJUSTE | INICIAL")
    cantidad = Column(Numeric(15, 4), nullable=False, comment="Valor absoluto de la cantidad movida")
    
    fecha = Column(DateTime(timezone=True), server_default=func.now())
    
    # Auditoría y Trazabilidad
    balance_after = Column(Numeric(15, 4), nullable=True, comment="Stock resultante tras movimiento")
    description = Column(String(255), nullable=True)

    # Referencias
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    
    # Relaciones
    product = relationship("app.models.product.Product", backref="stock_movements")
    user = relationship("app.models.user.User")
    sale = relationship("app.models.sale.Sale", backref="stock_movements")

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<StockMovement(prod={self.product_id}, tipo={self.tipo}, cant={self.cantidad})>"
