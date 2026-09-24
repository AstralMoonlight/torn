"""Cliente del microservicio `dte-torn`, dueño de folios, CAF, firma y envío al SII.

El backend no guarda nada tributario salvo `Sale.tipo_dte`/`Sale.folio` como
caché de impresión (ver `dte-torn/DESIGN.md` §9). Todo lo demás se pide acá.

Configuración:
    TORN_DTE_URL      URL base de dte-torn (p.ej. http://localhost:8001).
    TORN_DTE_API_KEY  Debe coincidir con `DTE_INTERNAL_API_KEY` de dte-torn.
"""

import os
import uuid

import httpx

#: dte-torn identifica a las empresas por UUID; el backend, por entero. El UUID
#: se deriva del id para no tener que guardar un mapeo.
_NAMESPACE = uuid.UUID("5b0f1c52-2c0e-4a4f-9a36-1d5f2f0c7e11")

#: La emisión firma en línea: con el SII no hay espera (eso va en cola), pero
#: firmar y asignar folio puede tardar un par de segundos bajo carga.
_TIMEOUT = httpx.Timeout(15.0, connect=3.0)


class DteError(Exception):
    """dte-torn rechazó el pedido. `status_code` y `detail` vienen de su respuesta."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class DteNoDisponible(DteError):
    """dte-torn no está configurado o no respondió."""

    def __init__(self, detail: str):
        super().__init__(503, detail)


def tenant_uuid(tenant_id: int) -> uuid.UUID:
    return uuid.uuid5(_NAMESPACE, f"torn-tenant-{tenant_id}")


def request(method: str, path: str, tenant_id: int | None = None, actor: str | None = None, **kwargs) -> httpx.Response:
    """Llama a dte-torn. Errores de red y respuestas 4xx/5xx salen como `DteError`."""
    base = os.getenv("TORN_DTE_URL")
    if not base:
        raise DteNoDisponible("El servicio de facturación electrónica no está configurado (TORN_DTE_URL).")
    headers = {"X-Internal-Api-Key": os.getenv("TORN_DTE_API_KEY", "")}
    if tenant_id is not None:
        headers["X-Tenant-Id"] = str(tenant_uuid(tenant_id))
    if actor:
        headers["X-Actor"] = actor[:150]
    try:
        resp = httpx.request(method, base.rstrip("/") + path, headers=headers, timeout=_TIMEOUT, **kwargs)
    except httpx.HTTPError as exc:
        raise DteNoDisponible(f"El servicio de facturación electrónica no respondió: {exc}") from exc
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail", resp.text)
        except ValueError:
            detail = resp.text
        raise DteError(resp.status_code, detail if isinstance(detail, str) else str(detail))
    return resp


def emitir(tenant_id: int, documento: dict, actor: str | None = None) -> dict:
    """Emite factura, boleta o nota. Idempotente por `documento["external_id"]`."""
    ruta = "/boletas" if documento["tipo_dte"] in (39, 41) else "/documents"
    return request("POST", ruta, tenant_id, actor, json=documento).json()


def sincronizar_emisor(tenant, issuer) -> None:
    """Copia el emisor a dte-torn (`PUT /tenants/{id}`, upsert idempotente).

    Se llama cada vez que cambia el `Issuer` del tenant o sus datos del SII.
    Sin `TORN_DTE_URL` no hace nada: la emisión fallará igual con un mensaje
    claro, y así un entorno sin dte-torn puede seguir configurando empresas.
    """
    if not os.getenv("TORN_DTE_URL") or issuer is None:
        return
    request("PUT", f"/tenants/{tenant_uuid(tenant.id)}", json={
        "rut_emisor": issuer.rut,
        "razon_social": issuer.razon_social,
        "giro": issuer.giro,
        "acteco": issuer.acteco,
        "direccion": issuer.direccion,
        "comuna": issuer.comuna,
        "ciudad": issuer.ciudad,
        "telefono": issuer.telefono,
        "email": issuer.email,
        "ambiente": tenant.sii_ambiente,
        "resolucion_numero": tenant.sii_resolucion_numero,
        "resolucion_fecha": tenant.sii_resolucion_fecha.isoformat() if tenant.sii_resolucion_fecha else None,
        "oficina_sii": tenant.sii_oficina,
        "activo": tenant.is_active,
    })
