"""Colas Taskiq y sus tareas.

Tres colas, una por tipo de trabajo, cada una con su worker:

| cola         | tareas                  | qué la limita                          |
|--------------|-------------------------|----------------------------------------|
| `dte:firma`  | `firmar`                | CPU: pool de procesos                  |
| `dte:envio`  | `enviar` (y verificar)  | semáforo por RUT + circuit breaker     |
| `dte:estado` | `consultar`             | nada: solo lee del SII                 |

Las tareas no guardan estado propio: cada una llama a un paso del pipeline, que
reclama el documento en Postgres y es idempotente. Por eso encolar dos veces lo
mismo es inofensivo, y por eso Redis puede perderse: `scheduler.py` vuelve a
encolar todo lo pendiente leyendo `documents.next_action_at`.

Los reintentos tampoco viven acá: un paso que falla deja `next_action_at` en el
futuro y la reconciliación lo retoma cuando toca.

Worker: `taskiq worker app.tasks.colas:firma` (o `:envio`, `:estado`).
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Awaitable
from datetime import datetime, timedelta, timezone

import sentry_sdk
from prometheus_client import Counter, Histogram, start_http_server
from redis.asyncio import Redis
from sqlalchemy import select, update
from taskiq import TaskiqEvents, TaskiqState
from taskiq_redis import ListQueueBroker

from app.core.almacen import Almacen
from app.core.config import get_settings
from app.db import control_session, get_engine, tenant_session
from app.dte import pipeline
from app.dte.sii_client import Canal, crear_http
from app.models import Document, EstadoDocumento, Tenant

E = EstadoDocumento
log = logging.getLogger(__name__)

_s = get_settings()
# socket_timeout=None: el worker espera tareas con un BRPOP que bloquea sin
# límite, y redis-py 8 corta cualquier lectura a los 5 s por defecto. Con ese
# default el worker muere (taskiq-redis solo atrapa ConnectionError) y se
# reinicia cada 5 segundos.
firma = ListQueueBroker(_s.redis_url, queue_name="dte:firma", socket_timeout=None)
envio = ListQueueBroker(_s.redis_url, queue_name="dte:envio", socket_timeout=None)
estado = ListQueueBroker(_s.redis_url, queue_name="dte:estado", socket_timeout=None)
BROKERS = (firma, envio, estado)

#: Resultado = estado en que quedó el documento (o EXCEPCION): pocos valores.
TAREAS = Counter("dte_tareas_total", "Tareas ejecutadas, por estado resultante", ["tarea", "resultado"])
DURACION = Histogram("dte_tarea_segundos", "Duración de las tareas", ["tarea"])


async def _medir(tarea: str, paso: Awaitable[str]) -> str:
    inicio = time.monotonic()
    try:
        resultado = await paso
    except Exception:
        TAREAS.labels(tarea, "EXCEPCION").inc()
        raise
    TAREAS.labels(tarea, resultado).inc()
    DURACION.labels(tarea).observe(time.monotonic() - inicio)
    return resultado


# ---------------------------------------------------------------- contexto --

_ctx: pipeline.Contexto | None = None


def contexto() -> pipeline.Contexto:
    """Dependencias del proceso (cliente HTTP, Redis, S3): una por worker."""
    global _ctx
    if _ctx is None:
        s = get_settings()
        _ctx = pipeline.Contexto(
            http=crear_http(s.sii_timeout_segundos),
            redis=Redis.from_url(s.redis_url),
            almacen=Almacen(s),
            ttl_token=s.sii_token_ttl_segundos,
        )
    return _ctx


async def _arrancar_worker(_: TaskiqState) -> None:
    s = get_settings()
    if s.sentry_dsn:
        sentry_sdk.init(dsn=s.sentry_dsn, environment=s.env)
    if s.metricas_puerto:
        # Un proceso por worker (`--workers 1` en compose): un solo servidor.
        start_http_server(s.metricas_puerto)
    # El worker escucha un broker, pero encola en los otros (firma → envío).
    for broker in BROKERS:
        if not broker.is_worker_process:
            await broker.startup()


async def _detener_worker(_: TaskiqState) -> None:
    global _ctx
    if _ctx is not None:
        await _ctx.http.aclose()
        await _ctx.redis.aclose()
        if _ctx.ejecutor is not None:
            _ctx.ejecutor.shutdown()
        _ctx = None
    for broker in BROKERS:
        if not broker.is_worker_process:
            await broker.shutdown()
    await get_engine().dispose()


for _broker in BROKERS:
    _broker.on_event(TaskiqEvents.WORKER_STARTUP)(_arrancar_worker)
    _broker.on_event(TaskiqEvents.WORKER_SHUTDOWN)(_detener_worker)


@firma.on_event(TaskiqEvents.WORKER_STARTUP)
async def _pool_de_firma(_: TaskiqState) -> None:
    """Solo el worker de firma firma: solo él necesita el pool de procesos."""
    contexto().ejecutor = pipeline.crear_ejecutor_firma(get_settings().procesos_firma)


# ---------------------------------------------------------- circuit breaker --
#
# El SII es infraestructura compartida: si está caído, lo está para todos los
# emisores. El breaker es por (ambiente, canal), no por tenant, y cuenta en Redis
# para que lo compartan todos los workers. Abierto, las subidas se posponen en
# vez de seguir golpeando.

BREAKER_UMBRAL = 5
BREAKER_VENTANA_SEGUNDOS = 60
BREAKER_ABIERTO_SEGUNDOS = 120


def _clave_breaker(ambiente: str, canal: Canal) -> str:
    return f"dte:breaker:{ambiente}:{canal.value}"


async def breaker_abierto(redis: Redis, ambiente: str, canal: Canal) -> int:
    """Segundos que le quedan abierto al breaker; 0 si está cerrado."""
    return max(await redis.ttl(_clave_breaker(ambiente, canal) + ":abierto"), 0)


async def breaker_fallo(redis: Redis, ambiente: str, canal: Canal) -> None:
    """Cuenta un fallo; al llegar al umbral dentro de la ventana, abre."""
    clave = _clave_breaker(ambiente, canal)
    fallos = await redis.incr(clave + ":fallos")
    if fallos == 1:
        await redis.expire(clave + ":fallos", BREAKER_VENTANA_SEGUNDOS)
    if fallos >= BREAKER_UMBRAL:
        await redis.set(clave + ":abierto", "1", ex=BREAKER_ABIERTO_SEGUNDOS)
        await redis.delete(clave + ":fallos")
        log.warning("SII %s/%s no responde: se pausan las subidas %ss", ambiente, canal.value, BREAKER_ABIERTO_SEGUNDOS)


async def breaker_exito(redis: Redis, ambiente: str, canal: Canal) -> None:
    await redis.delete(_clave_breaker(ambiente, canal) + ":fallos")


# ------------------------------------------------------- semáforo por RUT ----
#
# Limita las subidas simultáneas de un mismo emisor (la sesión con el SII es por
# empresa). Cada cupo es una entrada de un sorted set con su vencimiento como
# puntaje: si un worker muere con el cupo tomado, vence solo.

CUPO_SEGUNDOS = 120
#: Espera antes de reintentar si el emisor no tiene cupo libre.
ESPERA_SIN_CUPO_SEGUNDOS = 10

_TOMAR_CUPO = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
  redis.call('EXPIRE', KEYS[1], ARGV[5])
  return 1
end
return 0
"""


