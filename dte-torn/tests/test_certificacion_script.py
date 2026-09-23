"""El diagnóstico `enviar`, de punta a punta, con el SII simulado.

Se corre contra el SII real con el certificado de verdad y gasta un folio de
certificación: si falla a mitad de camino tiene que fallar acá primero.
"""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy import func, select

from app.db import control_session, tenant_session
from app.models import Certificate, Document, Tenant
from app.scripts import certificacion
from tests.factories import CLAVE_PFX, caf_xml, pfx
from tests.test_sii_client import SiiFalso


@pytest.fixture
def entorno(tmp_path, monkeypatch, redis_limpio, almacen, limpiar):
    ruta_pfx = tmp_path / "cert.pfx"
    ruta_pfx.write_bytes(pfx(rut="11111111-1"))
    ruta_caf = tmp_path / "caf.xml"
    ruta_caf.write_bytes(caf_xml(rut="76543210-3", tipo_dte=33, desde=1, hasta=50))

    for nombre, valor in {
        "DTE_CERT_PFX": str(ruta_pfx),
        "DTE_CERT_PASSWORD": CLAVE_PFX,
        "DTE_CAF": str(ruta_caf),
        "DTE_FCH_RESOL": "2026-09-01",
        "DTE_EMISOR_GIRO": "Venta al por menor",
        "DTE_EMISOR_ACTECO": "471100",
        "DTE_EMISOR_DIRECCION": "Av. Siempre Viva 742",
        "DTE_EMISOR_COMUNA": "Santiago",
    }.items():
        monkeypatch.setenv(nombre, valor)

    sii = SiiFalso()
    monkeypatch.setattr(
        certificacion,
        "crear_http",
        lambda timeout: httpx.AsyncClient(transport=httpx.MockTransport(sii)),
    )
    monkeypatch.setattr(certificacion, "_ENTRE_CONSULTAS_SEGUNDOS", 1)
    monkeypatch.setattr(certificacion, "_ESPERA_TOTAL_SEGUNDOS", 3)
    return sii


async def test_enviar_de_punta_a_punta(entorno, capsys) -> None:
    assert await certificacion.modo_enviar() == 0

    salida = capsys.readouterr().out
    assert "1. Firma: FIRMADO" in salida
    assert "2. Envío: ENVIADO" in salida
    assert "Track ID: 0123456789" in salida
    assert "Resultado: ACEPTADO" in salida
    assert entorno.llamadas.count("upload") == 1

    async with control_session() as s:
        tenant = (await s.execute(select(Tenant))).scalar_one()
    assert tenant.ambiente == "CERT"  # nunca producción


async def test_correrlo_dos_veces_usa_folios_distintos(entorno) -> None:
    """Cada corrida gasta un folio nuevo: nunca reenvía el mismo."""
    await certificacion.modo_enviar()
    await certificacion.modo_enviar()

    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        folios = (await s.execute(select(Document.folio).order_by(Document.folio))).scalars().all()
        certificados = (await s.execute(select(func.count()).select_from(Certificate))).scalar_one()
    assert folios == [1, 2]
    assert certificados == 1  # el mismo certificado no se vuelve a cargar


async def test_sin_datos_del_emisor_no_parte(entorno, monkeypatch) -> None:
    monkeypatch.delenv("DTE_FCH_RESOL")
    with pytest.raises(SystemExit, match="DTE_FCH_RESOL"):
        await certificacion.modo_enviar()
