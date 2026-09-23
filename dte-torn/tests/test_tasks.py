"""Capa de colas: tareas, circuit breaker, semáforo y reconciliación.

Las tareas se llaman directo (Taskiq permite invocar la función decorada), con
el SII simulado. Lo que se prueba es la decisión de cuándo correr cada paso;
los pasos en sí ya están en `test_pipeline.py`.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, update

from app.db import tenant_session
from app.dte import pipeline
from app.dte.sii_client import Canal
from app.models import CAF, DeadLetter, Document, EstadoDocumento
from app.tasks import colas, scheduler
from tests.test_pipeline import RUT_EMPRESA, _doc, _documento, emisor  # noqa: F401 - fixture
from tests.test_sii_client import SiiFalso

E = EstadoDocumento


@pytest.fixture
def sii(redis_limpio, almacen, monkeypatch):
    """SII simulado en el contexto de los workers, y las colas capturadas."""
    falso = SiiFalso()
    monkeypatch.setattr(colas, "_ctx", pipeline.Contexto(
        http=httpx.AsyncClient(transport=httpx.MockTransport(falso)), redis=redis_limpio, almacen=almacen,
    ))
    falso.encolados = []

    async def encolar(estado, tenant_id, doc_id) -> None:
        falso.encolados.append((estado, doc_id))

    monkeypatch.setattr(colas, "encolar", encolar)
    return falso


async def _poner(tenant_id, doc_id, **valores) -> None:
    async with tenant_session(tenant_id) as s:
        await s.execute(update(Document).where(Document.id == doc_id).values(**valores))


# ------------------------------------------------------------------ tareas ---


async def test_del_folio_al_aceptado(emisor, sii) -> None:
    doc = await _documento(emisor)
    assert await colas.firmar(str(emisor), str(doc)) == E.FIRMADO
    assert sii.encolados == [(E.FIRMADO, doc)]  # el envío va de inmediato
    assert await colas.enviar(str(emisor), str(doc)) == E.ENVIADO
    assert await colas.consultar(str(emisor), str(doc)) == E.ACEPTADO


async def test_breaker_abierto_pospone_sin_llamar_al_sii(emisor, sii, redis_limpio) -> None:
    doc = await _documento(emisor)
    await colas.firmar(str(emisor), str(doc))
    for _ in range(colas.BREAKER_UMBRAL):
        await colas.breaker_fallo(redis_limpio, "CERT", Canal.DTE)

    assert await colas.enviar(str(emisor), str(doc)) == E.FIRMADO
    assert "upload" not in sii.llamadas
    espera = (await _doc(emisor, doc)).next_action_at - datetime.now(timezone.utc)
    assert espera > timedelta(seconds=colas.BREAKER_ABIERTO_SEGUNDOS - 10)


async def test_un_exito_reinicia_la_cuenta(redis_limpio) -> None:
    for _ in range(colas.BREAKER_UMBRAL - 1):
        await colas.breaker_fallo(redis_limpio, "CERT", Canal.DTE)
    await colas.breaker_exito(redis_limpio, "CERT", Canal.DTE)
    await colas.breaker_fallo(redis_limpio, "CERT", Canal.DTE)
    assert await colas.breaker_abierto(redis_limpio, "CERT", Canal.DTE) == 0


async def test_una_subida_fallida_cuenta_para_el_breaker(emisor, sii, redis_limpio) -> None:
    doc = await _documento(emisor)
    await colas.firmar(str(emisor), str(doc))
    sii.uploads = [(503, b"Service Unavailable")]
    assert await colas.enviar(str(emisor), str(doc)) == E.FIRMADO
    assert await redis_limpio.get("dte:breaker:CERT:DTE:fallos") == b"1"


async def test_semaforo_por_rut(redis_limpio) -> None:
    cupos = [await colas.tomar_cupo(redis_limpio, RUT_EMPRESA) for _ in range(2)]
    assert all(cupos)
    assert await colas.tomar_cupo(redis_limpio, RUT_EMPRESA) is None
    assert await colas.tomar_cupo(redis_limpio, "77777777-7") is not None  # otro emisor, otro cupo
    await colas.soltar_cupo(redis_limpio, RUT_EMPRESA, cupos[0])
    assert await colas.tomar_cupo(redis_limpio, RUT_EMPRESA) is not None


async def test_sin_cupo_pospone(emisor, sii, redis_limpio) -> None:
    doc = await _documento(emisor)
    await colas.firmar(str(emisor), str(doc))
    for _ in range(2):
        await colas.tomar_cupo(redis_limpio, RUT_EMPRESA)
    assert await colas.enviar(str(emisor), str(doc)) == E.FIRMADO
    assert "upload" not in sii.llamadas


async def test_boleta_ambigua_va_a_revision(emisor, sii) -> None:
    """La verificación por folio de boletas no existe todavía: nunca reenviar a ciegas."""
    doc = await _documento(emisor)
    await _poner(emisor, doc, tipo_dte=39, estado=E.VERIFICAR)
    assert await colas.enviar(str(emisor), str(doc)) == E.ERROR
    async with tenant_session(emisor) as s:
        assert (await s.execute(select(DeadLetter.cola))).scalar_one() == "verificacion"


# ---------------------------------------------------------- reconciliación --


async def test_reconciliar_encola_segun_estado_y_deja_lease(emisor, sii) -> None:
    ahora = datetime.now(timezone.utc)
    docs = {estado: await _documento(emisor, f"venta-{estado}") for estado in
            (E.PENDIENTE, E.FIRMADO, E.VERIFICAR, E.ENVIADO, E.ACEPTADO, E.ERROR)}
    for estado, doc in docs.items():
        await _poner(emisor, doc, estado=estado, next_action_at=ahora - timedelta(seconds=1))
    futuro = await _documento(emisor, "venta-futura")
    await _poner(emisor, futuro, estado=E.ENVIADO, next_action_at=ahora + timedelta(minutes=1))

    assert await scheduler.reconciliar() == 4
    assert sorted(sii.encolados) == sorted((e, docs[e]) for e in (E.PENDIENTE, E.FIRMADO, E.VERIFICAR, E.ENVIADO))
    # Con el lease puesto, el ciclo siguiente no los vuelve a encolar.
    assert await scheduler.reconciliar() == 0


async def test_rescata_pasos_colgados(emisor, sii) -> None:
    viejo = datetime.now(timezone.utc) - scheduler.COLGADO - timedelta(minutes=1)
    firmando = await _documento(emisor, "firmando")
    enviando = await _documento(emisor, "enviando")
    reciente = await _documento(emisor, "reciente")
    await _poner(emisor, firmando, estado=E.FIRMANDO, updated_at=viejo)
    await _poner(emisor, enviando, estado=E.ENVIANDO, updated_at=viejo)
    await _poner(emisor, reciente, estado=E.ENVIANDO, updated_at=datetime.now(timezone.utc))

    await scheduler.reconciliar()
    assert (await _doc(emisor, firmando)).estado == E.PENDIENTE
    # La subida pudo llegar al SII: se verifica, no se reenvía.
    assert (await _doc(emisor, enviando)).estado == E.VERIFICAR
    assert (await _doc(emisor, reciente)).estado == E.ENVIANDO


async def test_vigilar_folios_certificado_y_caf_vencidos(emisor, sii) -> None:
    resumen = (await scheduler.vigilar())[RUT_EMPRESA]
    assert resumen["folios"] == {33: 101}
    assert resumen["dias_certificado"] > 300
    assert resumen["en_error"] == 0

    async with tenant_session(emisor) as s:
        await s.execute(update(CAF).values(fecha_vencimiento=date(2020, 1, 1)))
    assert (await scheduler.vigilar())[RUT_EMPRESA]["folios"] == {33: 0}
    async with tenant_session(emisor) as s:
        assert (await s.execute(select(CAF.estado))).scalar_one() == "VENCIDO"


async def test_sin_redis_el_lease_lo_reintenta(emisor, monkeypatch) -> None:
    """Si encolar falla, el documento no se pierde: vuelve al vencer el lease."""
    doc = await _documento(emisor)

    async def caido(*_):
        raise ConnectionError("Redis caído")

    monkeypatch.setattr(colas, "encolar", caido)
    assert await scheduler.reconciliar() == 0
    lease = (await _doc(emisor, doc)).next_action_at - datetime.now(timezone.utc)
    assert timedelta(minutes=4) < lease <= scheduler.LEASE


def test_las_tareas_van_a_su_cola() -> None:
    assert colas.firmar.broker is colas.firma
    assert colas.enviar.broker is colas.envio
    assert colas.consultar.broker is colas.estado
    assert {b.queue_name for b in colas.BROKERS} == {"dte:firma", "dte:envio", "dte:estado"}
