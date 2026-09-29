"""Intercambio: el XML aceptado por el SII va al correo del receptor.

Con Postgres, Redis y MinIO reales; el SII y el servidor de correo simulados.
"""

from __future__ import annotations

import smtplib
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from email.message import EmailMessage

import httpx
from lxml import etree
from sqlalchemy import select, update

from app.core.correo import Correo
from app.db import tenant_session
from app.dte import pipeline
from app.dte.builder import DatosDocumento, Item, Receptor, calcular_totales
from app.dte.folios import DatosEmision, emitir_documento
from app.dte.signer import verificar_sobre
from app.models import Ambiente, DeadLetter, Document, EstadoDocumento, EstadoIntercambio
from tests.test_api import _alta, api  # noqa: F401 - fixture
from tests.test_pipeline import _ctx, _doc, emisor  # noqa: F401 - fixture
from tests.test_sii_client import SiiFalso

E, I = EstadoDocumento, EstadoIntercambio


class CorreoFalso:
    """Servidor SMTP de mentira: guarda lo enviado, o falla con `error`."""

    remitente = "xml@empresa.cl"

    def __init__(self, error: Exception | None = None) -> None:
        self.enviados: list[EmailMessage] = []
        self.error = error

    async def enviar(self, mensaje: EmailMessage) -> None:
        if self.error:
            raise self.error
        self.enviados.append(mensaje)


async def _factura(tenant_id: uuid.UUID, correo: str | None = "dte@cliente.cl") -> uuid.UUID:
    datos = DatosDocumento(
        tipo_dte=33, fecha_emision=date(2026, 9, 23),
        receptor=Receptor(rut="77777777-7", razon_social="Cliente Ltda", giro="Servicios",
                          direccion="Calle 1", comuna="Santiago", correo=correo),
        items=[Item(nombre="Servicio", precio=Decimal("10000"))],
    )
    t = calcular_totales(datos.tipo_dte, datos.items)
    async with tenant_session(tenant_id) as s:
        doc, _ = await emitir_documento(s, tenant_id, DatosEmision(
            external_id=f"venta-{uuid.uuid4().hex[:8]}", tipo_dte=33, fecha_emision=datos.fecha_emision,
            payload=datos.model_dump(mode="json"), monto_neto=t.neto, monto_iva=t.iva, monto_total=t.total,
        ))
        return doc.id


async def _aceptada(ctx, tenant_id, doc_id, ambiente: str = Ambiente.PROD) -> Document:
    """Firma, sube y consulta; el ambiente se fija antes de la consulta."""
    await pipeline.firmar(ctx, tenant_id, doc_id)
    await pipeline.enviar(ctx, tenant_id, doc_id)
    async with tenant_session(tenant_id) as s:
        await s.execute(update(Document).where(Document.id == doc_id).values(ambiente=ambiente))
    assert await pipeline.consultar(ctx, tenant_id, doc_id) == E.ACEPTADO
    return await _doc(tenant_id, doc_id)


async def test_aceptada_en_produccion_va_al_receptor(emisor, redis_limpio, almacen) -> None:
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc_id = await _factura(emisor)
    doc = await _aceptada(ctx, emisor, doc_id)
    assert (doc.intercambio_estado, doc.intercambio_correo) == (I.PENDIENTE, "dte@cliente.cl")

    ctx.correo = correo = CorreoFalso()
    assert await pipeline.intercambiar(ctx, emisor, doc_id) == I.ENVIADO
    doc = await _doc(emisor, doc_id)
    assert doc.intercambio_estado == I.ENVIADO and doc.intercambio_at is not None

    [msg] = correo.enviados
    assert msg["To"] == "dte@cliente.cl"
    assert "FACTURA ELECTRONICA".capitalize() in msg["Subject"]
    xml, pdf = list(msg.iter_attachments())
    assert xml.get_filename() == f"DTE_76543210-3_33_{doc.folio}.xml"
    assert pdf.get_content_type() == "application/pdf"
    sobre = xml.get_content()
    # El sobre va dirigido al cliente, no al SII, y sus firmas verifican.
    assert b"<RutReceptor>77777777-7</RutReceptor>" in sobre
    async with tenant_session(emisor) as s:
        from app.core.certificados import cargar_certificado
        cert = await cargar_certificado(s, emisor, motivo="test")
    verificar_sobre(etree.fromstring(sobre), cert.cert_pem)

    # Mandarlo otra vez no hace nada: ya no está pendiente.
    assert await pipeline.intercambiar(ctx, emisor, doc_id) == I.ENVIADO
    assert len(correo.enviados) == 1


