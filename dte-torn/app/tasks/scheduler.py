"""Scheduler: lo que hace que Redis sea desechable.

Cada `INTERVALO_SEGUNDOS` recorre los documentos con `next_action_at` vencido y
los encola según su estado. Si Redis se borra entero, en un intervalo todo lo
pendiente vuelve a las colas. Al encolar deja un **lease** (`next_action_at` =
ahora + `LEASE`): la tarea, al terminar, fija su propio `next_action_at`; si la
tarea se pierde, el lease vence y se vuelve a encolar.

También rescata los estados transitorios colgados (un worker que murió a mitad
de un paso) y cada `VIGILANCIA_SEGUNDOS` revisa stock de folios, CAF vencidos y
vigencia de certificados, que expone como métricas para alertar.

Correr uno solo: `python -m app.tasks.scheduler`. Dos a la vez no rompen nada
(`FOR UPDATE SKIP LOCKED` + lease), solo duplican trabajo.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

import sentry_sdk
from prometheus_client import Counter, Gauge, start_http_server
from sqlalchemy import case, func, or_, select, update

from app.core.config import get_settings
from app.db import control_session, tenant_session
from app.dte.signer import ZONA_CHILE
from app.models import CAF, Ambiente, Certificate, Document, EstadoCAF, EstadoDocumento, Tenant
from app.tasks import colas

E = EstadoDocumento
log = logging.getLogger(__name__)

INTERVALO_SEGUNDOS = 15
VIGILANCIA_SEGUNDOS = 600
LEASE = timedelta(minutes=5)
#: Un FIRMANDO o ENVIANDO sin moverse por más de esto quedó huérfano.
COLGADO = timedelta(minutes=10)
DIAS_AVISO_CERTIFICADO = 30
#: Estados con un paso siguiente automático. ERROR espera a una persona.
CON_PASO_SIGUIENTE = (E.PENDIENTE, E.FIRMADO, E.VERIFICAR, E.ENVIADO)

FOLIOS = Gauge("dte_folios_disponibles", "Folios sin usar en CAF activos", ["rut", "tipo_dte"])
DIAS_CERTIFICADO = Gauge("dte_certificado_dias_restantes", "Días de vigencia del certificado activo", ["rut"])
EN_ERROR = Gauge("dte_documentos_en_error", "Documentos en ERROR esperando revisión", ["rut"])
ENCOLADOS = Counter("dte_reconciliacion_encolados_total", "Documentos encolados por la reconciliación", ["estado"])


async def _tenants() -> list[tuple[uuid.UUID, str]]:
    # ponytail: una consulta por tenant y ciclo; con cientos de tenants, una
    # función SECURITY DEFINER que lea los pendientes de todos de una vez.
    async with control_session() as s:
        return list((await s.execute(select(Tenant.id, Tenant.rut_emisor).where(Tenant.activo.is_(True)))).all())


async def reconciliar(limite: int = 500) -> int:
    """Encola lo que tiene un paso vencido y rescata lo colgado. Devuelve cuántos encoló."""
    total = 0
    for tenant_id, _ in await _tenants():
        ahora = datetime.now(timezone.utc)
        async with tenant_session(tenant_id) as s:
            # Firmar no tiene efectos fuera: se vuelve a firmar.
            await s.execute(
                update(Document)
                .where(Document.estado == E.FIRMANDO, Document.updated_at < ahora - COLGADO)
                .values(estado=E.PENDIENTE, next_action_at=ahora,
                        last_error="El worker se detuvo firmando: se vuelve a firmar")
            )
            # Subir sí: el SII pudo recibir el sobre. Nunca de vuelta a FIRMADO.
            await s.execute(
                update(Document)
                .where(Document.estado == E.ENVIANDO, Document.updated_at < ahora - COLGADO)
                .values(estado=E.VERIFICAR, intentos=0, next_action_at=ahora,
                        last_error="El worker se detuvo durante la subida: se verifica con el SII antes de reenviar")
            )
            vencidos = (
                select(Document.id)
                .where(
                    Document.estado.in_(CON_PASO_SIGUIENTE),
                    or_(Document.next_action_at.is_(None), Document.next_action_at <= ahora),
                )
                .order_by(Document.next_action_at.asc().nulls_first())
                .limit(limite)
                .with_for_update(skip_locked=True)
            )
            filas = (
                await s.execute(
                    update(Document)
                    .where(Document.id.in_(vencidos))
                    .values(next_action_at=ahora + LEASE)
                    .returning(Document.id, Document.estado)
                )
            ).all()
        for doc_id, estado_doc in filas:
            try:
                await colas.encolar(estado_doc, tenant_id, doc_id)
            except Exception:  # noqa: BLE001 - el lease lo reintenta
                log.exception("No se pudo encolar %s; se reintenta al vencer el lease", doc_id)
                continue
            ENCOLADOS.labels(estado_doc).inc()
            total += 1
    return total


async def vigilar() -> dict[str, dict]:
    """Stock de folios, CAF vencidos, vigencia del certificado y documentos en error."""
    s = get_settings()
    hoy = datetime.now(ZONA_CHILE).date()
    resumen: dict[str, dict] = {}
    for tenant_id, rut in await _tenants():
        async with tenant_session(tenant_id) as sesion:
            await sesion.execute(
                update(CAF)
                .where(CAF.estado == EstadoCAF.ACTIVO, CAF.fecha_vencimiento < hoy)
                .values(estado=EstadoCAF.VENCIDO)
            )
            stock = dict(
                (
                    await sesion.execute(
                        select(
                            CAF.tipo_dte,
                            func.sum(case((CAF.estado == EstadoCAF.ACTIVO, CAF.folio_hasta - CAF.ultimo_folio_usado), else_=0)),
                        )
                        # Los CAF de prueba de Desarrollador se regeneran solos.
                        .where(CAF.ambiente != Ambiente.DEV)
                        .group_by(CAF.tipo_dte)
                    )
                ).all()
            )
            vence = (
                await sesion.execute(select(Certificate.not_after).where(Certificate.activo.is_(True)))
            ).scalar_one_or_none()
            en_error = (
                await sesion.execute(select(func.count()).select_from(Document).where(Document.estado == E.ERROR))
            ).scalar_one()

        for tipo, disponibles in stock.items():
            FOLIOS.labels(rut, str(tipo)).set(disponibles)
            if disponibles < s.folio_umbral_alerta:
                log.warning("Emisor %s: quedan %s folios del tipo %s", rut, disponibles, tipo)
        dias = (vence - datetime.now(timezone.utc)).days if vence else None
        if dias is not None:
            DIAS_CERTIFICADO.labels(rut).set(dias)
            if dias < DIAS_AVISO_CERTIFICADO:
                log.warning("Emisor %s: el certificado vence en %s días", rut, dias)
        EN_ERROR.labels(rut).set(en_error)
        resumen[rut] = {"folios": {int(t): int(n) for t, n in stock.items()}, "dias_certificado": dias, "en_error": en_error}
    return resumen


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = get_settings()
    if s.sentry_dsn:
        sentry_sdk.init(dsn=s.sentry_dsn, environment=s.env)
    if s.metricas_puerto:
        start_http_server(s.metricas_puerto)
    for broker in colas.BROKERS:
        await broker.startup()

    ultima_vigilancia = 0.0
    while True:
        try:
            if n := await reconciliar():
                log.info("Reconciliación: %s documentos encolados", n)
        except Exception:  # noqa: BLE001 - el scheduler no se cae por un ciclo
            log.exception("Falló la reconciliación")
        if time.monotonic() - ultima_vigilancia >= VIGILANCIA_SEGUNDOS:
            try:
                await vigilar()
            except Exception:  # noqa: BLE001
                log.exception("Falló la vigilancia")
            ultima_vigilancia = time.monotonic()
        await asyncio.sleep(INTERVALO_SEGUNDOS)


if __name__ == "__main__":
    asyncio.run(main())
