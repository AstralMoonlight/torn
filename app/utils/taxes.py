"""Resolución de tasas de impuesto para documentos tributarios.

Centraliza la lógica que antes estaba duplicada como `Decimal("0.19")` en los
routers de ventas y compras. Dos reglas mandan sobre el IVA de una línea:

1. El **tipo de DTE**: los documentos exentos y de exportación no llevan IVA,
   sin importar qué impuesto tenga configurado el producto.
2. El **impuesto del producto** (`Product.tax`): permite productos exentos o con
   tasas distintas dentro de un documento afecto.
"""

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

#: Tasa aplicada cuando el producto no tiene un `Tax` asociado.
DEFAULT_TAX_RATE = Decimal("0.19")

#: Tipos de DTE que nunca llevan IVA.
#: 34 = Factura Exenta, 41 = Boleta Exenta, 110/111/112 = documentos de exportación.
EXEMPT_DTES = frozenset({34, 41, 110, 111, 112})

_CENT = Decimal("0.01")


def normalize_tax_rate(rate) -> Decimal:
    """Normaliza una tasa a fracción decimal.

    Acepta tanto la forma fraccionaria (`0.19`) como la porcentual (`19`), porque
    ambas conviven en datos históricos. El frontend hace la misma normalización en
    `frontend/app/listas-precios/page.tsx`.

    Args:
        rate: Tasa en cualquiera de las dos formas. `None` devuelve 0.

    Returns:
        La tasa como fracción decimal (`Decimal("0.19")`).
    """
    if rate is None:
        return Decimal("0")
    value = Decimal(str(rate))
    if value > 1:
        value = value / Decimal("100")
    return value


def resolve_tax_rate(product, tipo_dte: Optional[int]) -> Decimal:
    """Determina la tasa de impuesto aplicable a una línea de venta.

    Args:
        product: Instancia de `Product` (puede tener `tax` en `None`).
        tipo_dte: Código del DTE que se está emitiendo.

    Returns:
        La tasa a aplicar sobre el neto de la línea. Cero para DTEs exentos.
    """
    if tipo_dte is not None and int(tipo_dte) in EXEMPT_DTES:
        return Decimal("0")

    tax = getattr(product, "tax", None)
    if tax is None:
        return DEFAULT_TAX_RATE
    return normalize_tax_rate(tax.rate)


def quantize_money(amount: Decimal) -> Decimal:
    """Redondea un monto a dos decimales con redondeo comercial (half-up)."""
    return Decimal(amount).quantize(_CENT, rounding=ROUND_HALF_UP)
