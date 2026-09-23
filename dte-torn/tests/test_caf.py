"""Carga del CAF (issue #22).

Dos de estas comprobaciones son las que justifican el módulo entero:

- El CAF de otro RUT se rechaza. Cargarlo sería emitir documentos con folios de
  otra empresa.
- El rango solapado se rechaza. Dos CAF que se cruzan permiten emitir dos
  documentos con el mismo folio, que es exactamente lo que el resto del
  servicio se esfuerza en impedir.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.db import control_session, tenant_session
from app.dte.caf import (
    CafDeOtroEmisorError,
    CafInvalidoError,
    RangoSolapadoError,
    abrir_caf,
    guardar_caf,
    normalizar_rut,
    parsear_caf,
)
from app.dte.folios import DatosEmision, emitir_documento
from app.models import CAF, AuditLog, EstadoCAF, Tenant
from tests.factories import caf_xml

RUT_TENANT = "76543210-9"


@pytest.fixture
async def emisor(limpiar: None) -> uuid.UUID:
    """Tenant cuyo RUT calza con el de los CAF de prueba."""
    tid = uuid.uuid4()
    async with control_session() as s:
        s.add(
            Tenant(
                id=tid,
                rut_emisor=RUT_TENANT,
                razon_social="Empresa de Prueba SpA",
                giro="Servicios",
                acteco="620200",
            )
        )
    return tid


# ------------------------------------------------------------------ parseo --


def test_lee_los_campos_del_caf() -> None:
    caf = parsear_caf(caf_xml(tipo_dte=39, desde=500, hasta=999, fecha="2026-08-15"))

    assert caf.rut_emisor == "76543210-9"
    assert caf.razon_social == "EMPRESA DE PRUEBA SPA"
    assert caf.tipo_dte == 39
    assert (caf.folio_desde, caf.folio_hasta) == (500, 999)
    assert caf.fecha_autorizacion == date(2026, 8, 15)
    assert caf.llave_ted_pem.startswith(b"-----BEGIN RSA PRIVATE KEY-----")


def test_el_nodo_caf_sale_byte_a_byte() -> None:
    """Va literal dentro del TED: reserializarlo invalidaría el timbre."""
    xml = caf_xml()
    caf = parsear_caf(xml)

    assert caf.nodo_caf in xml  # es un recorte del original, no una copia nueva
    assert caf.nodo_caf.startswith(b"<CAF version=")
    assert caf.nodo_caf.endswith(b"</CAF>")
    assert b"<RSASK>" not in caf.nodo_caf  # la llave privada NO viaja en el TED


def test_el_repr_no_filtra_la_llave_del_timbre() -> None:
    texto = repr(parsear_caf(caf_xml()))

    assert "PRIVATE KEY" not in texto
    assert "76543210-9" in texto


def test_xml_corrupto() -> None:
    with pytest.raises(CafInvalidoError):
        parsear_caf(b"<AUTORIZACION><CAF>esto no cierra")


def test_rango_invertido() -> None:
    with pytest.raises(CafInvalidoError, match="Rango inválido"):
        parsear_caf(caf_xml(desde=2000, hasta=1000))


def test_tipo_de_documento_desconocido() -> None:
    with pytest.raises(CafInvalidoError, match="Tipo de documento"):
        parsear_caf(caf_xml(tipo_dte=99))


def test_caf_con_llaves_que_no_corresponden() -> None:
    """Un CAF alterado produce timbres que el SII rechaza de a uno.

    Detectarlo al cargarlo cuesta una validación; detectarlo emitiendo cuesta
    un folio por intento.
    """
    from cryptography.hazmat.primitives.asymmetric import rsa

    otra = rsa.generate_private_key(public_exponent=65537, key_size=1024)

    with pytest.raises(CafInvalidoError, match="no corresponde"):
        parsear_caf(caf_xml(llave_publica_de=otra))


def test_normalizar_rut() -> None:
    assert normalizar_rut("76.543.210-9") == "76543210-9"
    assert normalizar_rut(" 12345678-k ") == "12345678-K"


# ----------------------------------------------------------------- guardar --


async def test_guardar_y_volver_a_abrir(emisor: uuid.UUID) -> None:
    """El CAF vuelve idéntico después de pasar cifrado por la base."""
    xml = caf_xml(desde=1000, hasta=1100)
    original = parsear_caf(xml)

    async with tenant_session(emisor) as s:
        fila = await guardar_caf(s, emisor, xml)
        caf_id = fila.id
        assert fila.tipo_dte == 33
        assert (fila.folio_desde, fila.folio_hasta) == (1000, 1100)
        # El puntero sin estrenar: el primer folio emitido será 1000, no 1.
        assert fila.ultimo_folio_usado == 999
        assert fila.estado == EstadoCAF.ACTIVO
        assert fila.fecha_autorizacion == date(2026, 9, 1)
        # Nada del archivo queda en claro en la fila.
        assert b"RSASK" not in fila.xml_cifrado

    async with tenant_session(emisor) as s:
        recuperado = await abrir_caf(s, caf_id, emisor)

    assert recuperado.nodo_caf == original.nodo_caf
    assert recuperado.llave_ted_pem == original.llave_ted_pem


async def test_caf_de_otro_emisor_se_rechaza(emisor: uuid.UUID) -> None:
    """Emitir con folios de otra empresa, firmados en su nombre. Nunca."""
    async with tenant_session(emisor) as s:
        with pytest.raises(CafDeOtroEmisorError, match="11111111-1"):
            await guardar_caf(s, emisor, caf_xml(rut="11111111-1"))


async def test_el_rut_con_puntos_igual_calza(emisor: uuid.UUID) -> None:
    """El mismo RUT escrito distinto no puede parecer otro emisor."""
    async with tenant_session(emisor) as s:
        fila = await guardar_caf(s, emisor, caf_xml(rut="76.543.210-9"))
        assert fila.folio_desde == 1000


async def test_rango_solapado_se_rechaza(emisor: uuid.UUID) -> None:
    """Dos CAF cruzados permitirían emitir dos veces el mismo folio."""
    async with tenant_session(emisor) as s:
        await guardar_caf(s, emisor, caf_xml(desde=1000, hasta=1100))

    async with tenant_session(emisor) as s:
        with pytest.raises(RangoSolapadoError):
            await guardar_caf(s, emisor, caf_xml(desde=1050, hasta=1200))


async def test_subir_el_mismo_caf_dos_veces_se_rechaza(emisor: uuid.UUID) -> None:
    """El caso real del solapamiento: doble clic en la pantalla de carga."""
    xml = caf_xml()
    async with tenant_session(emisor) as s:
        await guardar_caf(s, emisor, xml)

    async with tenant_session(emisor) as s:
        with pytest.raises(RangoSolapadoError):
            await guardar_caf(s, emisor, xml)


async def test_rangos_contiguos_conviven(emisor: uuid.UUID) -> None:
    """1000-1100 y 1101-1200 no se cruzan: los dos entran."""
    async with tenant_session(emisor) as s:
        await guardar_caf(s, emisor, caf_xml(desde=1000, hasta=1100))
    async with tenant_session(emisor) as s:
        await guardar_caf(s, emisor, caf_xml(desde=1101, hasta=1200))

    async with tenant_session(emisor) as s:
        assert len((await s.execute(select(CAF))).scalars().all()) == 2


async def test_el_solapamiento_es_por_tipo_de_documento(emisor: uuid.UUID) -> None:
    """Cada tipo de DTE tiene su propia numeración: 33 y 39 no se pisan."""
    async with tenant_session(emisor) as s:
        await guardar_caf(s, emisor, caf_xml(tipo_dte=33, desde=1, hasta=100))
    async with tenant_session(emisor) as s:
        await guardar_caf(s, emisor, caf_xml(tipo_dte=39, desde=1, hasta=100))

    async with tenant_session(emisor) as s:
        assert len((await s.execute(select(CAF))).scalars().all()) == 2


async def test_la_carga_queda_auditada(emisor: uuid.UUID) -> None:
    async with tenant_session(emisor) as s:
        await guardar_caf(s, emisor, caf_xml(), subido_por="ana@empresa.cl")

    async with tenant_session(emisor) as s:
        fila = (await s.execute(select(AuditLog))).scalar_one()

    assert fila.operacion == "CARGA_CAF"
    assert fila.resultado == "OK"
    assert fila.actor == "ana@empresa.cl"
    assert fila.detalle["folios"] == 101


async def test_vencimiento_solo_si_lo_pasan(emisor: uuid.UUID) -> None:
    """El CAF no trae fecha de expiración; no se inventa."""
    async with tenant_session(emisor) as s:
        sin = await guardar_caf(s, emisor, caf_xml(desde=1, hasta=10))
        assert sin.fecha_vencimiento is None

    async with tenant_session(emisor) as s:
        con = await guardar_caf(
            s, emisor, caf_xml(desde=11, hasta=20), fecha_vencimiento=date(2027, 3, 1)
        )
        assert con.fecha_vencimiento == date(2027, 3, 1)


# -------------------------------------------------------- con la emisión ----


async def test_el_caf_cargado_entrega_su_primer_folio(emisor: uuid.UUID) -> None:
    """Extremo a extremo: cargar el CAF y que la emisión use su rango real."""
    async with tenant_session(emisor) as s:
        await guardar_caf(s, emisor, caf_xml(desde=3000, hasta=3002))

    folios = []
    for i in range(3):
        async with tenant_session(emisor) as s:
            doc, _ = await emitir_documento(
                s,
                emisor,
                DatosEmision(
                    external_id=f"venta-{i}",
                    tipo_dte=33,
                    fecha_emision=date(2026, 9, 23),
                    payload={"n": i},
                ),
            )
            folios.append(doc.folio)

    assert folios == [3000, 3001, 3002]

    async with tenant_session(emisor) as s:
        caf = (await s.execute(select(CAF))).scalar_one()
        assert caf.estado == EstadoCAF.AGOTADO
