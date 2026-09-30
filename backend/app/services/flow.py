"""Cliente de Flow (flow.cl), la pasarela con que pagan las empresas su suscripción.

Documentación: https://developers.flow.cl/api
- Cada llamada va firmada: parámetros ordenados por nombre, concatenados como
  `nombrevalor` y firmados con HMAC-SHA256 usando la secretKey (parámetro `s`).
- `payment/create` devuelve `url` y `token`; el pagador va a `url?token=token`.
- Flow avisa por POST a `urlConfirmation` con el `token` y el comercio consulta
  `payment/getStatus`. Nunca se confía en lo que llega al webhook: el estado se
  pregunta a Flow.
- `status`: 1 pendiente, 2 pagada, 3 rechazada, 4 anulada.

Las cuotas sin interés se activan en el panel de Flow, no por la API.

Configuración:
    TORN_FLOW_API_KEY, TORN_FLOW_SECRET_KEY  credenciales del comercio.
    TORN_FLOW_URL      https://sandbox.flow.cl/api (por defecto) o https://www.flow.cl/api.
    TORN_PUBLIC_API_URL  URL pública del backend, a la que Flow avisa.
    TORN_PUBLIC_APP_URL  URL pública del frontend, a la que vuelve el cliente.
"""

import hashlib
import hmac
import os

import httpx

PENDIENTE, PAGADA, RECHAZADA, ANULADA = 1, 2, 3, 4

_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class FlowError(Exception):
    pass


def configurada() -> bool:
    return bool(os.getenv("TORN_FLOW_API_KEY") and os.getenv("TORN_FLOW_SECRET_KEY") and os.getenv("TORN_PUBLIC_API_URL"))


def firmar(params: dict, secreto: str) -> str:
    cadena = "".join(f"{k}{params[k]}" for k in sorted(params))
    return hmac.new(secreto.encode(), cadena.encode(), hashlib.sha256).hexdigest()


def _llamar(metodo: str, ruta: str, params: dict) -> dict:
    if not configurada():
        raise FlowError("La pasarela de pago no está configurada.")
    params = {**params, "apiKey": os.environ["TORN_FLOW_API_KEY"]}
    params["s"] = firmar(params, os.environ["TORN_FLOW_SECRET_KEY"])
    url = os.getenv("TORN_FLOW_URL", "https://sandbox.flow.cl/api").rstrip("/") + ruta
    try:
        if metodo == "GET":
            resp = httpx.get(url, params=params, timeout=_TIMEOUT)
        else:
            resp = httpx.post(url, data=params, timeout=_TIMEOUT)
    except httpx.HTTPError as exc:
        raise FlowError(f"Flow no respondió: {exc}") from exc
    if resp.status_code >= 400:
        try:
            detalle = resp.json().get("message", resp.text)
        except ValueError:
            detalle = resp.text
        raise FlowError(f"Flow rechazó el pedido: {detalle}")
    return resp.json()


def crear_orden(orden: str, monto: int, asunto: str, email: str) -> tuple[str, str]:
    """Crea la orden y devuelve (url a la que va el cliente, token)."""
    api = os.environ["TORN_PUBLIC_API_URL"].rstrip("/")
    r = _llamar("POST", "/payment/create", {
        "commerceOrder": orden,
        "subject": asunto,
        "currency": "CLP",
        "amount": monto,
        "email": email,
        "urlConfirmation": f"{api}/pagos/flow/confirmacion",
        "urlReturn": f"{api}/pagos/flow/retorno",
    })
    return f"{r['url']}?token={r['token']}", r["token"]


def estado_orden(token: str) -> dict:
    """`{commerceOrder, status, amount, ...}` tal como lo devuelve Flow."""
    return _llamar("GET", "/payment/getStatus", {"token": token})
