"""Modelo de Emisor (empresa que emite los DTE)."""

from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func

from app.database import Base


class Issuer(Base):
    """Datos del contribuyente emisor (singleton — una sola empresa).

    Almacena la información tributaria de la empresa dueña del sistema.
    Estos datos son obligatorios para generar el XML del DTE.

    Attributes:
        id (int): Identificador único (PK).
        rut (str): RUT de la empresa emisora.
        razon_social (str): Razón Social completa.
        giro (str): Giro comercial principal.
        acteco (str): Código de Actividad Económica (SII).
        direccion (str): Dirección de la casa matriz.
        comuna (str): Comuna.
        ciudad (str): Ciudad.
        telefono (str): Teléfono de contacto.
        email (str): Email de contacto.
        created_at (datetime): Fecha de creación.
        updated_at (datetime): Última actualización.
    """
    __tablename__ = "issuers"

    id = Column(Integer, primary_key=True, index=True)
    rut = Column(String(12), unique=True, nullable=False, index=True)
    razon_social = Column(String(200), nullable=False)
    giro = Column(String(200), nullable=False)
    acteco = Column(String(10), nullable=False,
                    comment="Código de actividad económica SII")
    direccion = Column(String(300))
    comuna = Column(String(100))
    ciudad = Column(String(100))
    telefono = Column(String(20))
    email = Column(String(150))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self) -> str:
        """Retorna representación string del objeto."""
        return f"<Issuer(rut='{self.rut}', razon_social='{self.razon_social}')>"
