"""La suscripción vista desde la empresa, y los avisos de Flow.

`/suscripcion/*` sigue abierto con la empresa suspendida: no usa `get_tenant_db`,
que es donde está el bloqueo de solo lectura, y es por donde paga para reactivarse.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.dependencies.tenant import get_current_global_user, get_current_tenant_user, get_global_db, require_admin
from app.models.saas import SaaSPlan, SaaSUser, TenantUser
from app.schemas_saas import LinkPagoOut, PlanOut
from app.services import flow
from app.services import suscripciones as sus

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Suscripción"])


class SuscripcionOut(BaseModel):
    estado: str
    plan: str | None
    vence: str | None
    prorroga_hasta: datetime | None
    planes: list[PlanOut]
    pasarela: bool


class PagarIn(BaseModel):
    plan_id: int


@router.get("/suscripcion", response_model=SuscripcionOut)
def mi_suscripcion(
    tenant_user: Annotated[TenantUser, Depends(get_current_tenant_user)],
    db: Session = Depends(get_global_db),
):
    tenant = tenant_user.tenant
    return SuscripcionOut(
        estado=sus.estado(tenant, sus.ajustes(db), datetime.now(timezone.utc)),
        plan=tenant.plan.name if tenant.plan else None,
        vence=tenant.suscripcion_vence.isoformat() if tenant.suscripcion_vence else None,
        prorroga_hasta=tenant.prorroga_hasta,
        planes=db.query(SaaSPlan).filter(SaaSPlan.is_active == True, SaaSPlan.meses > 0).order_by(SaaSPlan.meses).all(),  # noqa: E712
        pasarela=flow.configurada(),
    )


@router.post("/suscripcion/pagar", response_model=LinkPagoOut)
def pagar(
    datos: PagarIn,
    tenant_user: Annotated[TenantUser, Depends(require_admin)],
    user: Annotated[SaaSUser, Depends(get_current_global_user)],
    db: Session = Depends(get_global_db),
):
    """El administrador de la empresa paga con Flow: devuelve la URL a la que ir."""
    plan = db.get(SaaSPlan, datos.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado.")
    try:
        return LinkPagoOut(url=sus.iniciar_pago_pasarela(db, tenant_user.tenant, plan, user.email, user.id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except flow.FlowError as e:
        raise HTTPException(status_code=502, detail=f"No se pudo iniciar el pago: {e}")


@router.post("/pagos/flow/confirmacion")
def flow_confirmacion(token: Annotated[str, Form()], db: Session = Depends(get_global_db)):
    """Webhook de Flow. No se confía en el cuerpo: se consulta el estado a Flow."""
    try:
        pago = sus.confirmar_pago_pasarela(db, token, datetime.now(timezone.utc))
    except flow.FlowError:
        logger.exception("Confirmación de Flow fallida (token %s)", token)
        raise HTTPException(status_code=502, detail="No se pudo confirmar con Flow")
    if pago is None:
        logger.warning("Flow avisó una orden desconocida (token %s)", token)
    return {"ok": True}


@router.api_route("/pagos/flow/retorno", methods=["GET", "POST"])
def flow_retorno(
    token: str | None = None,
    token_form: Annotated[str | None, Form(alias="token")] = None,
    db: Session = Depends(get_global_db),
):
    """Adonde Flow devuelve al cliente (por POST, con el token): confirma y lo lleva al sistema."""
    token = token or token_form
    estado = "desconocido"
    if token:
        try:
            pago = sus.confirmar_pago_pasarela(db, str(token), datetime.now(timezone.utc))
            estado = pago.estado.lower() if pago else estado
        except flow.FlowError:
            logger.exception("Retorno de Flow sin confirmar (token %s)", token)
    app_url = os.getenv("TORN_PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")
    return RedirectResponse(f"{app_url}/pago-resultado?estado={estado}", status_code=303)
