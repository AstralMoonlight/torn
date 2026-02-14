"""Esquemas Pydantic para validación de datos en la API."""

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ── Customer (Contribuyente) ─────────────────────────────────────────


class CustomerCreate(BaseModel):
    """Datos requeridos para crear un nuevo cliente / contribuyente."""

    rut: str
    razon_social: str
    giro: Optional[str] = None
    direccion: Optional[str] = None
    comuna: Optional[str] = None
    ciudad: Optional[str] = None
    email: Optional[str] = None


class CustomerOut(BaseModel):
    """Representación de un cliente devuelta por la API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    rut: str
    razon_social: str
    giro: Optional[str] = None
    direccion: Optional[str] = None
    comuna: Optional[str] = None
    ciudad: Optional[str] = None
    email: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None


# ── Product (Producto) ───────────────────────────────────────────────


class ProductCreate(BaseModel):
    """Datos requeridos para crear un nuevo producto."""

    codigo_interno: str
    nombre: str
    descripcion: Optional[str] = None
    precio_neto: Decimal
    unidad_medida: str = "unidad"


class ProductOut(BaseModel):
    """Representación de un producto devuelta por la API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    codigo_interno: str
    nombre: str
    descripcion: Optional[str] = None
    precio_neto: Decimal
    unidad_medida: str
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

