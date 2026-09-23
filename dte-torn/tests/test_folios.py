"""Tests de la parte que no puede fallar: la asignación de folios.

Un folio duplicado es un documento tributario inválido y una multa; uno saltado
hay que declararlo al SII. Todo lo demás del servicio se puede reintentar.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.db import tenant_session
from app.dte.folios import (
    DatosEmision,
    PayloadDistintoError,
    SinFoliosError,
    emitir_documento,
    folios_disponibles,
    siguiente_folio,
)
from app.models import CAF, Document, EstadoCAF


def _datos(external_id: str, tipo_dte: int = 33, monto: int = 1000) -> DatosEmision:
    return DatosEmision(
        external_id=external_id,
        tipo_dte=tipo_dte,
        fecha_emision=date(2026, 9, 23),
        payload={"venta": external_id, "total": monto},
        receptor_rut="11111111-1",
        monto_neto=monto,
        monto_total=monto,
    )


async def _emitir(tenant: uuid.UUID, datos: DatosEmision) -> tuple[int | None, bool]:
    async with tenant_session(tenant) as s:
        doc, creado = await emitir_documento(s, tenant, datos)
        return doc.folio, creado


# ------------------------------------------------------------- aritmética ---


class _CafFalso:
    def __init__(self, desde: int, hasta: int, usado: int) -> None:
        self.folio_desde = desde
        self.folio_hasta = hasta
        self.ultimo_folio_usado = usado


def test_primer_folio_es_folio_desde_no_uno() -> None:
    """Un CAF sin estrenar arranca en `folio_desde`, no en 1."""
    caf = _CafFalso(1000, 1100, 999)
    assert siguiente_folio(caf) == 1000
    assert folios_disponibles(caf) == 101


def test_folios_disponibles_no_es_el_rango_completo() -> None:
    """Con 50 emitidos de 1000-1100 quedan 51, no 1100."""
    caf = _CafFalso(1000, 1100, 1049)
    assert siguiente_folio(caf) == 1050
    assert folios_disponibles(caf) == 51


# ------------------------------------------------------------- atomicidad ---


async def test_emision_simple(tenant: uuid.UUID, caf_factory) -> None:
    """El primer documento toma el primer folio del rango."""
    await caf_factory()
    folio, creado = await _emitir(tenant, _datos("venta-1"))
    assert (folio, creado) == (1000, True)


async def test_concurrencia_no_duplica_ni_salta(tenant: uuid.UUID, caf_factory) -> None:
    """10 emisiones simultáneas dan 10 folios consecutivos y distintos."""
    await caf_factory()

    resultados = await asyncio.gather(
        *(_emitir(tenant, _datos(f"venta-{i}")) for i in range(10))
    )
    folios = sorted(f for f, _ in resultados)

    assert folios == list(range(1000, 1010)), "hay folios repetidos o saltados"

    async with tenant_session(tenant) as s:
        caf = (await s.execute(select(CAF))).scalar_one()
        assert caf.ultimo_folio_usado == 1009


async def test_reintento_no_quema_folio(tenant: uuid.UUID, caf_factory) -> None:
    """El mismo `external_id` diez veces en paralelo consume un solo folio."""
    await caf_factory()
    datos = _datos("venta-unica")

    resultados = await asyncio.gather(*(_emitir(tenant, datos) for _ in range(10)))

    folios = {f for f, _ in resultados}
    assert folios == {1000}
    assert sum(1 for _, creado in resultados if creado) == 1

    async with tenant_session(tenant) as s:
        caf = (await s.execute(select(CAF))).scalar_one()
        assert caf.ultimo_folio_usado == 1000
        docs = (await s.execute(select(Document))).scalars().all()
        assert len(docs) == 1


async def test_mismo_external_id_con_otro_payload_falla(
    tenant: uuid.UUID, caf_factory
) -> None:
    """Reusar la clave de idempotencia para otro documento es error, no reintento."""
    await caf_factory()
    await _emitir(tenant, _datos("venta-1", monto=1000))

    with pytest.raises(PayloadDistintoError):
        await _emitir(tenant, _datos("venta-1", monto=2000))


async def test_sin_caf_no_inventa_folio(tenant: uuid.UUID) -> None:
    """Sin CAF cargado no se emite nada: ni documento ni folio."""
    with pytest.raises(SinFoliosError):
        await _emitir(tenant, _datos("venta-1"))

    async with tenant_session(tenant) as s:
        assert (await s.execute(select(Document))).scalars().all() == []


async def test_caf_agotado_pasa_al_siguiente(tenant: uuid.UUID, caf_factory) -> None:
    """Al acabarse un CAF se sigue con el siguiente rango, sin dejar huecos."""
    await caf_factory(desde=1000, hasta=1001)  # dos folios
    await caf_factory(desde=5000, hasta=5010)

    folios = []
    for i in range(4):
        folio, _ = await _emitir(tenant, _datos(f"venta-{i}"))
        folios.append(folio)

    assert folios == [1000, 1001, 5000, 5001]

    async with tenant_session(tenant) as s:
        agotado = (
            await s.execute(select(CAF).where(CAF.folio_desde == 1000))
        ).scalar_one()
        assert agotado.estado == EstadoCAF.AGOTADO


async def test_caf_vencido_no_se_usa(tenant: uuid.UUID, caf_factory) -> None:
    """Un CAF con fecha de vencimiento pasada no entrega folios."""
    caf_id = await caf_factory()
    async with tenant_session(tenant) as s:
        caf = (await s.execute(select(CAF).where(CAF.id == caf_id))).scalar_one()
        caf.fecha_vencimiento = date(2020, 1, 1)

    with pytest.raises(SinFoliosError):
        await _emitir(tenant, _datos("venta-1"))


# --------------------------------------------------------------------- RLS --


async def test_rls_aisla_los_tenants(tenant: uuid.UUID, caf_factory) -> None:
    """Un tenant no ve los documentos ni los CAF de otro."""
    from app.db import control_session
    from app.models import Tenant

    await caf_factory()
    await _emitir(tenant, _datos("venta-1"))

    otro = uuid.uuid4()
    async with control_session() as s:
        s.add(
            Tenant(
                id=otro,
                rut_emisor="99999999-9",
                razon_social="Otra SpA",
                giro="Otro",
                acteco="620200",
            )
        )

    async with tenant_session(otro) as s:
        assert (await s.execute(select(Document))).scalars().all() == []
        assert (await s.execute(select(CAF))).scalars().all() == []


async def test_sin_tenant_fijado_no_se_ve_nada(tenant: uuid.UUID, caf_factory) -> None:
    """Sin `app.tenant_id`, la política falla cerrada: cero filas, no todas.

    Es la garantía de la que depende todo el aislamiento. Si alguien agrega un
    camino que consulta sin declarar el tenant, tiene que devolver vacío.
    """
    from app.db import control_session

    await caf_factory()
    await _emitir(tenant, _datos("venta-1"))

    async with control_session() as s:
        assert (await s.execute(select(Document))).scalars().all() == []
        assert (await s.execute(select(CAF))).scalars().all() == []
