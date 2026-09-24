"""Tickets de 57/80 mm desde el XML firmado de dte-torn, con el timbre en PDF417."""

from datetime import date
from types import SimpleNamespace

import httpx
import pytest
import zxingcpp
from pdf417gen import render_image

from app.routers.sales import _impreso_dte
from app.services import dte_client, dte_impreso

# TED de relleno del largo de uno real (~1 KB con el CAF adentro): lo que se
# prueba es que el código de barras devuelva estos bytes exactos.
TED = (b'<TED version="1.0"><DD><RE>76543210-3</RE><TD>33</TD><F>7</F><FE>2026-09-23</FE>'
       + b"<CAF>" + b"X" * 900 + b"</CAF></DD><FRMT algoritmo=\"SHA1withRSA\">abc==</FRMT></TED>")

XML = (b'<?xml version="1.0" encoding="ISO-8859-1"?>'
       b'<DTE xmlns="http://www.sii.cl/SiiDte" version="1.0"><Documento ID="F7T33"><Encabezado>'
       b'<IdDoc><TipoDTE>33</TipoDTE><Folio>7</Folio><FchEmis>2026-09-23</FchEmis></IdDoc>'
       b'<Emisor><RUTEmisor>76543210-3</RUTEmisor><RznSoc>EMPRESA DE PRUEBA SPA</RznSoc>'
       b'<GiroEmis>COMERCIO</GiroEmis><DirOrigen>CALLE 1</DirOrigen><CmnaOrigen>CONCEPCION</CmnaOrigen></Emisor>'
       b'<Receptor><RUTRecep>12345678-5</RUTRecep><RznSocRecep>CLIENTE LTDA</RznSocRecep>'
       b'<GiroRecep>SERVICIOS</GiroRecep><DirRecep>CALLE 2</DirRecep><CmnaRecep>TALCAHUANO</CmnaRecep></Receptor>'
       b'<Totales><MntNeto>20000</MntNeto><TasaIVA>19</TasaIVA><IVA>3800</IVA><MntTotal>23800</MntTotal></Totales>'
       b'</Encabezado><Detalle><NroLinDet>1</NroLinDet><NmbItem>Caj\xf3n</NmbItem><QtyItem>2</QtyItem>'
       b'<PrcItem>10000</PrcItem><MontoItem>20000</MontoItem></Detalle>'
       + TED + b'</Documento></DTE>')

TENANT = SimpleNamespace(id=1, dte_tenant_id=None, sii_oficina="S.I.I. - CONCEPCION",
                         sii_resolucion_numero=80, sii_resolucion_fecha=date(2014, 8, 22))
VENTA = SimpleNamespace(tipo_dte=33, folio=7)


def test_leer_dte_toma_los_datos_y_el_ted_del_xml():
    doc = dte_impreso.leer_dte(XML)
    assert (doc["tipo"], doc["folio"]) == (33, 7)
    assert doc["emisor"]["RznSoc"] == "EMPRESA DE PRUEBA SPA"
    assert doc["lineas"][0]["NmbItem"] == "Cajón"   # latin-1 bien decodificado
    assert doc["totales"]["MntTotal"] == "23800"
    assert doc["ted"] == TED


@pytest.mark.parametrize("papel", [57, 80])
def test_el_pdf417_devuelve_el_ted_firmado(papel):
    leido = zxingcpp.read_barcode(render_image(dte_impreso.codigos_timbre(TED, papel), scale=3))
    assert leido is not None and leido.bytes == TED


@pytest.fixture
def dte_torn(monkeypatch):
    """dte-torn falso: responde el listado, el XML y el PDF de la factura 7."""
    def request(method, path, tenant=None, actor=None, params=None, **kwargs):
        if path == "/documents":
            docs = [{"tipo_dte": 33, "folio": 7, "external_id": "venta-7"}]
            return httpx.Response(200, json=[d for d in docs if d["folio"] == params["folio"]])
        if path.endswith("/xml"):
            return httpx.Response(200, content=XML)
        assert params == {"con_cedible": "true"}
        return httpx.Response(200, content=b"%PDF-1.4", headers={"content-disposition": "inline"})
    monkeypatch.setattr(dte_client, "request", request)


def test_ticket_de_factura_trae_copia_cliente_y_cedible(dte_torn):
    html = _impreso_dte(TENANT, VENTA, 57, cedible=False).body.decode()
    for esperado in ("FACTURA ELECTRÓNICA", "N° 7", "76.543.210-3", "S.I.I. - CONCEPCION",
                     "$23.800", "Res. N° 80 de 2014", "size: 57mm auto", "COPIA CLIENTE"):
        assert esperado in html, esperado
    assert html.count("<svg") == 2
    assert html.count('<section class="copia">') == 2   # una página por copia: el driver corta entre ellas
    assert "CORTE AQUÍ" not in html
    assert html.count('height="30mm"') == 2        # mismo alto de timbre en ambas copias
    assert html.count("ACUSE DE RECIBO") == 1
    assert html.count("Factureando.cl: Hazla simple!") == 2


def test_solo_cedible(dte_torn):
    html = _impreso_dte(TENANT, VENTA, 80, cedible=True).body.decode()
    assert html.count("<svg") == 1 and "ACUSE DE RECIBO" in html and "COPIA CLIENTE" not in html


def test_carta_es_el_pdf_de_dte_torn(dte_torn):
    resp = _impreso_dte(TENANT, VENTA, None, cedible=False)
    assert resp.media_type == "application/pdf"
    assert resp.body.startswith(b"%PDF")


def test_venta_que_dte_torn_no_tiene_usa_la_plantilla_antigua(dte_torn):
    assert _impreso_dte(TENANT, SimpleNamespace(tipo_dte=33, folio=8), 80, cedible=False) is None
