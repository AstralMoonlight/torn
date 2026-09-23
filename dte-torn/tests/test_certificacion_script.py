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
from tests.test_sii_client import SiiFalso, _estado, _upload


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
    monkeypatch.setattr(certificacion, "_CONSULTA_RAPIDA_SEGUNDOS", 1)
    monkeypatch.setattr(certificacion, "_CONSULTA_LENTA_SEGUNDOS", 1)
    monkeypatch.setattr(certificacion, "_TRAMO_RAPIDO_SEGUNDOS", 2)
    monkeypatch.setattr(certificacion, "_ESPERA_TOTAL_SEGUNDOS", 3)
    return sii


async def test_enviar_de_punta_a_punta(entorno, capsys) -> None:
    assert await certificacion.modo_enviar() == 0

    salida = capsys.readouterr().out
    assert "1. Firma: FIRMADO" in salida
    assert "2. Envío: ENVIADO" in salida
    assert "Track ID: 0123456789" in salida
    assert "Resultado: ACEPTADO" in salida
    assert "Subida al SII:" in salida and "hora de Chile" in salida
    assert "El SII dio el resultado final entre +0:00 y +0:0" in salida
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


async def test_nota_de_credito_de_prueba_anula_una_factura(entorno, tmp_path, monkeypatch) -> None:
    """Para subir el máximo de notas de crédito: cada una anula una factura aceptada."""
    await certificacion.modo_enviar()  # factura folio 1, aceptada

    caf_nc = tmp_path / "caf_61.xml"
    caf_nc.write_bytes(caf_xml(rut="76543210-3", tipo_dte=61, desde=1, hasta=10))
    monkeypatch.setenv("DTE_CAF", str(caf_nc))
    entorno.uploads = [(200, _upload("0", "999"))]
    entorno.estados = [_estado("EPR", aceptados=1)]
    assert await certificacion.modo_enviar() == 0

    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        nc = (await s.execute(select(Document).where(Document.tipo_dte == 61))).scalar_one()
    ref = nc.payload["referencias"][0]
    assert (ref["tipo_doc"], ref["folio"], ref["codigo"]) == ("33", "1", 1)
    assert nc.estado == "ACEPTADO"


async def test_sin_factura_que_anular_no_parte(entorno, tmp_path, monkeypatch) -> None:
    caf_nc = tmp_path / "caf_61.xml"
    caf_nc.write_bytes(caf_xml(rut="76543210-3", tipo_dte=61, desde=1, hasta=10))
    monkeypatch.setenv("DTE_CAF", str(caf_nc))
    with pytest.raises(SystemExit, match="Primero emite"):
        await certificacion.modo_enviar()


@pytest.fixture
def entorno_set(entorno, tmp_path, monkeypatch):
    """El set básico de prueba, con CAF de sobra para facturas y notas."""
    from tests.test_set_pruebas import SET_BASICO

    ruta_set = tmp_path / "set.txt"
    ruta_set.write_bytes(SET_BASICO.encode("latin-1"))
    rutas = []
    for tipo, desde in ((33, 1), (61, 1), (56, 1)):
        ruta = tmp_path / f"caf_{tipo}.xml"
        ruta.write_bytes(caf_xml(rut="76543210-3", tipo_dte=tipo, desde=desde, hasta=desde + 9))
        rutas.append(str(ruta))
    monkeypatch.setenv("DTE_SET", str(ruta_set))
    monkeypatch.setenv("DTE_CAFS", ",".join(rutas))
    monkeypatch.setenv("DTE_CAF", rutas[0])
    entorno.estados = [_estado("EPR", aceptados=8)] * 5
    return entorno


async def test_el_set_va_en_un_solo_envio(entorno_set, capsys) -> None:
    assert await certificacion.modo_set() == 0

    salida = capsys.readouterr().out
    assert entorno_set.llamadas.count("upload") == 1
    assert "N° de envío: 0123456789" in salida

    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        docs = (await s.execute(select(Document))).scalars().all()
    assert len(docs) == 8
    assert {d.estado for d in docs} == {"ACEPTADO"}
    assert len({d.envio_id for d in docs}) == 1  # todos en el mismo envío


async def test_correr_el_set_otra_vez_no_reenvia(entorno_set, capsys) -> None:
    await certificacion.modo_set()
    await certificacion.modo_set()
    assert entorno_set.llamadas.count("upload") == 1
    assert "ya se había enviado" in capsys.readouterr().out


async def test_sin_folios_suficientes_no_emite_nada(entorno_set, tmp_path, monkeypatch) -> None:
    """Si falta un CAF, no se gasta ningún folio."""
    monkeypatch.setenv("DTE_CAFS", str(tmp_path / "caf_33.xml"))
    assert await certificacion.modo_set() == 1

    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        assert (await s.execute(select(Document))).scalars().all() == []
