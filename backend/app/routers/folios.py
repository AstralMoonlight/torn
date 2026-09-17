import asyncio
from typing import List, Optional
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models.dte import CAF, FolioRequestLog
from app.models.issuer import Issuer
from app.models.user import User
from app.dependencies.tenant import get_tenant_db, get_current_local_user, require_admin
from app.utils.caf_parser import CAFParseError, parse_caf_xml
from app.utils.folios import folios_disponibles, folios_totales
from app.utils.validators import validar_rut
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

class CAFOut(BaseModel):
    id: int
    tipo_documento: int
    folio_desde: int
    folio_hasta: int
    fecha_vencimiento: Optional[date] = None
    created_at: datetime

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
        # Un inquilino acumula varios CAF del mismo tipo a medida que el SII le
        # autoriza folios. El stock es la suma de todos, no el del primero.
        cafs = (
            db.query(CAF)
            .filter(CAF.tipo_documento == dte_type)
            .order_by(CAF.folio_desde.asc())
            .all()
        )

        if not cafs:
            result.append(
                FolioStockOut(
                    dte_type=dte_type, available=0, total=0,
                    latest_folio_hasta=0, latest_folio_desde=0,
                    fecha_vencimiento=None
                )
            )
            continue

        # El rango informado es el del CAF más nuevo, y la fecha de vencimiento
        # la del que se consumirá a continuación (el criterio que usa la venta:
        # el más antiguo con folios libres), que es la que de verdad urge.
        ultimo = cafs[-1]
        en_uso = next((c for c in cafs if folios_disponibles(c) > 0), None)

        result.append(
            FolioStockOut(
                dte_type=dte_type,
                available=sum(folios_disponibles(c) for c in cafs),
                total=sum(folios_totales(c) for c in cafs),
                latest_folio_hasta=ultimo.folio_hasta,
                latest_folio_desde=ultimo.folio_desde,
                fecha_vencimiento=(en_uso or ultimo).fecha_vencimiento,
            )
        )

    return result

@router.post("/upload", response_model=CAFOut, status_code=status.HTTP_201_CREATED, summary="Cargar CAF")
async def upload_caf(
    file: UploadFile = File(...),
    db: Session = Depends(get_tenant_db),
    admin_user = Depends(require_admin),
):
    """Carga un archivo CAF real entregado por el SII.

    Reemplaza la carga manual por script (`scripts/setup_caf.py`,
    `scripts/inject_folios.py`): parsea `folio_desde`/`folio_hasta` y la
    fecha de vencimiento desde el propio XML en vez de pedirlos por
    formulario, y valida que el CAF sea utilizable antes de guardarlo.
    """
    raw = await file.read()
    try:
        xml_content = raw.decode("utf-8")
    except UnicodeDecodeError:
        xml_content = raw.decode("latin-1")

    try:
        parsed = parse_caf_xml(xml_content)
    except CAFParseError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    issuer = db.query(Issuer).first()
    if not issuer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emisor no configurado. Use PUT /issuer/ primero.",
        )

    try:
        rut_caf = validar_rut(parsed.rut_emisor)
        rut_issuer = validar_rut(issuer.rut)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"RUT inválido: {e}")

    if rut_caf != rut_issuer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El CAF pertenece al RUT {rut_caf}, pero el Emisor configurado es {rut_issuer}.",
        )

    if parsed.fecha_vencimiento < date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El CAF venció el {parsed.fecha_vencimiento.isoformat()}. Solicita uno nuevo al SII.",
        )

    # Los rangos del mismo tipo de documento no pueden solaparse: dos CAF
    # cubriendo el mismo folio harían que `siguiente_folio` (app/utils/folios.py)
    # pudiera repetir un folio ya emitido.
    overlapping = (
        db.query(CAF)
        .filter(
            CAF.tipo_documento == parsed.tipo_documento,
            CAF.folio_desde <= parsed.folio_hasta,
            CAF.folio_hasta >= parsed.folio_desde,
        )
        .first()
    )
    if overlapping:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"El rango {parsed.folio_desde}-{parsed.folio_hasta} se solapa con un CAF "
                f"ya cargado ({overlapping.folio_desde}-{overlapping.folio_hasta})."
            ),
        )

    caf = CAF(
        tipo_documento=parsed.tipo_documento,
        folio_desde=parsed.folio_desde,
        folio_hasta=parsed.folio_hasta,
        ultimo_folio_usado=0,
        fecha_vencimiento=parsed.fecha_vencimiento,
        xml_caf=xml_content,
    )
    db.add(caf)
    db.commit()
    db.refresh(caf)
    return caf


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
