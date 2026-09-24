"""Folios, CAF y certificado digital: proxy autenticado hacia dte-torn.

dte-torn es el único dueño de los CAF y del correlativo de folios (ver
`dte-torn/DESIGN.md` §9); este router solo agrega la autenticación y el tenant
del backend.
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.dependencies.tenant import get_current_global_user, get_current_tenant_user, require_admin
from app.models.saas import SaaSUser, TenantUser
from app.services import dte_client

router = APIRouter(prefix="/folios", tags=["folios"])

#: Tipos que emite dte-torn, en el orden en que se muestran.
TIPOS_DTE = [33, 34, 39, 41, 56, 61]


class FolioStockOut(BaseModel):
    dte_type: int
    available: int
    total: int
    latest_folio_hasta: int
    latest_folio_desde: int
    fecha_vencimiento: Optional[date] = None


def _llamar(method: str, path: str, tenant, actor: str | None = None, **kwargs):
    try:
        return dte_client.request(method, path, tenant, actor, **kwargs)
    except dte_client.DteError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/status", response_model=List[FolioStockOut], summary="Estado del Stock de Folios")
def get_folios_status(tenant_user: TenantUser = Depends(get_current_tenant_user)):
    """Folios disponibles por tipo de documento, uno por cada tipo que se puede emitir."""
    stock = {s["tipo_dte"]: s for s in _llamar("GET", "/folios", tenant_user.tenant).json()}
    result = []
    for tipo in TIPOS_DTE:
        cafs = [c for c in stock.get(tipo, {}).get("cafs", []) if c["estado"] == "ACTIVO"]
        ultimo = cafs[-1] if cafs else None
        # Vence primero el que se consume a continuación: el más antiguo con folios libres.
        en_uso = next((c for c in cafs if c["disponibles"] > 0), ultimo)
        result.append(FolioStockOut(
            dte_type=tipo,
            available=sum(c["disponibles"] for c in cafs),
            total=sum(c["folio_hasta"] - c["folio_desde"] + 1 for c in cafs),
            latest_folio_desde=ultimo["folio_desde"] if ultimo else 0,
            latest_folio_hasta=ultimo["folio_hasta"] if ultimo else 0,
            fecha_vencimiento=en_uso["fecha_vencimiento"] if en_uso else None,
        ))
    return result


@router.post("/upload", status_code=201, summary="Cargar CAF")
async def upload_caf(
    file: UploadFile = File(...),
    admin: TenantUser = Depends(require_admin),
    global_user: SaaSUser = Depends(get_current_global_user),
):
    """Carga el XML de un CAF tal como lo entrega el SII. dte-torn valida firma,
    RUT, vencimiento y que el rango no se solape con otro."""
    contenido = await file.read()
    return _llamar(
        "POST", "/cafs", admin.tenant, global_user.email,
        files={"archivo": (file.filename or "caf.xml", contenido, "application/xml")},
    ).json()


@router.get("/certificate", summary="Certificado digital vigente")
def get_certificate(tenant_user: TenantUser = Depends(get_current_tenant_user)):
    """Titular y vigencia del certificado, sin material sensible. `null` si no hay."""
    try:
        return dte_client.request("GET", "/certificates/actual", tenant_user.tenant).json()
    except dte_client.DteError as exc:
        if exc.status_code == 404:
            return None
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/certificate", status_code=201, summary="Cargar certificado digital")
async def upload_certificate(
    file: UploadFile = File(...),
    password: str = Form(...),
    admin: TenantUser = Depends(require_admin),
    global_user: SaaSUser = Depends(get_current_global_user),
):
    """Sube el .pfx; dte-torn lo guarda cifrado y lo deja como el activo."""
    contenido = await file.read()
    return _llamar(
        "POST", "/certificates", admin.tenant, global_user.email,
        files={"archivo": (file.filename or "certificado.pfx", contenido, "application/x-pkcs12")},
        data={"password": password},
    ).json()
