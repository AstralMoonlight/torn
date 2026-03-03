"""Router para gestión de Listas de Precios.

CRUD completo para listas de precios, asignación de productos con precios fijos,
asignación de clientes a una lista, y resolución del precio final (lógica del POS).
"""

from typing import Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.dependencies.tenant import get_tenant_db
from app.models.price_list import PriceList, PriceListProduct
from app.models.customer import Customer
from app.models.product import Product

router = APIRouter(prefix="/price-lists", tags=["price-lists"])


# ── Schemas Pydantic ────────────────────────────────────────────────────────

class PriceItemSchema(BaseModel):
    """Producto con su precio fijo dentro de una lista."""
    product_id: int
    fixed_price: Decimal


class PriceListBase(BaseModel):
    name: str
    description: Optional[str] = None


class PriceListCreate(PriceListBase):
    pass


class PriceListUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class PriceListRead(PriceListBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class PriceListDetail(PriceListRead):
    """Lista con sus ítems de precios incluidos."""
    items: list[PriceItemSchema] = []

    @classmethod
    def from_orm_with_items(cls, pl: PriceList) -> "PriceListDetail":
        items = [
            PriceItemSchema(product_id=assoc.product_id, fixed_price=assoc.fixed_price)
            for assoc in pl.product_associations
        ]
        return cls(id=pl.id, name=pl.name, description=pl.description, items=items)


class AssignProductsRequest(BaseModel):
    """Payload para reemplazar los ítems de precio de una lista."""
    items: list[PriceItemSchema]


class AssignCustomersRequest(BaseModel):
    """Payload para asignar clientes a esta lista."""
    customer_ids: list[int]


class ResolvedPriceResponse(BaseModel):
    """Resultado de la resolución de precio final para el POS."""
    product_id: int
    customer_id: Optional[int] = None
    price_list_id: Optional[int] = None
    resolved_price: Decimal
    source: str  # "price_list" | "base_price"


# ── Helper ──────────────────────────────────────────────────────────────────

def _get_or_404(db: Session, price_list_id: int) -> PriceList:
    pl = db.query(PriceList).filter(PriceList.id == price_list_id).first()
    if not pl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Lista de precios {price_list_id} no encontrada.")
    return pl


# ── CRUD ────────────────────────────────────────────────────────────────────

@router.post("/", response_model=PriceListRead, status_code=status.HTTP_201_CREATED,
             summary="Crear Lista de Precios")
def create_price_list(data: PriceListCreate, db: Session = Depends(get_tenant_db)):
    """Crea una nueva lista de precios vacía."""
    pl = PriceList(**data.model_dump())
    db.add(pl)
    db.commit()
    db.refresh(pl)
    return pl


@router.get("/", response_model=list[PriceListRead], summary="Listar todas las Listas de Precios")
def list_price_lists(db: Session = Depends(get_tenant_db)):
    """Devuelve todas las listas de precios del tenant."""
    return db.query(PriceList).order_by(PriceList.name).all()


@router.get("/{price_list_id}", response_model=PriceListDetail, summary="Detalle de Lista de Precios")
def get_price_list(price_list_id: int, db: Session = Depends(get_tenant_db)):
    """Devuelve una lista de precios con sus ítems de producto."""
    return PriceListDetail.from_orm_with_items(_get_or_404(db, price_list_id))


@router.put("/{price_list_id}", response_model=PriceListRead, summary="Actualizar Lista de Precios")
def update_price_list(price_list_id: int, data: PriceListUpdate, db: Session = Depends(get_tenant_db)):
    """Actualiza nombre y/o descripción de una lista."""
    pl = _get_or_404(db, price_list_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(pl, key, value)
    db.commit()
    db.refresh(pl)
    return pl


@router.delete("/{price_list_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Eliminar Lista de Precios")
def delete_price_list(price_list_id: int, db: Session = Depends(get_tenant_db)):
    """Elimina la lista. Los clientes asignados quedarán sin lista (ON DELETE SET NULL)."""
    pl = _get_or_404(db, price_list_id)
    db.delete(pl)
    db.commit()
    return None


# ── Asignación de Productos ─────────────────────────────────────────────────

@router.put("/{price_list_id}/products", response_model=PriceListDetail, summary="Asignar Productos con Precio Fijo")
def assign_products(
    price_list_id: int,
    data: AssignProductsRequest,
    db: Session = Depends(get_tenant_db),
):
    """Reemplaza los ítems de precios de la lista por los enviados.

    Opera con un patrón clear-and-reinsert: borra todos los precios existentes
    en la pivote para esta lista y los recrea, lo que facilita bulk-updates
    desde el frontend sin necesidad de trackear diferencias.
    """
    pl = _get_or_404(db, price_list_id)

    # Validar que todos los product_ids existen
    product_ids = [item.product_id for item in data.items]
    if product_ids:
        found = db.query(Product.id).filter(Product.id.in_(product_ids)).all()
        found_ids = {r[0] for r in found}
        missing = set(product_ids) - found_ids
        if missing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Productos no encontrados: {sorted(missing)}"
            )

    # Clear & Reinsert
    db.query(PriceListProduct).filter(
        PriceListProduct.price_list_id == price_list_id
    ).delete(synchronize_session="fetch")

    for item in data.items:
        assoc = PriceListProduct(
            price_list_id=price_list_id,
            product_id=item.product_id,
            fixed_price=item.fixed_price,
        )
        db.add(assoc)

    db.commit()
    db.refresh(pl)
    return PriceListDetail.from_orm_with_items(pl)


# ── Asignación de Clientes ──────────────────────────────────────────────────

@router.put("/{price_list_id}/customers", summary="Asignar Clientes a Lista de Precios")
def assign_customers(
    price_list_id: int,
    data: AssignCustomersRequest,
    db: Session = Depends(get_tenant_db),
):
    """Asigna una lista de price_list_id a los customer_ids recibidos.

    Los clientes que antes estuviesen asignados a otra lista la pierden; los
    clientes ya asignados a esta lista que NO aparezcan en la lista nueva
    quedan disociados (price_list_id = NULL).
    """
    _get_or_404(db, price_list_id)

    # Validar que todos los customer_ids existen
    if data.customer_ids:
        found = db.query(Customer.id).filter(Customer.id.in_(data.customer_ids)).all()
        found_ids = {r[0] for r in found}
        missing = set(data.customer_ids) - found_ids
        if missing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Clientes no encontrados: {sorted(missing)}"
            )

    # Primero, desasociar los clientes que actualmente tienen esta lista pero no están en el nuevo set
    db.query(Customer).filter(
        Customer.price_list_id == price_list_id,
        ~Customer.id.in_(data.customer_ids)
    ).update({"price_list_id": None}, synchronize_session="fetch")

    # Asignar la lista a los clientes del request
    if data.customer_ids:
        db.query(Customer).filter(
            Customer.id.in_(data.customer_ids)
        ).update({"price_list_id": price_list_id}, synchronize_session="fetch")

    db.commit()
    return {"detail": f"{len(data.customer_ids)} cliente(s) asignados a la lista {price_list_id}."}


