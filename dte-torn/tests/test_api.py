"""La API de punta a punta, con Postgres, Redis y MinIO reales.

Lo que más importa: que un payload inválido **no quema un folio**, que el
mismo `external_id` devuelve el mismo documento, y que un tenant no ve los
documentos de otro.
"""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import select

from app.db import tenant_session
from app.dte import pipeline
from app.main import app
from app.models import AuditLog
from app.tasks import colas
from tests.factories import CLAVE_PFX, caf_xml, pfx
from tests.test_sii_client import SiiFalso

RUT = "76543210-3"
CLAVE = {"X-Internal-Api-Key": "test"}
RECEPTOR = {"rut": "77777777-7", "razon_social": "Cliente Ltda", "giro": "Servicios",
            "direccion": "Calle 1", "comuna": "Santiago"}
FACTURA = {"external_id": "venta-1", "tipo_dte": 33, "fecha_emision": "2026-09-23",
           "receptor": RECEPTOR, "items": [{"nombre": "Servicio", "precio": "10000"}]}
EMISOR = {"rut_emisor": RUT, "razon_social": "Empresa de Prueba SpA", "giro": "Venta al por menor",
          "acteco": "471100", "direccion": "Av. Siempre Viva 742", "comuna": "Santiago",
          "resolucion_fecha": "2026-09-01", "oficina_sii": "S.I.I. - Santiago Centro"}


@pytest.fixture
async def api(limpiar, redis_limpio, almacen, monkeypatch):
    """Cliente HTTP contra la app, con el SII simulado y las colas capturadas."""
    app.state.ctx = pipeline.Contexto(
        http=httpx.AsyncClient(transport=httpx.MockTransport(SiiFalso())), redis=redis_limpio, almacen=almacen
    )
    encolados: list[tuple[str, uuid.UUID]] = []

    async def encolar(estado, tenant_id, doc_id) -> None:
        encolados.append((estado, doc_id))

    monkeypatch.setattr(colas, "encolar", encolar)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://dte") as cliente:
        cliente.encolados = encolados
        yield cliente


async def _alta(api, rut: str = RUT, **cambios) -> dict[str, str]:
    """Da de alta una empresa con certificado y un CAF de facturas 1-10."""
    tid = str(uuid.uuid4())
    r = await api.put(f"/tenants/{tid}", json={**EMISOR, "rut_emisor": rut, **cambios}, headers=CLAVE)
    assert r.status_code == 200, r.text
    h = {**CLAVE, "X-Tenant-Id": tid}
    r = await api.post("/certificates", headers=h, files={"archivo": ("c.pfx", pfx(rut="11111111-1"))},
                       data={"password": CLAVE_PFX})
    assert r.status_code == 201, r.text
    r = await api.post("/cafs", headers=h, files={"archivo": ("caf.xml", caf_xml(rut=rut, tipo_dte=33, desde=1, hasta=10))})
    assert r.status_code == 201, r.text
    return h


async def _disponibles(api, h, tipo: int = 33) -> int:
    stock = {s["tipo_dte"]: s["disponibles"] for s in (await api.get("/folios", headers=h)).json()}
    return stock.get(tipo, 0)


async def test_sin_api_key_no_entra(api) -> None:
    h = await _alta(api)
    assert (await api.get("/folios", headers={**h, "X-Internal-Api-Key": "otra"})).status_code == 401
    assert (await api.put(f"/tenants/{uuid.uuid4()}", json=EMISOR)).status_code == 401


async def test_tenant_desconocido(api) -> None:
    assert (await api.get("/folios", headers={**CLAVE, "X-Tenant-Id": str(uuid.uuid4())})).status_code == 404


async def test_sincronizar_emisor_es_idempotente(api) -> None:
    tid = str(uuid.uuid4())
    assert (await api.put(f"/tenants/{tid}", json=EMISOR, headers=CLAVE)).status_code == 200
    r = await api.put(f"/tenants/{tid}", json={**EMISOR, "giro": "Otro giro"}, headers=CLAVE)
    assert r.json()["giro"] == "Otro giro"
    # El mismo RUT en otro tenant es un error del llamador.
    assert (await api.put(f"/tenants/{uuid.uuid4()}", json=EMISOR, headers=CLAVE)).status_code == 409


