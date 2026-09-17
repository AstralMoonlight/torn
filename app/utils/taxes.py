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

#: El peso chileno no tiene submúltiplos en uso: nadie cobra ni paga
#: centavos. `quantize_money` redondeaba a 2 decimales (Decimal("0.01")),
#: así que un IVA por línea que no cerraba en un peso exacto (p.ej.
#: 950 * 0.19 = 180.50) dejaba el total con una fracción de peso que el
#: frontend nunca podía reproducir (trabaja en pesos enteros, `Math.round`).
#: Para efectivo el redondeo a la decena lo disimulaba; para cualquier otro
#: medio de pago, que exige el monto exacto, la venta se rechazaba con un
#: "vuelto" fantasma de unos centavos. Ver issue reportado en sesión: boleta
#: con Débito rechazada por "$0.50" de diferencia.
_PESO = Decimal("1")


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


#: Tipos de documento de compra que se registran como afectos a IVA.
#: `Purchase.tipo_documento` es texto: FACTURA | BOLETA | SIN_DOCUMENTO.
PURCHASE_TAXED_DOCUMENTS = frozenset({"FACTURA"})


def resolve_purchase_tax_rate(product, tipo_documento: Optional[str]) -> Decimal:
    """Determina la tasa de impuesto aplicable a una línea de compra.

    Args:
        product: Instancia de `Product` (puede tener `tax` en `None`).
        tipo_documento: `Purchase.tipo_documento`.

    Returns:
        La tasa a aplicar sobre el neto de la línea, o cero si el documento no
        se registra como afecto.
    """
    if (tipo_documento or "").strip().upper() not in PURCHASE_TAXED_DOCUMENTS:
        return Decimal("0")

    tax = getattr(product, "tax", None)
    if tax is None:
        return DEFAULT_TAX_RATE
    return normalize_tax_rate(tax.rate)


def quantize_money(amount: Decimal) -> Decimal:
    """Redondea un monto al peso entero más cercano (redondeo half-up).

    El CLP no tiene centavos: iva/total/vuelto/ajuste_redondeo siempre deben
    quedar en pesos enteros para que coincidan con lo que el frontend calcula
    (también en pesos enteros) y con lo que se declara en el DTE (que ya
    trunca a entero vía el filtro `|int` en las plantillas XML).
    """
    return Decimal(amount).quantize(_PESO, rounding=ROUND_HALF_UP)


def round_to_nearest_ten(amount: Decimal) -> Decimal:
    """Redondea a la decena de pesos más cercana (regla chilena de efectivo).

    El último dígito 0-4 baja a la decena actual, 5-9 sube a la siguiente.
    Misma regla que `roundCash` en `frontend/components/pos/CheckoutModal.tsx`;
    si una cambia, la otra tiene que cambiar junto.
    """
    pesos = int(Decimal(amount).to_integral_value(rounding=ROUND_HALF_UP))
    last_digit = pesos % 10
    if last_digit < 5:
        pesos -= last_digit
    else:
        pesos += 10 - last_digit
    return Decimal(pesos)
