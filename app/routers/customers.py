"""Router para gestión de Clientes / Contribuyentes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas import CustomerCreate, CustomerOut

router = APIRouter(prefix="/customers", tags=["customers"])


@router.post("/", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
def create_customer(customer: CustomerCreate, db: Session = Depends(get_db)):
    """Registra un nuevo cliente / contribuyente en la base de datos."""

    # Verificar que el RUT no exista
    existing = db.query(User).filter(User.rut == customer.rut).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un cliente con RUT {customer.rut}",
        )

    db_customer = User(**customer.model_dump())
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.get("/{rut}", response_model=CustomerOut)
def get_customer_by_rut(rut: str, db: Session = Depends(get_db)):
    """Busca un cliente por su RUT."""

    customer = db.query(User).filter(User.rut == rut).first()
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró un cliente con RUT {rut}",
        )
    return customer
