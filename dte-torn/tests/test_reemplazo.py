"""Volver a emitir un documento rechazado: primero se reutiliza su folio; si su
CAF venció, sale con uno nuevo y el rechazado queda por anular en el SII."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select, update

from app.db import tenant_session
from app.dte.folios import folio_vigente
from app.models import CAF, Document, EstadoCAF, EstadoDocumento
from tests.factories import caf_xml
from tests.test_api import FACTURA, RUT, _alta, api  # noqa: F401 - fixture


async def _rechazar(h, external_id: str, glosa: str = "Giro del receptor invalido") -> None:
    async with tenant_session(uuid.UUID(h["X-Tenant-Id"])) as s:
        await s.execute(update(Document).where(Document.external_id == external_id)
                        .values(estado=EstadoDocumento.RECHAZADO, glosa_sii=glosa))


async def _doc(h, external_id: str) -> Document:
    async with tenant_session(uuid.UUID(h["X-Tenant-Id"])) as s:
        return (await s.execute(select(Document).where(Document.external_id == external_id))).scalar_one()


async def _vencer_y_cargar_otro(api, h) -> None:
    """Deja el CAF 1-10 con más de 6 meses y carga uno vigente 11-20."""
    async with tenant_session(uuid.UUID(h["X-Tenant-Id"])) as s:
        await s.execute(update(CAF).values(fecha_autorizacion=date(2025, 1, 1)))
    xml = caf_xml(rut=RUT, tipo_dte=33, desde=11, hasta=20)
    assert (await api.post("/cafs", headers=h, files={"archivo": ("caf.xml", xml)})).status_code == 201


def _reemision(n: int = 1, reemplaza_a: str = "venta-1") -> dict:
    return {**FACTURA, "external_id": f"venta-1-r{n}", "reemplaza_a": reemplaza_a}


async def test_reutiliza_el_folio_del_rechazado(api) -> None:
    h = await _alta(api)
    assert (await api.post("/documents", json=FACTURA, headers=h)).json()["folio"] == 1
    await _rechazar(h, "venta-1")

    r = await api.post("/documents", json=_reemision(), headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["folio"] == 1
    assert (await _doc(h, "venta-1")).reemplazado_por == uuid.UUID(r.json()["id"])
    # No gastó un folio del CAF, y no queda nada por anular.
    assert (await api.post("/documents", json={**FACTURA, "external_id": "venta-2"}, headers=h)).json()["folio"] == 2
    assert (await api.get("/folios/por-anular", headers=h)).json() == []
    # Buscado por tipo y folio, aparece primero el documento vigente.
    lista = (await api.get("/documents", params={"tipo_dte": 33, "folio": 1}, headers=h)).json()
    assert lista[0]["external_id"] == "venta-1-r1"


async def test_con_el_caf_vencido_sale_con_folio_nuevo_y_queda_por_anular(api) -> None:
    h = await _alta(api)
    await api.post("/documents", json=FACTURA, headers=h)
    await _rechazar(h, "venta-1")
    await _vencer_y_cargar_otro(api, h)

    r = await api.post("/documents", json=_reemision(), headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["folio"] == 11

    [pendiente] = (await api.get("/folios/por-anular", headers=h)).json()
    assert (pendiente["folio"], pendiente["folio_nuevo"], pendiente["glosa_sii"]) == (1, 11, "Giro del receptor invalido")
    assert (pendiente["caf_folio_desde"], pendiente["caf_folio_hasta"]) == (1, 10)

    r = await api.post(f"/folios/por-anular/{pendiente['id']}/anulado", headers=h)
    assert r.status_code == 204
    assert (await api.get("/folios/por-anular", headers=h)).json() == []
    assert (await api.post(f"/folios/por-anular/{pendiente['id']}/anulado", headers=h)).status_code == 404


async def test_solo_se_reemplaza_un_rechazado_una_vez(api) -> None:
    h = await _alta(api)
    await api.post("/documents", json=FACTURA, headers=h)
    r = await api.post("/documents", json=_reemision(), headers=h)
    assert r.status_code == 409 and "no está rechazado" in r.json()["detail"]
    # El 409 no dejó el documento a medias ni gastó un folio.
    assert (await api.post("/documents", json={**FACTURA, "external_id": "venta-2"}, headers=h)).json()["folio"] == 2

    await _rechazar(h, "venta-1")
    assert (await api.post("/documents", json=_reemision(1), headers=h)).status_code == 201
    r = await api.post("/documents", json=_reemision(2), headers=h)
    assert r.status_code == 409 and "ya se volvió a emitir" in r.json()["detail"]
    # Reintentar la misma reemisión devuelve el mismo documento.
    assert (await api.post("/documents", json=_reemision(1), headers=h)).status_code == 200


async def test_un_reutilizado_que_vuelve_a_rechazarse_se_anula_una_sola_vez(api) -> None:
    """venta-1 (folio 1) rechazada, r1 reutiliza el 1 y también se rechaza; r2
    sale con folio nuevo. Por anular queda el folio 1, una vez."""
    h = await _alta(api)
    await api.post("/documents", json=FACTURA, headers=h)
    await _rechazar(h, "venta-1")
    await api.post("/documents", json=_reemision(1), headers=h)
    await _rechazar(h, "venta-1-r1")
    await _vencer_y_cargar_otro(api, h)
    assert (await api.post("/documents", json=_reemision(2, "venta-1-r1"), headers=h)).json()["folio"] == 11

    pendientes = (await api.get("/folios/por-anular", headers=h)).json()
    assert [(p["external_id"], p["folio"]) for p in pendientes] == [("venta-1-r1", 1)]


def test_vigencia_de_seis_meses_solo_en_facturas_y_notas() -> None:
    def caf(tipo: int, autorizado: date) -> CAF:
        return CAF(tipo_dte=tipo, fecha_autorizacion=autorizado, estado=EstadoCAF.ACTIVO, fecha_vencimiento=None)

    hoy = date(2026, 9, 30)
    assert folio_vigente(caf(33, date(2026, 3, 30)), hoy)
    assert not folio_vigente(caf(33, date(2026, 3, 29)), hoy)
    assert not folio_vigente(caf(61, date(2025, 12, 1)), hoy)
    assert folio_vigente(caf(39, date(2025, 1, 1)), hoy)  # las boletas no vencen así
    assert not folio_vigente(CAF(tipo_dte=39, estado=EstadoCAF.VENCIDO), hoy)