# ── Resolución de Precio Final (Cerebro del POS) ────────────────────────────

@router.get("/resolve-price/{product_id}", response_model=ResolvedPriceResponse,
            summary="Resolver Precio Final para el POS")
def resolve_price(
    product_id: int,
    customer_id: Optional[int] = None,
    db: Session = Depends(get_tenant_db),
):
    """Calcula el precio final a aplicar para un producto dado un cliente opcional.

    **Lógica de resolución (en orden de prioridad):**
    1. Si `customer_id` tiene una `price_list_id` asignada, Y el producto tiene
       un `fixed_price` en esa lista → devuelve `fixed_price`.
    2. En cualquier otro caso → devuelve el `precio_neto` base del producto.

    Ideal para ser llamado por el terminal POS al escanear un ítem sabiendo el cliente activo.
    """
    # 1. Verify product exists
    product = db.query(Product).filter(Product.id == product_id, Product.is_active == True).first()
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Producto {product_id} no encontrado o inactivo.",
        )

    base_price = product.precio_neto

    # 2. If no customer, return base price immediately
    if customer_id is None:
        return ResolvedPriceResponse(
            product_id=product_id,
            resolved_price=base_price,
            source="base_price",
        )

    # 3. Fetch the customer's price list
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer or customer.price_list_id is None:
        return ResolvedPriceResponse(
            product_id=product_id,
            customer_id=customer_id,
            resolved_price=base_price,
            source="base_price",
        )

    # 4. Look up the fixed price in the pivot table
    assoc = db.query(PriceListProduct).filter(
        PriceListProduct.price_list_id == customer.price_list_id,
        PriceListProduct.product_id == product_id,
    ).first()

    if assoc:
        return ResolvedPriceResponse(
            product_id=product_id,
            customer_id=customer_id,
            price_list_id=customer.price_list_id,
            resolved_price=assoc.fixed_price,
            source="price_list",
        )

    # 5. Product not in the list → fallback to base price
    return ResolvedPriceResponse(
        product_id=product_id,
        customer_id=customer_id,
        price_list_id=customer.price_list_id,
        resolved_price=base_price,
        source="base_price",
    )
