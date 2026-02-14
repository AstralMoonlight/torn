"""Modelos de Documento Tributario Electrónico (DTE) y Folios (CAF)."""

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class DTE(Base):
    __tablename__ = "dtes"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    tipo_dte = Column(Integer, nullable=False, comment="33=Factura, 34=Exenta, 61=NC, 56=ND")
    folio = Column(Integer, nullable=False)
    xml_content = Column(Text, comment="XML firmado del DTE")
    track_id = Column(String(50), comment="Track ID devuelto por el SII")
    estado_sii = Column(String(20), default="pendiente", comment="pendiente|enviado|aceptado|rechazado")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    sale = relationship("Sale", backref="dtes")

    def __repr__(self):
        return f"<DTE(tipo={self.tipo_dte}, folio={self.folio}, estado='{self.estado_sii}')>"


class CAF(Base):
    """Código de Autorización de Folios — rangos autorizados por el SII."""
    __tablename__ = "cafs"

    id = Column(Integer, primary_key=True, index=True)
    tipo_documento = Column(Integer, unique=True, nullable=False,
                            comment="33=Factura, 34=Exenta, 39=Boleta, 61=NC")
    folio_desde = Column(Integer, nullable=False)
    folio_hasta = Column(Integer, nullable=False)
    ultimo_folio_usado = Column(Integer, nullable=False, default=0)
    xml_caf = Column(Text, nullable=False, comment="XML del CAF entregado por el SII")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<CAF(tipo={self.tipo_documento}, rango={self.folio_desde}-{self.folio_hasta})>"

