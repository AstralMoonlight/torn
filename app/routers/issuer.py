"""Router para gestión del Emisor (datos de la empresa)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.issuer import Issuer
from app.schemas import IssuerCreate, IssuerOut

router = APIRouter(prefix="/issuer", tags=["issuer"])


@router.get("/", response_model=IssuerOut)
def get_issuer(db: Session = Depends(get_db)):
    """Obtiene los datos del emisor (empresa)."""

    issuer = db.query(Issuer).first()
    if not issuer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emisor no configurado. Use PUT /issuer/ para registrarlo.",
        )
    return issuer


@router.put("/", response_model=IssuerOut)
def upsert_issuer(data: IssuerCreate, db: Session = Depends(get_db)):
    """Crea o actualiza los datos del emisor (singleton)."""

    issuer = db.query(Issuer).first()

    if issuer:
        # Actualizar campos
        for field, value in data.model_dump().items():
            setattr(issuer, field, value)
    else:
        # Crear nuevo
        issuer = Issuer(**data.model_dump())
        db.add(issuer)

    db.commit()
    db.refresh(issuer)
    return issuer
