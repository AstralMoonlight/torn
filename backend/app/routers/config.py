"""Router para configuración del sistema e impuestos."""

from typing import Annotated, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies.tenant import es_admin, get_current_tenant_user, get_tenant_db
from app.models.cash import CashSession
from app.models.saas import TenantUser
from app.models.tax import Tax
from app.models.settings import SystemSettings
from app.schemas import (
    TaxCreate, TaxUpdate, TaxOut,
    SettingsUpdate, SettingsOut
)

router = APIRouter(prefix="/config", tags=["config"])


# ── Impuestos (Taxes) ────────────────────────────────────────────────

@router.get("/taxes/", response_model=List[TaxOut])
def list_taxes(db: Session = Depends(get_tenant_db)):
    """Lista todos los impuestos."""
    return db.query(Tax).all()

@router.post("/taxes/", response_model=TaxOut, status_code=status.HTTP_201_CREATED)
def create_tax(tax_in: TaxCreate, db: Session = Depends(get_tenant_db)):
    """Crea un nuevo impuesto."""
    tax = Tax(**tax_in.model_dump())
    db.add(tax)
    db.commit()
    db.refresh(tax)
    return tax

@router.put("/taxes/{tax_id}", response_model=TaxOut)
def update_tax(tax_id: int, tax_in: TaxUpdate, db: Session = Depends(get_tenant_db)):
    """Actualiza un impuesto existente."""
    tax = db.query(Tax).get(tax_id)
    if not tax:
        raise HTTPException(status_code=404, detail="Impuesto no encontrado")
    
    for field, value in tax_in.model_dump(exclude_unset=True).items():
        setattr(tax, field, value)
    
    db.commit()
    db.refresh(tax)
    return tax


# ── Configuración (Settings) ─────────────────────────────────────────

@router.get("/settings/", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_tenant_db)):
    """Obtiene la configuración global del sistema."""
    settings = db.query(SystemSettings).first()
    if not settings:
        # Inicializar settings por defecto si no existen
        settings = SystemSettings(id=1, print_format="80mm")
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

#: Ajustes que afectan a toda la empresa y solo cambia el administrador.
SOLO_ADMIN = {"control_caja", "color_mode", "color_primario"}


@router.put("/settings/", response_model=SettingsOut)
def update_settings(
    settings_in: SettingsUpdate,
    tenant_user: Annotated[TenantUser, Depends(get_current_tenant_user)],
    db: Session = Depends(get_tenant_db),
):
    """Actualiza la configuración global (solo los campos que llegan)."""
    cambios = settings_in.model_dump(exclude_unset=True)
    if SOLO_ADMIN & cambios.keys() and not es_admin(tenant_user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el administrador de la empresa puede cambiar este ajuste.")

    # Con turnos abiertos, apagar el control los dejaría sin forma de cerrarse.
    if cambios.get("control_caja") is False and db.query(CashSession).filter(CashSession.status == "OPEN").first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cierra los turnos de caja abiertos antes de desactivar el control de caja.",
        )

    settings = db.query(SystemSettings).first()
    if not settings:
        settings = SystemSettings(id=1)
        db.add(settings)

    for field, value in cambios.items():
        setattr(settings, field, value)
    
    db.commit()
    db.refresh(settings)
    return settings
