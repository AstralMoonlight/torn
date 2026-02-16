"""Modelo de Marca."""

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Brand(Base):
    """Modelo de Marca de Producto."""
    __tablename__ = "brands"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)

    # Relación inversa (opcional, para acceder desde Brand a Products)
    products = relationship("Product", back_populates="brand")

    def __repr__(self):
        return f"<Brand(name='{self.name}')>"
