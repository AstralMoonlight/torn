"""Los pasos de vida de un documento: firmar, enviar, consultar.

Con Postgres, Redis y MinIO reales; el SII simulado con respuestas con el
formato real (ver `test_sii_client.py`). Es el mismo código que ejecutarán los
workers y que ejecuta el diagnóstico de certificación.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import select, update

from app.core.almacen import IntegridadError
from app.core.certificados import guardar_certificado
from app.db import control_session, tenant_session
from app.dte import pipeline
from app.dte.builder import DatosDocumento, Item, Receptor, calcular_totales
from app.dte.caf import guardar_caf
from app.dte.folios import DatosEmision, emitir_documento
from app.models import AuditLog, DeadLetter, Document, Envio, EstadoDocumento, Tenant
from tests.factories import CLAVE_PFX, caf_xml, pfx
from tests.test_sii_client import SiiFalso, _estado, _upload

E = EstadoDocumento
RUT_EMPRESA = "76543210-3"


@pytest.fixture
async def emisor(limpiar: None) -> uuid.UUID:
    """Empresa lista para emitir: datos, resolución, certificado y CAF."""
    tid = uuid.uuid4()
    async with control_session() as s:
        s.add(
            Tenant(
                id=tid,
                rut_emisor=RUT_EMPRESA,
                razon_social="Empresa de Prueba SpA",
                giro="Venta al por menor",
                acteco="471100",
                direccion="Av. Siempre Viva 742",
                comuna="Santiago",
                resolucion_fecha=date(2026, 9, 1),
                resolucion_numero=0,
            )
        )
    async with tenant_session(tid) as s:
        # Certificado de la representante: RUT distinto al de la empresa.
        await guardar_certificado(s, tid, pfx(rut="11111111-1"), CLAVE_PFX)
    async with tenant_session(tid) as s:
        await guardar_caf(s, tid, caf_xml(rut=RUT_EMPRESA, tipo_dte=33, desde=1000, hasta=1100))
    return tid


async def _documento(tenant_id: uuid.UUID, external_id: str = "venta-1") -> uuid.UUID:
    datos = DatosDocumento(
        tipo_dte=33,
        fecha_emision=date(2026, 9, 23),
        receptor=Receptor(
            rut="77777777-7", razon_social="Cliente Ltda", giro="Servicios",
            direccion="Calle 1", comuna="Santiago",
        ),
        items=[Item(nombre="Servicio", precio=Decimal("10000"))],
    )
    t = calcular_totales(datos.tipo_dte, datos.items)
    async with tenant_session(tenant_id) as s:
        doc, _ = await emitir_documento(
            s,
            tenant_id,
            DatosEmision(
                external_id=external_id,
                tipo_dte=datos.tipo_dte,
                fecha_emision=datos.fecha_emision,
                payload=datos.model_dump(mode="json"),
                monto_neto=t.neto, monto_iva=t.iva, monto_total=t.total,
            ),
        )
        return doc.id


def _ctx(sii, redis, almacen, ejecutor=None) -> pipeline.Contexto:
    http = httpx.AsyncClient(transport=httpx.MockTransport(sii))
    return pipeline.Contexto(http=http, redis=redis, almacen=almacen, ttl_token=600, ejecutor=ejecutor)


async def _doc(tenant_id: uuid.UUID, doc_id: uuid.UUID) -> Document:
    async with tenant_session(tenant_id) as s:
        return (await s.execute(select(Document).where(Document.id == doc_id))).scalar_one()


async def _auditoria(tenant_id: uuid.UUID) -> list[tuple[str, str]]:
    async with tenant_session(tenant_id) as s:
        filas = (await s.execute(select(AuditLog).order_by(AuditLog.created_at))).scalars().all()
    return [(f.operacion, f.resultado) for f in filas]


# ------------------------------------------------------------ flujo feliz ---


async def test_flujo_completo(emisor, redis_limpio, almacen) -> None:
    sii = SiiFalso()
    ctx = _ctx(sii, redis_limpio, almacen)
    doc_id = await _documento(emisor)

    assert await pipeline.firmar(ctx, emisor, doc_id) == E.FIRMADO
    doc = await _doc(emisor, doc_id)
    xml = await almacen.leer(doc.xml_key, doc.xml_sha256)
    assert b"<Folio>1000</Folio>" in xml
    assert doc.ted_barcode.startswith('<TED version="1.0">')

    assert await pipeline.enviar(ctx, emisor, doc_id) == E.ENVIADO
    doc = await _doc(emisor, doc_id)
    async with tenant_session(emisor) as s:
        envio = (await s.execute(select(Envio))).scalar_one()
    assert envio.track_id == "0123456789"
    sobre = await almacen.leer(envio.xml_key, envio.xml_sha256)
    assert b"<RutEnvia>11111111-1</RutEnvia>" in sobre
    assert xml.split(b"?>", 1)[1].strip() in sobre  # el DTE entra al sobre tal cual

    assert await pipeline.consultar(ctx, emisor, doc_id) == E.ACEPTADO
    doc = await _doc(emisor, doc_id)
    assert doc.estado_sii == "EPR"

    operaciones = await _auditoria(emisor)
    assert ("FIRMA", "OK") in operaciones
    assert ("ENVIO", "OK") in operaciones
    assert ("CONSULTA", "OK") in operaciones
    assert operaciones.count(("ACCESO_CERT", "OK")) == 3  # firma, envío, consulta


async def test_firmar_dos_veces_no_vuelve_a_firmar(emisor, redis_limpio, almacen) -> None:
    """El XML firmado nunca se regenera."""
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc_id = await _documento(emisor)

    await pipeline.firmar(ctx, emisor, doc_id)
    primero = (await _doc(emisor, doc_id)).xml_sha256
    assert await pipeline.firmar(ctx, emisor, doc_id) == E.FIRMADO

    assert (await _doc(emisor, doc_id)).xml_sha256 == primero
    assert (await _auditoria(emisor)).count(("FIRMA", "OK")) == 1


async def test_enviar_dos_veces_sube_una_sola_vez(emisor, redis_limpio, almacen) -> None:
    sii = SiiFalso()
    ctx = _ctx(sii, redis_limpio, almacen)
    doc_id = await _documento(emisor)
    await pipeline.firmar(ctx, emisor, doc_id)

    await pipeline.enviar(ctx, emisor, doc_id)
    assert await pipeline.enviar(ctx, emisor, doc_id) == E.ENVIADO

    assert sii.llamadas.count("upload") == 1


async def test_firma_en_otro_proceso(emisor, redis_limpio, almacen) -> None:
    """La firma corre en otro proceso (spawn): todo lo que viaja debe ser pickleable."""
    with pipeline.crear_ejecutor_firma(1) as ejecutor:
        ctx = _ctx(SiiFalso(), redis_limpio, almacen, ejecutor)
        doc_id = await _documento(emisor)
        assert await pipeline.firmar(ctx, emisor, doc_id) == E.FIRMADO


async def test_s3_detecta_contenido_alterado(emisor, redis_limpio, almacen) -> None:
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc_id = await _documento(emisor)
    await pipeline.firmar(ctx, emisor, doc_id)
    doc = await _doc(emisor, doc_id)

    with pytest.raises(IntegridadError):
        await almacen.leer(doc.xml_key, "0" * 64)


# ----------------------------------------------------------------- fallos ---


async def test_subida_ambigua_va_a_revision_y_no_se_reintenta(emisor, redis_limpio, almacen) -> None:
    """El pedido salió y no hubo respuesta: el SII pudo recibirlo. No reenviar."""
    sii = SiiFalso()

    def con_timeout(pedido: httpx.Request) -> httpx.Response:
        if str(pedido.url).endswith("DTEUpload"):
            sii.llamadas.append("upload")
            raise httpx.ReadTimeout("sin respuesta", request=pedido)
        return sii(pedido)

    ctx = _ctx(con_timeout, redis_limpio, almacen)
    doc_id = await _documento(emisor)
    await pipeline.firmar(ctx, emisor, doc_id)

    assert await pipeline.enviar(ctx, emisor, doc_id) == E.ERROR
    assert await pipeline.enviar(ctx, emisor, doc_id) == E.ERROR  # no se reintenta
    assert sii.llamadas.count("upload") == 1

    async with tenant_session(emisor) as s:
        dl = (await s.execute(select(DeadLetter))).scalar_one()
    assert "Verificar en el SII" in dl.error


async def test_envio_rechazado_va_a_revision(emisor, redis_limpio, almacen) -> None:
    sii = SiiFalso()
    sii.uploads = [(200, _upload("7"))]
    ctx = _ctx(sii, redis_limpio, almacen)
    doc_id = await _documento(emisor)
    await pipeline.firmar(ctx, emisor, doc_id)

    assert await pipeline.enviar(ctx, emisor, doc_id) == E.ERROR
    assert "esquema" in (await _doc(emisor, doc_id)).last_error


async def test_sii_caido_reintenta_con_espera_y_despues_se_rinde(emisor, redis_limpio, almacen) -> None:
    def caido(pedido: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("sin red", request=pedido)

    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc_id = await _documento(emisor)
    await pipeline.firmar(ctx, emisor, doc_id)
    ctx.http = httpx.AsyncClient(transport=httpx.MockTransport(caido))

    antes = datetime.now(timezone.utc)
    assert await pipeline.enviar(ctx, emisor, doc_id) == E.FIRMADO
    doc = await _doc(emisor, doc_id)
    assert doc.next_action_at > antes + timedelta(seconds=20)  # espera antes de reintentar

    for _ in range(pipeline.MAX_INTENTOS):
        estado = await pipeline.enviar(ctx, emisor, doc_id)
    assert estado == E.ERROR


async def test_emisor_sin_resolucion_no_puede_enviar(emisor, redis_limpio, almacen) -> None:
    async with control_session() as s:
        await s.execute(update(Tenant).where(Tenant.id == emisor).values(resolucion_fecha=None))
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc_id = await _documento(emisor)
    await pipeline.firmar(ctx, emisor, doc_id)

    assert await pipeline.enviar(ctx, emisor, doc_id) == E.ERROR
    assert "resolución" in (await _doc(emisor, doc_id)).last_error


async def test_firma_fallida_queda_auditada(emisor, redis_limpio, almacen) -> None:
    """Requisito: cada firma deja rastro, también las que fallan."""
    async with tenant_session(emisor) as s:
        from app.models import Certificate

        await s.execute(update(Certificate).values(activo=False))
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc_id = await _documento(emisor)

    assert await pipeline.firmar(ctx, emisor, doc_id) == E.ERROR
    assert ("FIRMA", "ERROR") in await _auditoria(emisor)


# --------------------------------------------------------------- consulta ---


async def test_consulta_en_proceso_se_reprograma(emisor, redis_limpio, almacen) -> None:
    sii = SiiFalso()
    sii.estados = [_estado("REC")]
    ctx = _ctx(sii, redis_limpio, almacen)
    doc_id = await _documento(emisor)
    await pipeline.firmar(ctx, emisor, doc_id)
    await pipeline.enviar(ctx, emisor, doc_id)

    assert await pipeline.consultar(ctx, emisor, doc_id) == E.ENVIADO
    doc = await _doc(emisor, doc_id)
    assert doc.estado_sii == "REC"
    assert doc.next_action_at > datetime.now(timezone.utc)


async def test_consulta_rechazada(emisor, redis_limpio, almacen) -> None:
    sii = SiiFalso()
    sii.estados = [_estado("RSC", glosa="Rechazado por Error en Schema")]
    ctx = _ctx(sii, redis_limpio, almacen)
    doc_id = await _documento(emisor)
    await pipeline.firmar(ctx, emisor, doc_id)
    await pipeline.enviar(ctx, emisor, doc_id)

    assert await pipeline.consultar(ctx, emisor, doc_id) == E.RECHAZADO
    assert (await _doc(emisor, doc_id)).glosa_sii == "Rechazado por Error en Schema"
