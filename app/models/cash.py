"""Modelo de Caja (Sesiones)."""

from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base

class CashSession(Base):
    """
    Sesión de caja (Turno).
    Controla la apertura y cierre de caja por usuario.
    """
    __tablename__ = "cash_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    start_time = Column(DateTime(timezone=True), server_default=func.now())
    end_time = Column(DateTime(timezone=True), nullable=True)
    
    start_amount = Column(Numeric(15, 2), nullable=False, comment="Monto de apertura")
    
    # Valores calculados al cierre
    final_cash_system = Column(Numeric(15, 2), default=0, comment="Efectivo esperado por ventas/retiros")
    final_cash_declared = Column(Numeric(15, 2), default=0, comment="Efectivo contado por cajero")
    difference = Column(Numeric(15, 2), default=0, comment="Diferencia (Sobra/Falta)")
    
    status = Column(String(20), default="OPEN", index=True, comment="OPEN | CLOSED")

    # Relaciones
    user = relationship("app.models.user.User", backref="cash_sessions")

    def __repr__(self):
        return f"<CashSession(user={self.user_id}, status={self.status}, start={self.start_amount})>"
