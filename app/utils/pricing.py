"""Resolución del precio unitario a cobrar, con o sin lista de precios."""

from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.price_list import PriceListProduct
from app.models.product import Product


def find_fixed_price(db: Session, price_list_id: int, product_id: int) -> Optional[Decimal]:
    """`fixed_price` de `product_id` en `price_list_id`, o None si no está en la lista."""
    assoc = (
        db.query(PriceListProduct)
        .filter(
            PriceListProduct.price_list_id == price_list_id,
            PriceListProduct.product_id == product_id,
        )
        .first()
    )
    return assoc.fixed_price if assoc else None


def resolve_unit_price(db: Session, product: Product, customer: Optional[Customer]) -> Decimal:
    """Precio unitario a cobrar por `product` al `customer` dado.

    Misma prioridad que `/price-lists/resolve-price/{product_id}`:
    1. Si el cliente tiene `price_list_id` y el producto tiene `fixed_price`
       en esa lista, se usa ese precio.
    2. En cualquier otro caso, `product.precio_neto`.

    Es la fuente de verdad tanto para lo que el POS muestra como para lo que
    `create_sale` cobra: el precio nunca lo decide lo que el cliente envía.
    """
    if customer is not None and customer.price_list_id is not None:
        fixed_price = find_fixed_price(db, customer.price_list_id, product.id)
        if fixed_price is not None:
            return fixed_price

    return product.precio_neto
