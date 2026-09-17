"""Catálogo ACTECO (actividades económicas SII Chile). Reside en esquema public."""

from sqlalchemy import Column, String, Boolean

from app.database import Base


class Acteco(Base):
    __tablename__ = "actecos"
    __table_args__ = {"schema": "public"}

    code = Column(String(20), primary_key=True, index=True)
    name = Column(String(500), nullable=False, index=True)
    taxable = Column(Boolean, default=True)
    category = Column(String(20), nullable=True)
    internet_available = Column(Boolean, default=True)