async def test_vigencia_del_certificado_sin_material_sensible(api) -> None:
    h = await _alta(api)
    r = await api.get("/certificates/actual", headers=h)
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["titular_rut"] == "11111111-1"
    assert cuerpo["dias_restantes"] > 300
    assert set(cuerpo) == {"titular_rut", "fingerprint_sha256", "not_before", "not_after", "dias_restantes", "subido_en"}

    r = await api.post("/certificates", headers=h, files={"archivo": ("c.pfx", pfx(rut="11111111-1"))},
                       data={"password": "mala"})
    assert r.status_code == 422


async def test_caf_solapado_o_de_otra_empresa(api) -> None:
    h = await _alta(api)
    assert await _disponibles(api, h) == 10
    otra_vez = await api.post("/cafs", headers=h, files={"archivo": ("caf.xml", caf_xml(rut=RUT, tipo_dte=33, desde=5, hasta=20))})
    assert otra_vez.status_code == 409
    ajeno = await api.post("/cafs", headers=h, files={"archivo": ("caf.xml", caf_xml(rut="77777777-7", tipo_dte=33, desde=50, hasta=60))})
    assert ajeno.status_code == 422


async def test_emitir_firma_en_linea_y_encola_el_envio(api) -> None:
    h = await _alta(api)
    r = await api.post("/documents", json=FACTURA, headers=h)
    assert r.status_code == 201, r.text
    doc = r.json()
    assert (doc["folio"], doc["estado"], doc["monto_total"]) == (1, "FIRMADO", 11900)
    assert doc["ted"].startswith("<TED")
    assert api.encolados == [("FIRMADO", uuid.UUID(doc["id"]))]
    assert await _disponibles(api, h) == 9


async def test_reintento_devuelve_el_mismo_folio(api) -> None:
    h = await _alta(api)
    primero = (await api.post("/documents", json=FACTURA, headers=h)).json()
    r = await api.post("/documents", json=FACTURA, headers=h)
    assert r.status_code == 200
    assert r.json()["folio"] == primero["folio"]
    assert await _disponibles(api, h) == 9

    distinto = {**FACTURA, "items": [{"nombre": "Otra cosa", "precio": "5000"}]}
    assert (await api.post("/documents", json=distinto, headers=h)).status_code == 409


async def test_payload_invalido_no_quema_folio(api) -> None:
    h = await _alta(api)
    sin_receptor = {**FACTURA, "receptor": None}
    assert (await api.post("/documents", json=sin_receptor, headers=h)).status_code == 422
    descuento_imposible = {**FACTURA, "items": [{"nombre": "X", "precio": "100", "descuento": 500}]}
    assert (await api.post("/documents", json=descuento_imposible, headers=h)).status_code == 422
    assert await _disponibles(api, h) == 10


async def test_emisor_incompleto_no_quema_folio(api) -> None:
    """Lo que solo detecta el builder (emisor sin dirección) también va antes del folio."""
    h = await _alta(api, direccion=None)
    r = await api.post("/documents", json=FACTURA, headers=h)
    assert r.status_code == 422
    assert "dirección" in r.json()["detail"]
    assert await _disponibles(api, h) == 10


async def test_boletas_por_su_endpoint(api) -> None:
    h = await _alta(api)
    boleta = {"external_id": "b-1", "tipo_dte": 39, "fecha_emision": "2026-09-23",
              "items": [{"nombre": "Pan", "precio": "1190"}]}
    assert (await api.post("/documents", json=boleta, headers=h)).status_code == 422
    assert (await api.post("/boletas", json=FACTURA, headers=h)).status_code == 422
    # Sin CAF de boletas: 409, no 500.
    assert (await api.post("/boletas", json=boleta, headers=h)).status_code == 409


