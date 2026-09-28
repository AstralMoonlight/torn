"""Kardex: único punto que cambia el stock de un producto.

Regla: el stock actual es la suma de su kardex. Todo cambio de `stock_actual`
pasa por `mover_stock`, que anota la línea con el saldo que queda.
"""

from decimal import Decimal

from app.models.inventory import StockMovement
from app.models.product import Product


def mover_stock(product: Product, cantidad: Decimal, motivo: str, user_id: int | None = None,
                description: str | None = None) -> StockMovement:
    """Suma `cantidad` (negativa si sale) al stock y devuelve su línea del kardex.

    La línea no se agrega a la sesión: el llamador la agrega o la cuelga de la
    venta (`Sale.stock_movements`), que así le pone el `sale_id`.
    """
    product.stock_actual = (product.stock_actual or Decimal(0)) + cantidad
    return StockMovement(
        product_id=product.id,
        user_id=user_id,
        tipo="ENTRADA" if cantidad >= 0 else "SALIDA",
        motivo=motivo,
        cantidad=abs(cantidad),
        balance_after=product.stock_actual,
        description=description[:255] if description else None,
    )
