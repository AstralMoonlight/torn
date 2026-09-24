"""Router para gestión del Emisor (datos de la empresa)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies.tenant import get_current_tenant_user, get_tenant_db
from app.models.issuer import Issuer
from app.models.saas import TenantUser
from app.services import dte_client
from app.schemas import IssuerCreate, IssuerOut, IssuerUpdate

router = APIRouter(prefix="/issuer", tags=["issuer"])


@router.get("/", response_model=IssuerOut,
             summary="Obtener Emisor",
             description="Retorna los datos tributarios de la empresa emisora.")
def get_issuer(db: Session = Depends(get_tenant_db)):
    """Obtiene los datos del emisor (empresa).
    
    Args:
        db (Session): Sesión DB.
        
    Returns:
        IssuerOut: Objeto con datos del emisor.
        
    Raises:
        HTTPException(404): Si no está configurado.
    """

    issuer = db.query(Issuer).first()
    if not issuer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emisor no configurado. Use PUT /issuer/ para registrarlo.",
        )
    return issuer


@router.put("/", response_model=IssuerOut,
             summary="Configurar Emisor",
             description="Crea o actualiza los datos tributarios de la empresa.")
def upsert_issuer(
    data: IssuerUpdate,
    db: Session = Depends(get_tenant_db),
    tenant_user: TenantUser = Depends(get_current_tenant_user),
):
    """Crea o actualiza los datos del emisor (singleton).
    
    Si ya existe, actualiza parcialmente los campos no nulos.
    Si no existe, crea uno nuevo. El resultado se copia a dte-torn; si dte-torn
    lo rechaza, no se guarda nada.
    
    Args:
        data (IssuerUpdate): Datos nuevos o a actualizar.
        db (Session): Sesión DB.
        
    Returns:
        IssuerOut: Emisor actualizado.
    """

    issuer = db.query(Issuer).first()

    if issuer:
        # Actualización parcial: solo campos enviados (no-None)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(issuer, field, value)
    else:
        # Crear nuevo (requiere campos obligatorios)
        issuer = Issuer(**data.model_dump(exclude_unset=True))
        db.add(issuer)

    db.flush()
    try:
        dte_client.sincronizar_emisor(tenant_user.tenant, issuer)
    except dte_client.DteError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code,
                            detail=f"No se pudo registrar el emisor en facturación electrónica: {exc.detail}") from exc
    db.commit()
    db.refresh(issuer)
    return issuer