async def test_xml_y_pdf_desde_lo_firmado(api) -> None:
    h = await _alta(api)
    await api.post("/documents", json=FACTURA, headers=h)

    xml = await api.get("/documents/venta-1/xml", headers={**h, "X-Actor": "cajera@torn.cl"})
    assert xml.status_code == 200
    assert xml.headers["content-type"] == "application/xml; charset=ISO-8859-1"
    assert xml.content.startswith(b'<?xml version="1.0" encoding="ISO-8859-1"?>')

    pdf = await api.get("/documents/venta-1/pdf?cedible=true", headers=h)
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")
    assert "DTE_33_1_cedible.pdf" in pdf.headers["content-disposition"]

    async with tenant_session(uuid.UUID(h["X-Tenant-Id"])) as s:
        descargas = (await s.execute(select(AuditLog.operacion, AuditLog.actor).where(AuditLog.operacion.like("DESCARGA%")))).all()
    assert sorted(descargas) == [("DESCARGA_PDF", None), ("DESCARGA_XML", "cajera@torn.cl")]


async def test_un_tenant_no_ve_los_documentos_de_otro(api) -> None:
    h = await _alta(api)
    await api.post("/documents", json=FACTURA, headers=h)
    otro = await _alta(api, rut="76111111-6")
    assert (await api.get("/documents/venta-1", headers=otro)).status_code == 404
    assert (await api.get("/documents", headers=otro)).json() == []
    assert len((await api.get("/documents?estado=FIRMADO", headers=h)).json()) == 1
    [doc] = (await api.get("/documents?tipo_dte=33&folio=1", headers=h)).json()
    assert doc["external_id"] == "venta-1"
    assert (await api.get("/documents?tipo_dte=33&folio=2", headers=h)).json() == []


async def _cambiar_ambiente(api, h, ambiente: str, rut: str = RUT) -> None:
    r = await api.put(f"/tenants/{h['X-Tenant-Id']}", json={**EMISOR, "rut_emisor": rut, "ambiente": ambiente}, headers=CLAVE)
    assert r.status_code == 200, r.text


async def test_desarrollador_emite_con_folios_de_prueba_y_sin_sii(api) -> None:
    h = await _alta(api)
    await _cambiar_ambiente(api, h, "DEV")

    r = await api.post("/documents", json=FACTURA, headers=h)
    assert r.status_code == 201, r.text
    doc = r.json()
    # CAF de prueba generado solo: folio 1 aunque el CAF de maullín también parte en 1.
    assert (doc["folio"], doc["estado"], doc["ambiente"]) == (1, "SIMULADO", "DEV")
    assert doc["ted"].startswith("<TED")
    assert api.encolados == []  # nada va a la cola de envío
    assert await _disponibles(api, h) == 99_999

    pdf = await api.get("/documents/venta-1/pdf", headers=h)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")

    caf = await api.post("/cafs", headers=h, files={"archivo": ("caf.xml", caf_xml(rut=RUT, tipo_dte=33, desde=50, hasta=60))})
    assert caf.status_code == 409


async def test_cada_ambiente_ve_sus_documentos_y_sus_folios(api) -> None:
    h = await _alta(api)
    assert (await api.post("/documents", json=FACTURA, headers=h)).json()["ambiente"] == "CERT"

    await _cambiar_ambiente(api, h, "DEV")
    await api.post("/documents", json={**FACTURA, "external_id": "venta-2"}, headers=h)
    assert [d["external_id"] for d in (await api.get("/documents", headers=h)).json()] == ["venta-2"]

    await _cambiar_ambiente(api, h, "CERT")
    assert [d["external_id"] for d in (await api.get("/documents", headers=h)).json()] == ["venta-1"]
    assert await _disponibles(api, h) == 9  # el CAF de prueba no se mezcla con el de maullín
    # Por external_id se encuentra igual: el backend reimprime ventas de otro modo.
    assert (await api.get("/documents/venta-2", headers=h)).json()["estado"] == "SIMULADO"


def test_un_documento_de_desarrollador_no_llega_al_sii() -> None:
    ctx = pipeline.Contexto(http=None, redis=None, almacen=None)
    with pytest.raises(ValueError):
        ctx.sii("DEV")
