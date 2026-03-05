"""Modelos de Documento Tributario Electrónico (DTE) y Folios (CAF)."""

from sqlalchemy import Column, Integer, String, Text, DateTime, Date, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.database import Base


class DTE(Base):
    """Documento Tributario Electrónico generado.

    Representa un XML firmado y listo para (o ya) enviado al SII.

    Attributes:
        id (int): Identificador único (PK).
        sale_id (int): ID de la venta asociada (FK).
        tipo_dte (int): Tipo de documento (33, 39, 61...).
        folio (int): Folio asignado.
        xml_content (str): Contenido XML firmado digitalmente.
        track_id (str): Identificador de envío devuelto por el SII.
        estado_sii (str): Estado del envío (pendiente, aceptado, rechazado).
        created_at (datetime): Fecha de generación.
        updated_at (datetime): Última actualización de estado.
    """
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

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<DTE(tipo={self.tipo_dte}, folio={self.folio}, estado='{self.estado_sii}')>"


class CAF(Base):
    """Código de Autorización de Folios (CAF).

    Almacena los rangos de folios autorizados por el SII mediante un archivo XML
    que debe ser cargado en el sistema para poder emitir documentos.

    Attributes:
        id (int): Identificador único (PK).
        tipo_documento (int): Tipo DTE al que corresponde el CAF.
        folio_desde (int): Folio inicial del rango.
        folio_hasta (int): Folio final del rango.
        ultimo_folio_usado (int): Puntero al último folio emitido.
        xml_caf (str): Contenido del archivo CAF (XML).
        created_at (datetime): Fecha de carga al sistema.
    """
    __tablename__ = "cafs"

    id = Column(Integer, primary_key=True, index=True)
    tipo_documento = Column(Integer, unique=True, nullable=False,
                            comment="33=Factura, 34=Exenta, 39=Boleta, 61=NC")
    folio_desde = Column(Integer, nullable=False)
    folio_hasta = Column(Integer, nullable=False)
    ultimo_folio_usado = Column(Integer, nullable=False, default=0)
    fecha_vencimiento = Column(Date, nullable=True, comment="Vigencia (6 meses desde autorización)")
    xml_caf = Column(Text, nullable=False, comment="XML del CAF entregado por el SII")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<CAF(tipo={self.tipo_documento}, rango={self.folio_desde}-{self.folio_hasta}, vto={self.fecha_vencimiento})>"


class FolioRequestLog(Base):
    """Registro de solicitudes de folios al SII.

    Trackea el historial de solicitudes de nuevos folios (CAF) realizadas por el usuario.

    Attributes:
        id (int): Identificador único (PK).
        dte_type (int): Tipo de DTE solicitado (33, 39, 61, etc).
        amount_requested (int): Cantidad de folios solicitados.
        status (str): Estado de la solicitud (PENDING, COMPLETED, ERROR).
        timestamp (datetime): Fecha y hora de la solicitud.
    """
    __tablename__ = "folio_request_logs"

    id = Column(Integer, primary_key=True, index=True)
    dte_type = Column(Integer, nullable=False, comment="33=Factura, 34=Exenta, 39=Boleta, 61=NC")
    amount_requested = Column(Integer, nullable=False)
    status = Column(String(20), default="PENDING", comment="PENDING|COMPLETED|ERROR")
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<FolioRequestLog(dte={self.dte_type}, amount={self.amount_requested}, status='{self.status}')>"

