"""Modelo de Caja (Sesiones)."""

from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base

class CashSession(Base):
    """Sesión de Caja (Turno de Cajero).

    Controla el ciclo de vida de una caja registradora, permitiendo aperturas,
    cierres y arqueos ciegos.

    Attributes:
        id (int): Identificador único (PK).
        user_id (int): Usuario cajero asignado (FK).
        start_time (datetime): Hora de apertura.
        end_time (datetime): Hora de cierre.
        start_amount (Numeric): Dinero en efectivo inicial (fondo de caja).
        final_cash_system (Numeric): Dinero esperado por el sistema (calculado).
        final_cash_declared (Numeric): Dinero declarado por el cajero (arqueo).
        difference (Numeric): Diferencia entre sistema y declarado.
        status (str): Estado de la sesión ('OPEN', 'CLOSED').
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

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<CashSession(user={self.user_id}, status={self.status}, start={self.start_amount})>"
