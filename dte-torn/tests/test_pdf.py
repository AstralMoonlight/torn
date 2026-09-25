"""Representación impresa: el PDF se arma del XML firmado y el timbre se lee.

El test que más importa es `test_el_pdf417_devuelve_el_ted_firmado`: lee el
código de barras con un lector real y comprueba que trae exactamente el `<TED>`
del documento. Un timbre que no se lee o que no calza con el XML invalida la
representación impresa ante el SII.
"""

from __future__ import annotations

import base64
import re
import zlib
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import zxingcpp
from pdf417gen import render_image

from app.core.certificados import parsear_pfx
from app.dte.builder import DatosDocumento, DescuentoGlobal, Emisor, Item, Receptor, Referencia, construir_dte
from app.dte.caf import parsear_caf
from app.dte.pdf import (
    DatosImpresion,
    codigos_timbre,
    fecha,
    formatear_rut,
    generar_pdf,
    leer_dte,
    numero,
    pesos,
)
from app.dte.signer import firmar_dte
from tests.factories import CLAVE_PFX, caf_xml, pfx

MOMENTO = datetime(2026, 9, 23, 13, 30, tzinfo=timezone.utc)
EMISOR = Emisor(
    rut="76543210-3", razon_social="Empresa de Prueba SpA", giro="Venta al por menor",
    acteco="471100", direccion="Av. Siempre Viva 742", comuna="Concepción", ciudad="Concepción",
)
RECEPTOR = Receptor(
    rut="77777777-7", razon_social="Pérez & Hijos Ltda", giro="Comercio",
    direccion="Calle 1", comuna="Providencia",
)
IMPRESION = DatosImpresion(resolucion_numero=0, resolucion_fecha=date(2020, 11, 30), oficina_sii="S.I.I. - Concepcion")


@pytest.fixture(scope="module")
def cert():
    return parsear_pfx(pfx(rut="11111111-1"), CLAVE_PFX)


def _firmado(cert, tipo: int = 33, **kw):
    datos = DatosDocumento(
        tipo_dte=tipo,
        fecha_emision=date(2026, 9, 23),
        receptor=kw.pop("receptor", RECEPTOR if tipo not in (39, 41) else None),
        items=kw.pop("items", [Item(nombre="Ñandú de peluche", cantidad=Decimal("2"), precio=Decimal("10000"))]),
        **kw,
    )
    caf = parsear_caf(caf_xml(rut=EMISOR.rut, tipo_dte=tipo, desde=1, hasta=100))
    return firmar_dte(construir_dte(EMISOR, datos, 7), caf, cert, MOMENTO)


def _texto_pdf(pdf: bytes) -> bytes:
    """Contenido de las páginas, descomprimido, para buscar lo que se escribió."""
    # reportlab escribe cada flujo en ASCII85 sobre Flate.
    return b"".join(
        zlib.decompress(base64.a85decode(flujo.strip().removesuffix(b"~>")))
        for flujo in re.findall(rb"/ASCII85Decode /FlateDecode \].*?stream\r?\n(.*?)endstream", pdf, re.S)
    )


def test_formatos_chilenos() -> None:
    assert pesos(1234567) == "$ 1.234.567"
    assert numero("1234.50") == "1.234,5"
    assert numero("10") == "10"
    assert formatear_rut("76543210-3") == "76.543.210-3"
    assert fecha("2026-09-23") == "23-09-2026"


def test_el_pdf417_devuelve_el_ted_firmado(cert) -> None:
    firmado = _firmado(cert)
    ted = leer_dte(firmado.xml).ted
    assert ted == firmado.ted  # recortado del XML, byte a byte

    imagen = render_image(codigos_timbre(ted), scale=3)
    leido = zxingcpp.read_barcode(imagen)
    assert leido is not None and leido.format == zxingcpp.BarcodeFormat.PDF417
    assert leido.bytes == ted


def test_factura(cert) -> None:
    pdf = generar_pdf(_firmado(cert).xml, IMPRESION)
    assert pdf.startswith(b"%PDF")
    texto = _texto_pdf(pdf)
    for esperado in (b"FACTURA ELECTRONICA", b"N\\260 7", b"R.U.T.: 76.543.210-3", b"S.I.I. - CONCEPCION",
                     b"$ 23.800", b"Timbre Electr\\363nico SII", b"Res. N\\260 0 de 2020", rb"Se\361or\(es\)"):
        assert esperado in texto, esperado
    assert b"CEDIBLE" not in texto


