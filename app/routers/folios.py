import asyncio
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models.dte import CAF, FolioRequestLog
from app.models.user import User
from app.dependencies.tenant import get_tenant_db, get_current_local_user, require_admin
from pydantic import BaseModel, Field
from datetime import datetime, date

# --- Schemas Mínimos para Folios ---
class FolioStockOut(BaseModel):
    dte_type: int
    available: int
    total: int
    latest_folio_hasta: int
    latest_folio_desde: int
    fecha_vencimiento: Optional[date] = None
    
class FolioRequestIn(BaseModel):
    dte_type: int
    amount_requested: int = Field(gt=0, description="Cantidad a solicitar")
    
class FolioRequestLogOut(BaseModel):
    id: int
    dte_type: int
    amount_requested: int
    status: str
    timestamp: datetime
    
    class Config:
        from_attributes = True

router = APIRouter(prefix="/folios", tags=["folios"])

@router.get("/status", response_model=List[FolioStockOut], summary="Estado del Stock de Folios")
def get_folios_status(
    db: Session = Depends(get_tenant_db),
    current_user: User = Depends(get_current_local_user)
):
    """
    Obtiene el estado actual (stock) de los folios por cada tipo de DTE.
    Retorna tarjetas de 33, 39, 61, 56.
    """
    # DTEs objetivos: Nacionales, Ajustes/Logística y Exportación
    target_dtes = [33, 34, 39, 41, 52, 56, 61, 110, 111, 112]
    
    result = []
    
    for dte_type in target_dtes:
        caf = db.query(CAF).filter(CAF.tipo_documento == dte_type).first()
        if not caf:
            result.append(
                FolioStockOut(
                    dte_type=dte_type, available=0, total=0,
                    latest_folio_hasta=0, latest_folio_desde=0,
                    fecha_vencimiento=None
                )
            )
        else:
            total = caf.folio_hasta - caf.folio_desde + 1
            available = caf.folio_hasta - caf.ultimo_folio_usado
            if available < 0: available = 0
            
            result.append(
                FolioStockOut(
                    dte_type=dte_type,
                    available=available,
                    total=total,
                    latest_folio_hasta=caf.folio_hasta,
                    latest_folio_desde=caf.folio_desde,
                    fecha_vencimiento=caf.fecha_vencimiento
                )
            )
            
    return result

@router.post("/request", response_model=FolioRequestLogOut, summary="Solicitar Folios al SII")
def request_folios(
    req: FolioRequestIn,
    db: Session = Depends(get_tenant_db),
    admin_user = Depends(require_admin)
):
    """
    Simula una petición manual de folios al SII.
    """
    new_log = FolioRequestLog(
        dte_type=req.dte_type,
        amount_requested=req.amount_requested,
        status="PENDING"
    )
    db.add(new_log)
    db.commit()
    db.refresh(new_log)
    
    # Simulación de respuesta asíncrona (esto sería con Celery luego)
    # Por ahora sólo se deja pending y la UI asume el delay
    
    # Solo a fines de la prueba inicial, lo marcamos COMPLETED
    # new_log.status = "COMPLETED"
    # db.commit()
    
    return new_log

@router.get("/requests/history", response_model=List[FolioRequestLogOut], summary="Historial de Solicitudes")
def get_requests_history(
    limit: int = 50,
    db: Session = Depends(get_tenant_db),
    admin_user = Depends(require_admin)
):
    """
    Devuelve el historial de peticiones de folios.
    """
    logs = db.query(FolioRequestLog).order_by(desc(FolioRequestLog.timestamp)).limit(limit).all()
    return logs