async def tomar_cupo(redis: Redis, rut: str) -> str | None:
    """Toma un cupo de subida para el emisor. None si están todos ocupados."""
    token = uuid.uuid4().hex
    ahora = time.time()
    tomado = await redis.eval(
        _TOMAR_CUPO, 1, f"dte:cupos:{rut}",
        ahora, ahora + CUPO_SEGUNDOS, get_settings().sii_concurrencia_por_rut, token, CUPO_SEGUNDOS,
    )
    return token if tomado else None


async def soltar_cupo(redis: Redis, rut: str, token: str) -> None:
    await redis.zrem(f"dte:cupos:{rut}", token)


# ------------------------------------------------------------------ tareas ---


async def posponer(tenant_id: uuid.UUID, doc_id: uuid.UUID, segundos: float) -> None:
    """Deja el documento donde está y lo reprograma: la reconciliación lo retoma."""
    async with tenant_session(tenant_id) as s:
        await s.execute(
            update(Document)
            .where(Document.id == doc_id)
            .values(next_action_at=datetime.now(timezone.utc) + timedelta(seconds=segundos))
        )


@firma.task(task_name="dte.firmar")
async def firmar(tenant_id: str, doc_id: str) -> str:
    """PENDIENTE → FIRMADO, y encola el envío de inmediato."""
    tid, did = uuid.UUID(tenant_id), uuid.UUID(doc_id)
    resultado = await _medir("firmar", pipeline.firmar(contexto(), tid, did))
    if resultado == E.FIRMADO:
        await encolar(resultado, tid, did)
    return resultado


