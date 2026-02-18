"""Router para gestión de Clientes / Contribuyentes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.customer import Customer
from app.schemas import CustomerCreate, CustomerOut, CustomerUpdate

router = APIRouter(prefix="/customers", tags=["customers"])


@router.post("/", response_model=CustomerOut, status_code=status.HTTP_201_CREATED,
             summary="Crear Cliente",
             description="Registra un nuevo cliente/contribuyente.")
def create_customer(customer: CustomerCreate, db: Session = Depends(get_db)):
    """Registra un nuevo cliente / contribuyente en la base de datos.
    
    Valida que el RUT no esté duplicado.
    
    Args:
        customer (CustomerCreate): Datos del cliente.
        db (Session): Sesión DB.
        
    Returns:
        CustomerOut: Cliente creado.
        
    Raises:
        HTTPException(409): Si ya existe un cliente con ese RUT.
    """

    # Verificar que el RUT no exista
    existing = db.query(Customer).filter(Customer.rut == customer.rut).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un cliente con RUT {customer.rut}",
        )

    db_customer = Customer(**customer.model_dump())
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.get("/", response_model=list[CustomerOut],
             summary="Listar Clientes",
             description="Obtiene todos los clientes registrados.")
def list_customers(db: Session = Depends(get_db)):
    """Lista todos los clientes."""
    return db.query(Customer).order_by(Customer.razon_social).all()


@router.get("/search", response_model=list[CustomerOut], summary="Buscar Clientes (Predictivo)")
def search_customers(q: str = "", db: Session = Depends(get_db)):
    """Busca clientes por RUT o Razón Social (coincidencia parcial)."""
    if not q:
        return []
    
    # Normalize query for RUT search (strip dots/dashes) if it looks like a RUT part
    clean_q = q.replace(".", "").replace("-", "")
    
    query = db.query(Customer).filter(
        (Customer.rut.ilike(f"%{clean_q}%")) |
        (Customer.razon_social.ilike(f"%{q}%"))
    ).limit(10)
    
    return query.all()


@router.get("/{rut}", response_model=CustomerOut,
             summary="Buscar Cliente",
             description="Busca un cliente por su RUT.")
def get_customer_by_rut(rut: str, db: Session = Depends(get_db)):
    """Busca un cliente por su RUT.
    
    Args:
        rut (str): RUT del cliente (formato '12345678-9').
        db (Session): Sesión DB.
        
    Returns:
        CustomerOut: Cliente encontrado.
        
    Raises:
        HTTPException(404): Si no se encuentra el cliente.
    """

    customer = db.query(Customer).filter(Customer.rut == rut).first()
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró un cliente con RUT {rut}",
        )
    return customer


@router.put("/{rut}", response_model=CustomerOut,
             summary="Actualizar Cliente",
             description="Actualiza datos de un cliente existente.")
def update_customer(rut: str, customer_update: CustomerUpdate, db: Session = Depends(get_db)):
    """Actualiza un cliente."""
    db_customer = db.query(Customer).filter(Customer.rut == rut).first()
    if not db_customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con RUT {rut} no encontrado"
        )
    
    # Update fields
    update_data = customer_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_customer, key, value)
    
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.delete("/{rut}", status_code=status.HTTP_204_NO_CONTENT,
               summary="Eliminar Cliente",
               description="Elimina un cliente por su RUT.")
def delete_customer(rut: str, db: Session = Depends(get_db)):
    """Elimina un cliente."""
    db_customer = db.query(Customer).filter(Customer.rut == rut).first()
    if not db_customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con RUT {rut} no encontrado"
        )
    
    db.delete(db_customer)
    db.commit()
    return None
