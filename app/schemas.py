"""Esquemas Pydantic para validación de datos en la API."""

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

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


# ── Sale (Venta) ─────────────────────────────────────────────────────


class SaleItem(BaseModel):
    """Item de venta (producto y cantidad) para la creación de una venta."""

    product_id: int
    cantidad: Decimal


class SaleCreate(BaseModel):
    """Datos requeridos para registrar una nueva venta."""

    rut_cliente: str
    tipo_dte: int = 33
    items: List[SaleItem]
    descripcion: Optional[str] = None


class SaleDetailOut(BaseModel):
    """Detalle de venta (producto, precio, cantidad) para la salida."""

    model_config = ConfigDict(from_attributes=True)

    product_id: int
    cantidad: Decimal
    precio_unitario: Decimal
    descuento: Decimal
    subtotal: Decimal
    product: ProductOut  # Nested product details


class SaleOut(BaseModel):
    """Representación completa de una venta."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    folio: int
    tipo_dte: int
    fecha_emision: datetime
    monto_neto: Decimal
    iva: Decimal
    monto_total: Decimal
    descripcion: Optional[str] = None
    created_at: datetime
    
    # Nested relationships
    user: CustomerOut
    details: List[SaleDetailOut]


# ── Issuer (Emisor) ──────────────────────────────────────────────────


class IssuerCreate(BaseModel):
    """Datos para crear / actualizar el emisor."""

    rut: str
    razon_social: str
    giro: str
    acteco: str
    direccion: Optional[str] = None
    comuna: Optional[str] = None
    ciudad: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None


class IssuerOut(BaseModel):
    """Representación del emisor devuelta por la API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    rut: str
    razon_social: str
    giro: str
    acteco: str
    direccion: Optional[str] = None
    comuna: Optional[str] = None
    ciudad: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