@envio.task(task_name="dte.enviar")
async def enviar(tenant_id: str, doc_id: str) -> str:
    """FIRMADO → ENVIADO, o VERIFICAR → FIRMADO | ENVIADO tras una subida ambigua."""
    return await _medir("enviar", _enviar(tenant_id, doc_id))


async def _enviar(tenant_id: str, doc_id: str) -> str:
    ctx = contexto()
    tid, did = uuid.UUID(tenant_id), uuid.UUID(doc_id)
    async with tenant_session(tid) as s:
        doc = (await s.execute(select(Document.estado, Document.tipo_dte).where(Document.id == did))).one()
    async with control_session() as s:
        tenant = (await s.execute(select(Tenant.rut_emisor, Tenant.ambiente).where(Tenant.id == tid))).one()
    if doc.estado not in (E.FIRMADO, E.VERIFICAR):
        return doc.estado

    canal = pipeline.canal_de(doc.tipo_dte)
    abierto = await breaker_abierto(ctx.redis, tenant.ambiente, canal)
    if abierto:
        await posponer(tid, did, abierto)
        return doc.estado
    cupo = await tomar_cupo(ctx.redis, tenant.rut_emisor)
    if cupo is None:
        await posponer(tid, did, ESPERA_SIN_CUPO_SEGUNDOS)
        return doc.estado

    try:
        if doc.estado == E.VERIFICAR:
            return await pipeline.verificar(ctx, tid, did)
        resultado = await pipeline.enviar(ctx, tid, did)
    finally:
        await soltar_cupo(ctx.redis, tenant.rut_emisor, cupo)

    if resultado == E.ENVIADO:
        await breaker_exito(ctx.redis, tenant.ambiente, canal)
    elif resultado in (E.FIRMADO, E.VERIFICAR):
        # Volvió atrás (el SII no respondió) o quedó ambiguo: cuenta como fallo.
        await breaker_fallo(ctx.redis, tenant.ambiente, canal)
    return resultado


@estado.task(task_name="dte.consultar")
async def consultar(tenant_id: str, doc_id: str) -> str:
    """ENVIADO → ACEPTADO | REPAROS | RECHAZADO, o reprograma la consulta."""
    return await _medir("consultar", pipeline.consultar(contexto(), uuid.UUID(tenant_id), uuid.UUID(doc_id)))


_TAREA_POR_ESTADO = {
    E.PENDIENTE: firmar,
    E.FIRMADO: enviar,
    E.VERIFICAR: enviar,
    E.ENVIADO: consultar,
}


async def encolar(estado_doc: str, tenant_id: uuid.UUID, doc_id: uuid.UUID) -> None:
    """Encola el paso que le toca a un documento según su estado."""
    tarea = _TAREA_POR_ESTADO.get(estado_doc)
    if tarea is not None:
        await tarea.kiq(str(tenant_id), str(doc_id))