def test_copia_cedible(cert) -> None:
    texto = _texto_pdf(generar_pdf(_firmado(cert).xml, DatosImpresion(0, date(2020, 11, 30), cedible=True)))
    assert b"CEDIBLE" in texto
    assert b"Ley 19.983" in texto


def test_con_cedible_trae_copia_cliente_y_cedible(cert) -> None:
    pdf = generar_pdf(_firmado(cert).xml, DatosImpresion(0, date(2020, 11, 30), con_cedible=True))
    assert len(re.findall(rb"/Type /Page\b(?!s)", pdf)) == 2
    texto = _texto_pdf(pdf)
    assert texto.count(b"Timbre Electr\\363nico SII") == 2
    assert texto.count(b"CEDIBLE") == 1
    assert texto.count(b"Factureando.cl: Hazla simple!") == 2


def test_una_nota_de_credito_no_es_cedible(cert) -> None:
    nota = _firmado(
        cert, 61,
        referencias=[Referencia(tipo_doc="33", folio="5", fecha=date(2026, 9, 23), codigo=1, razon="Anula")],
    )
    texto = _texto_pdf(generar_pdf(nota.xml, DatosImpresion(0, date(2020, 11, 30), cedible=True)))
    assert b"NOTA DE CREDITO" in texto
    assert b"CEDIBLE" not in texto
    assert b"Anula documento" in texto


def test_boleta_sin_receptor(cert) -> None:
    texto = _texto_pdf(generar_pdf(_firmado(cert, 39).xml, IMPRESION))
    assert b"BOLETA ELECTRONICA" in texto
    assert rb"Se\361or\(es\)" not in texto
    assert b"IVA incluido" in texto


def test_sesenta_lineas_pasan_a_otra_pagina(cert) -> None:
    items = [Item(nombre=f"Producto {n} con un nombre largo para ocupar espacio", precio=Decimal("1000")) for n in range(60)]
    firmado = _firmado(cert, items=items, descuentos_globales=[DescuentoGlobal(valor=Decimal("10"), glosa="Promo")])
    pdf = generar_pdf(firmado.xml, IMPRESION)
    assert b"/Count 2" in pdf
    texto = _texto_pdf(pdf)
    assert b"continuaci\\363n" in texto
    assert rb"Descuento global \(Promo\): 10%" in texto  # los paréntesis van escapados


# ------------------------------------------------------- guía de despacho --


def _paginas(pdf: bytes) -> int:
    return len(re.findall(rb"/Type /Page\b(?!s)", pdf))


def test_guia_de_venta_trae_tipo_de_traslado_y_copia_cedible(cert) -> None:
    xml = _firmado(cert, 52, ind_traslado=1, tipo_despacho=2).xml
    pdf = generar_pdf(xml, DatosImpresion(0, date(2020, 11, 30), con_cedible=True))
    assert _paginas(pdf) == 2
    texto = _texto_pdf(pdf)
    assert b"GUIA DE DESPACHO" in texto
    assert texto.count(b"Operaci\\363n constituye venta") == 2
    assert b"Por cuenta del emisor a instalaciones del cliente" in texto
    # La guía se cede junto con su factura: así lo dice su copia cedible.
    assert b"CEDIBLE CON SU FACTURA" in texto


def test_guia_de_traslado_interno_no_tiene_cedible(cert) -> None:
    """Una operación que no es venta no se cede: el ejemplar cedible es inoficioso."""
    receptor = Receptor(rut=EMISOR.rut, razon_social=EMISOR.razon_social, giro=EMISOR.giro,
                        direccion=EMISOR.direccion, comuna=EMISOR.comuna)
    xml = _firmado(cert, 52, ind_traslado=5, receptor=receptor,
                   items=[Item(nombre="ITEM 1", cantidad=Decimal(61), precio=Decimal(0))]).xml
    pdf = generar_pdf(xml, DatosImpresion(0, date(2020, 11, 30), con_cedible=True))
    assert _paginas(pdf) == 1
    texto = _texto_pdf(pdf)
    assert b"Traslado interno" in texto
    assert b"CEDIBLE" not in texto
    ted = leer_dte(xml).ted
    assert zxingcpp.read_barcode(render_image(codigos_timbre(ted), scale=3)).bytes == ted


def test_razon_social_larga_no_se_corta(cert) -> None:
    receptor = RECEPTOR.model_copy(update={"razon_social": "FUNDACION EDUCACIONAL SANTA MAGDALENA SOFIA BARAT"})
    texto = _texto_pdf(generar_pdf(_firmado(cert, receptor=receptor).xml, IMPRESION))
    assert b"SOFIA BARAT" in texto
