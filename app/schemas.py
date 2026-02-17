"""Esquemas Pydantic para validación de datos en la API."""

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, field_validator


from app.utils.validators import validar_rut


# ── Brand (Marca) ────────────────────────────────────────────────────


class BrandBase(BaseModel):
    name: str

class BrandCreate(BrandBase):
    pass

class BrandUpdate(BrandBase):
    name: Optional[str] = None

class BrandOut(BrandBase):
    id: int
    model_config = ConfigDict(from_attributes=True)



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

    @field_validator("rut")
    @classmethod
    def rut_valido(cls, v: str) -> str:
        return validar_rut(v)


class CustomerUpdate(BaseModel):
    """Datos opcionales para actualizar cliente."""

    rut: Optional[str] = None
    razon_social: Optional[str] = None
    giro: Optional[str] = None
    direccion: Optional[str] = None
    comuna: Optional[str] = None
    ciudad: Optional[str] = None
    email: Optional[str] = None

    @field_validator("rut")
    @classmethod
    def rut_valido(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return validar_rut(v)
        return v


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
    email: Optional[str] = None
    current_balance: Decimal
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
    codigo_barras: Optional[str] = None
    controla_stock: bool = False
    stock_actual: Decimal = Decimal(0)
    stock_minimo: Decimal = Decimal(0)
    parent_id: Optional[int] = None
    brand_id: Optional[int] = None


class ProductUpdate(BaseModel):
    """Datos para actualizar un producto."""
    codigo_interno: Optional[str] = None
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    precio_neto: Optional[Decimal] = None
    costo_unitario: Optional[Decimal] = None
    unidad_medida: Optional[str] = None
    codigo_barras: Optional[str] = None
    controla_stock: Optional[bool] = None
    stock_minimo: Optional[Decimal] = None
    stock_actual: Optional[Decimal] = None
    is_active: Optional[bool] = None
    brand_id: Optional[int] = None


class ProductOut(BaseModel):
    """Representación de un producto devuelta por la API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    codigo_interno: str
    nombre: str
    descripcion: Optional[str] = None
    precio_neto: Decimal
    costo_unitario: Decimal
    unidad_medida: str
    codigo_barras: Optional[str] = None
    controla_stock: bool
    stock_actual: Decimal
    stock_minimo: Decimal
    is_active: bool
    is_deleted: bool
    updated_at: Optional[datetime] = None
    
    # Propiedades calculadas
    full_name: str
    
    # Jerarquía
    parent_id: Optional[int] = None
    brand_id: Optional[int] = None
    brand: Optional[BrandOut] = None
    variants: List["ProductOut"] = []


# ── Sale (Venta) ─────────────────────────────────────────────────────


class SaleItem(BaseModel):
    """Item de venta (producto y cantidad) para la creación de una venta."""

    product_id: int
    cantidad: Decimal


class SalePaymentCreate(BaseModel):
    payment_method_id: int
    amount: Decimal
    transaction_code: Optional[str] = None


class SaleCreate(BaseModel):
    """Datos requeridos para registrar una nueva venta."""

    rut_cliente: str
    tipo_dte: int = 33
    items: List[SaleItem]
    payments: List[SalePaymentCreate]  # Pagos múltiples
    descripcion: Optional[str] = None
    seller_id: Optional[int] = None

    @field_validator("rut_cliente")
    @classmethod
    def rut_valido(cls, v: str) -> str:
        return validar_rut(v)


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
    related_sale_id: Optional[int] = None
    
    user: CustomerOut
    details: List[SaleDetailOut]


class ReturnItem(BaseModel):
    product_id: int
    cantidad: Decimal


class ReturnCreate(BaseModel):
    original_sale_id: int
    items: List[ReturnItem]
    reason: str
    return_method_id: int # ID de medio de pago para devolución (Caja o Credito)


# ── Medios de Pago ───────────────────────────────────────────────────


class PaymentMethodOut(BaseModel):
    id: int
    code: str
    name: str
    is_active: bool
    model_config = ConfigDict(from_attributes=True)


# ── Caja (Cash Session) ──────────────────────────────────────────────


class CashSessionCreate(BaseModel):
    start_amount: Decimal
    user_id: int


class CashSessionClose(BaseModel):
    final_cash_declared: Decimal


class CashSessionOut(BaseModel):
    id: int
    user_id: int
    start_time: datetime
    end_time: Optional[datetime] = None
    start_amount: Decimal
    final_cash_system: Decimal
    final_cash_declared: Decimal
    difference: Decimal
    status: str
    model_config = ConfigDict(from_attributes=True)


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

    @field_validator("rut")
    @classmethod
    def rut_valido(cls, v: str) -> str:
        return validar_rut(v)


class IssuerUpdate(BaseModel):
    """Datos opcionales para actualizar el emisor (actualización parcial)."""

    rut: Optional[str] = None
    razon_social: Optional[str] = None
    giro: Optional[str] = None
    acteco: Optional[str] = None
    direccion: Optional[str] = None
    comuna: Optional[str] = None
    ciudad: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None

    @field_validator("rut")
    @classmethod
    def rut_valido(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return validar_rut(v)
        return v


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


# ── Provider (Proveedor) ─────────────────────────────────────────────


class ProviderBase(BaseModel):
    rut: str
    razon_social: str
    giro: Optional[str] = None
    direccion: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None

    @field_validator("rut")
    @classmethod
    def rut_valido(cls, v: str) -> str:
        return validar_rut(v)


class ProviderCreate(ProviderBase):
    pass


class ProviderUpdate(BaseModel):
    rut: Optional[str] = None
    razon_social: Optional[str] = None
    giro: Optional[str] = None
    direccion: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("rut")
    @classmethod
    def rut_valido(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return validar_rut(v)
        return v


class ProviderOut(ProviderBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ── Purchase (Compra) ────────────────────────────────────────────────


class PurchaseItem(BaseModel):
    product_id: int
    cantidad: Decimal
    precio_costo_unitario: Decimal


class PurchaseCreate(BaseModel):
    provider_id: int
    folio: Optional[str] = None
    tipo_documento: str = "FACTURA"  # FACTURA | BOLETA | SIN_DOCUMENTO
    items: List[PurchaseItem]
    observacion: Optional[str] = None


class PurchaseDetailOut(BaseModel):
    id: int
    product_id: int
    cantidad: Decimal
    precio_costo_unitario: Decimal
    subtotal: Decimal
    product: ProductOut
    model_config = ConfigDict(from_attributes=True)


class PurchaseOut(BaseModel):
    id: int
    provider_id: int
    folio: Optional[str] = None
    tipo_documento: str
    fecha_compra: datetime
    monto_neto: Decimal
    iva: Decimal
    monto_total: Decimal
    observacion: Optional[str] = None
    created_at: datetime
    provider: ProviderOut
    details: List[PurchaseDetailOut]
    model_config = ConfigDict(from_attributes=True)


# ── Dashboard & Stats ────────────────────────────────────────────────


class StatPeriod(BaseModel):
    sales_total: Decimal
    sales_count: int
    margin_total: Decimal
    period: str  # 'Diario' | 'Semanal' | 'Mensual'


class DashboardSummary(BaseModel):
    daily: StatPeriod
    weekly: StatPeriod
    monthly: StatPeriod


class TopProduct(BaseModel):
    product_id: int
    nombre: str
    full_name: Optional[str] = None
    total_qty: Decimal
    total_margin: Decimal
    total_sales: Decimal


class TopProductsResponse(BaseModel):
    by_quantity: List[TopProduct]
    by_margin: List[TopProduct]