async def test_en_certificacion_no_sale_solo(emisor, redis_limpio, almacen) -> None:
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc = await _aceptada(ctx, emisor, await _factura(emisor), ambiente=Ambiente.CERT)
    assert doc.intercambio_estado is None


async def test_receptor_sin_correo(emisor, redis_limpio, almacen) -> None:
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc = await _aceptada(ctx, emisor, await _factura(emisor, correo=None))
    assert doc.intercambio_estado == I.SIN_CORREO


async def test_servidor_caido_reintenta_y_direccion_rechazada_queda_en_error(emisor, redis_limpio, almacen) -> None:
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc_id = await _factura(emisor)
    await _aceptada(ctx, emisor, doc_id)

    ctx.correo = CorreoFalso(smtplib.SMTPServerDisconnected("se cortó"))
    assert await pipeline.intercambiar(ctx, emisor, doc_id) == I.PENDIENTE
    doc = await _doc(emisor, doc_id)
    assert doc.intercambio_intentos == 1 and doc.intercambio_next_at > datetime.now(timezone.utc)

    ctx.correo = CorreoFalso(smtplib.SMTPRecipientsRefused({"dte@cliente.cl": (550, b"no existe")}))
    assert await pipeline.intercambiar(ctx, emisor, doc_id) == I.ERROR
    async with tenant_session(emisor) as s:
        [muerto] = (await s.execute(select(DeadLetter))).scalars().all()
    assert muerto.cola == "intercambio"


async def test_sin_servidor_de_correo_no_hace_nada(emisor, redis_limpio, almacen) -> None:
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    doc_id = await _factura(emisor)
    await _aceptada(ctx, emisor, doc_id)
    assert ctx.correo is None
    assert await pipeline.intercambiar(ctx, emisor, doc_id) == I.PENDIENTE


def test_correo_se_configura_con_host_y_remitente() -> None:
    class S:
        smtp_host, smtp_puerto, smtp_usuario, smtp_clave, smtp_remitente = "mail.x.cl", 465, "xml@x.cl", "k", None
    assert Correo.desde(S()).remitente == "xml@x.cl"
    S.smtp_host = None
    assert Correo.desde(S()) is None


async def test_api_reenvio_a_mano(api, monkeypatch) -> None:  # noqa: F811
    h = await _alta(api)
    r = await api.post("/documents", json={
        "external_id": "venta-1", "tipo_dte": 33, "fecha_emision": "2026-09-23",
        "receptor": {"rut": "77777777-7", "razon_social": "Cliente Ltda", "giro": "Servicios",
                     "direccion": "Calle 1", "comuna": "Santiago"},
        "items": [{"nombre": "Servicio", "precio": "10000"}],
    }, headers=h)
    assert r.status_code == 201, r.text

    # Sin aceptar todavía: no se manda.
    r = await api.post("/documents/venta-1/intercambio", json={"correo": "yo@mio.cl"}, headers=h)
    assert r.status_code == 409

    tid = uuid.UUID(h["X-Tenant-Id"])
    async with tenant_session(tid) as s:
        await s.execute(update(Document).values(estado=E.ACEPTADO))
    # Sin correo del receptor y sin uno nuevo: hay que indicarlo.
    assert (await api.post("/documents/venta-1/intercambio", json={}, headers=h)).status_code == 422
    assert (await api.post("/documents/venta-1/intercambio", json={"correo": "malo"}, headers=h)).status_code == 422

    r = await api.post("/documents/venta-1/intercambio", json={"correo": "yo@mio.cl"}, headers=h)
    assert r.status_code == 200, r.text
    assert (r.json()["intercambio_estado"], r.json()["intercambio_correo"]) == ("PENDIENTE", "yo@mio.cl")
