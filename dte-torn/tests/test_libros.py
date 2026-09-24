"""Libros electrónicos: compra/venta y guías, contra los XSD oficiales del SII.

Los montos esperados están calculados **a mano** (ver cada docstring), no con
el código que se prueba.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from functools import lru_cache

import pytest
from lxml import etree

from app.core.certificados import parsear_pfx
from app.dte.builder import NS
from app.dte.libros import (
    COMPRA,
    GUIA_ANULADA,
    VENTA,
    Caratula,
    DetalleCV,
    DetalleGuia,
    construir_libro_cv,
    construir_libro_guias,
    firmar_libro,
    verificar_libro,
)
from app.dte.set_pruebas import SetInvalidoError, detalles_libro_compras, parsear_libro_compras
from app.dte.signer import FirmaInvalidaError
from tests.factories import CLAVE_PFX, pfx, xsd_libros_parcheado

T = "\t"
N = {"s": NS}
MOMENTO = datetime(2026, 9, 24, 13, tzinfo=timezone.utc)
FECHA = date(2026, 9, 24)

#: Replica el formato del archivo del SII, con el número de atención cambiado.
SET_COMPRAS = "\r\n".join(
    [
        "SET LIBRO DE COMPRAS - NUMERO DE ATENCION: 7777777",
        " ",
        "==========================================================================",
        f"TIPO DOCUMENTO{T}{T}{T}{T}FOLIO",
        "OBSERVACIONES",
        f"MONTO EXENTO{T}MONTO AFECTO",
        "==========================================================================",
        f"FACTURA{T}{T}{T}{T}{T}234",
        "FACTURA DEL GIRO CON DERECHO A CREDITO",
        f"{T}{T}  59827",
        "",
        f"FACTURA ELECTRONICA {T}{T}{T} 32",
        "FACTURA DEL GIRO CON DERECHO A CREDITO",
        f"  11001{T}{T}  12491",
        "",
        f"FACTURA{T}{T}{T}{T}{T}781",
        "FACTURA CON IVA USO COMUN",
        f"{T}{T}  30250",
        "",
        f"NOTA DE CREDITO{T}{T}{T}{T}451",
        "NOTA DE CREDITO POR DESCUENTO A FACTURA 234",
        f"{T}{T}   2971",
        "",
        f"FACTURA ELECTRONICA{T}{T}{T} 67",
        "ENTREGA GRATUITA DEL PROVEEDOR",
        f"{T}{T}  12569",
        "",
        f"FACTURA DE COMPRA ELECTRONICA{T}{T}  9",
        "COMPRA CON RETENCION TOTAL DEL IVA",
        f"{T}{T}  10849",
        "",
        f"NOTA DE CREDITO{T}{T}{T}{T}211",
        "NOTA DE CREDITO POR DESCUENTO FACTURA ELECTRONICA 32",
        f"{T}{T}   9997",
        "==========================================================================",
        "",
        "OBSERVACIONES GENERALES",
        "-----------------------",
        "EN FACTURA CON IVA USO COMUN CONSIDERE QUE EL FACTOR DE PROPORCIONALIDAD ",
        "DEL IVA ES DE 0.60",
    ]
)

def _caratula(**cambios) -> Caratula:
    datos = dict(
        rut_emisor="76543210-3", rut_envia="11111111-1", periodo="2026-09",
        fecha_resolucion=date(2020, 11, 30), numero_resolucion=0, folio_notificacion=1,
    )
    return Caratula(**{**datos, **cambios})


@lru_cache(maxsize=1)
def _cert():
    return parsear_pfx(pfx(rut="11111111-1"), CLAVE_PFX)


@pytest.fixture(scope="module")
def esquemas(tmp_path_factory) -> dict[str, etree.XMLSchema]:
    carpeta = xsd_libros_parcheado(tmp_path_factory.mktemp("libros"))
    return {
        nombre: etree.XMLSchema(etree.parse(str(carpeta / f"{nombre}_v10.xsd")))
        for nombre in ("LibroCV", "LibroGuia")
    }


def _validar(esquema: etree.XMLSchema, xml: bytes) -> etree._Element:
    arbol = etree.fromstring(xml)
    assert esquema.validate(arbol), "\n".join(f"línea {e.line}: {e.message}" for e in esquema.error_log)
    return arbol


def _totales(arbol: etree._Element) -> dict[int, dict[str, str]]:
    """Resumen del período como {TpoDoc: {campo: valor}} (solo campos simples)."""
    return {
        int(t.findtext("s:TpoDoc", namespaces=N)): {
            etree.QName(h).localname: h.text for h in t if h.text and h.text.strip()
        }
        for t in arbol.iterfind(".//s:TotalesPeriodo", N)
    }


# ---------------------------------------------------------- libro compras --


def test_lee_el_set_de_compras() -> None:
    set_ = parsear_libro_compras(SET_COMPRAS)
    assert set_.numero_atencion == "7777777"
    assert set_.factor_proporcionalidad == Decimal("0.60")
    assert [(d.tipo_doc, d.folio, d.exento, d.afecto) for d in set_.documentos] == [
        (30, 234, 0, 59827), (33, 32, 11001, 12491), (30, 781, 0, 30250), (60, 451, 0, 2971),
        (33, 67, 0, 12569), (46, 9, 0, 10849), (60, 211, 0, 9997),
    ]


def test_detalle_de_compras_a_mano() -> None:
    """IVA 19% redondeado al peso: 59.827→11.367,13; 12.491→2.373,29;
    30.250→5.747,5→5.748 (uso común); 2.971→564,49; 12.569→2.388,11 (no
    recuperable, entrega gratuita); 10.849→2.061,31 (retenido total, el total
    queda en el neto); 9.997→1.899,43."""
    detalles = detalles_libro_compras(parsear_libro_compras(SET_COMPRAS), FECHA)
    assert [(d.tipo_doc, d.neto, d.iva, d.iva_uso_comun, d.iva_no_recuperable, d.total) for d in detalles] == [
        (30, 59827, 11367, 0, None, 71194),
        (33, 12491, 2373, 0, None, 25865),
        (30, 30250, 0, 5748, None, 35998),
        (60, 2971, 564, 0, None, 3535),
        (33, 12569, 0, 0, (4, 2388), 14957),
        (46, 10849, 2061, 0, None, 10849),
        (60, 9997, 1899, 0, None, 11896),
    ]
    assert detalles[5].otros_impuestos == [(15, Decimal(19), 2061)]
    # Las notas de crédito son del mismo proveedor que la factura que corrigen.
    assert detalles[3].rut == detalles[0].rut
    assert detalles[6].rut == detalles[1].rut
    # Los documentos en papel llevan razón social; los electrónicos no la necesitan.
    assert detalles[0].razon_social and detalles[3].razon_social


def test_libro_de_compras_resumen_a_mano(esquemas) -> None:
    """Por tipo: 30 → neto 59.827+30.250 = 90.077, IVA 11.367, uso común 5.748,
    crédito 5.748×0,60 = 3.448,8 → 3.449, total 71.194+35.998 = 107.192.
    33 → exento 11.001, neto 12.491+12.569 = 25.060, IVA 2.373, no recuperable
    2.388, total 25.865+14.957 = 40.822. 60 → neto 12.968, IVA 2.463, total
    15.431. 46 → neto 10.849, IVA 2.061, retención 2.061, total 10.849."""
    set_ = parsear_libro_compras(SET_COMPRAS)
    libro = construir_libro_cv(
        _caratula(folio_notificacion=2), COMPRA, detalles_libro_compras(set_, FECHA), set_.factor_proporcionalidad
    )
    arbol = _validar(esquemas["LibroCV"], firmar_libro(libro, _cert(), MOMENTO))

    t = _totales(arbol)
    assert (t[30]["TotDoc"], t[30]["TotMntNeto"], t[30]["TotMntIVA"]) == ("2", "90077", "11367")
    assert (t[30]["TotIVAUsoComun"], t[30]["FctProp"], t[30]["TotCredIVAUsoComun"], t[30]["TotMntTotal"]) == (
        "5748", "0.60", "3449", "107192",
    )
    assert (t[33]["TotOpExe"], t[33]["TotMntExe"], t[33]["TotMntNeto"], t[33]["TotMntIVA"], t[33]["TotMntTotal"]) == (
        "1", "11001", "25060", "2373", "40822",
    )
    no_rec = arbol.find(".//s:TotalesPeriodo[s:TpoDoc='33']/s:TotIVANoRec", N)
    assert [h.text for h in no_rec] == ["4", "1", "2388"]
    assert (t[60]["TotDoc"], t[60]["TotMntNeto"], t[60]["TotMntIVA"], t[60]["TotMntTotal"]) == ("2", "12968", "2463", "15431")
    ret = arbol.find(".//s:TotalesPeriodo[s:TpoDoc='46']/s:TotOtrosImp", N)
    assert [h.text for h in ret] == ["15", "2061"]
    assert t[46]["TotMntTotal"] == "10849"

    caratula = arbol.find(".//s:Caratula", N)
    assert [caratula.findtext(f"s:{c}", namespaces=N) for c in ("TipoOperacion", "TipoLibro", "TipoEnvio", "FolioNotificacion")] == [
        "COMPRA", "ESPECIAL", "TOTAL", "2",
    ]


def test_set_de_compras_con_documento_desconocido() -> None:
    with pytest.raises(SetInvalidoError, match="documento"):
        parsear_libro_compras(SET_COMPRAS.replace("FACTURA DE COMPRA ELECTRONICA", "LIQUIDACION FACTURA"))


# ----------------------------------------------------------- libro ventas --


def _ventas() -> list[DetalleCV]:
    """Dos documentos del set básico de prueba: factura con exento y su anulación."""
    factura = dict(fecha=FECHA, rut="60803000-K", exento=34917, neto=710888, iva=135069, total=880874,
                   tasa_iva=Decimal(19))
    return [
        DetalleCV(tipo_doc=33, folio=100, **factura),
        DetalleCV(tipo_doc=61, folio=200, tipo_doc_ref=33, folio_ref=100, **factura),
        DetalleCV(tipo_doc=56, folio=300, fecha=FECHA, rut="60803000-K", total=0, tipo_doc_ref=61, folio_ref=200),
    ]


def test_libro_de_ventas(esquemas) -> None:
    libro = construir_libro_cv(_caratula(), VENTA, _ventas())
    arbol = _validar(esquemas["LibroCV"], firmar_libro(libro, _cert(), MOMENTO))
    t = _totales(arbol)
    assert (t[33]["TotDoc"], t[33]["TotMntExe"], t[33]["TotMntNeto"], t[33]["TotMntIVA"], t[33]["TotMntTotal"]) == (
        "1", "34917", "710888", "135069", "880874",
    )
    assert (t[56]["TotMntNeto"], t[56]["TotMntIVA"], t[56]["TotMntTotal"]) == ("0", "0", "0")
    assert "TotOpIVARec" not in t[33]  # solo compras
    nd = arbol.find(".//s:Detalle[s:TpoDoc='56']", N)
    assert nd.findtext("s:FolioDocRef", namespaces=N) == "200"
    # El SII exige los tres montos aunque sean cero (rechazo LBR - 3 si faltan).
    assert [nd.findtext(f"s:{m}", namespaces=N) for m in ("MntExe", "MntNeto", "MntIVA")] == ["0", "0", "0"]


def test_la_firma_del_libro_se_rompe_si_cambia_un_monto() -> None:
    xml = firmar_libro(construir_libro_cv(_caratula(), VENTA, _ventas()), _cert(), MOMENTO)
    verificar_libro(etree.fromstring(xml), _cert().cert_pem)
    with pytest.raises(FirmaInvalidaError):
        verificar_libro(etree.fromstring(xml.replace(b"880874", b"880875", 1)), _cert().cert_pem)


def test_uso_comun_sin_factor_se_rechaza() -> None:
    detalles = detalles_libro_compras(parsear_libro_compras(SET_COMPRAS), FECHA)
    with pytest.raises(ValueError, match="factor"):
        construir_libro_cv(_caratula(folio_notificacion=2), COMPRA, detalles)


# ------------------------------------------------------------ libro guías --


def _guias() -> list[DetalleGuia]:
    """Los 3 casos del set de guía: traslado interno, venta facturada y venta anulada."""
    comun = dict(fecha=FECHA, tasa_iva=Decimal(19))
    return [
        DetalleGuia(folio=1, rut="76543210-3", razon_social="Empresa de Prueba SpA", tipo_operacion=5, **comun),
        DetalleGuia(folio=2, rut="60803000-K", razon_social="Servicio de Impuestos Internos", tipo_operacion=1,
                    neto=790035, iva=150107, total=940142, factura=(33, 75, FECHA), **comun),
        DetalleGuia(folio=3, rut="60803000-K", razon_social="Servicio de Impuestos Internos", tipo_operacion=1,
                    neto=630920, iva=119875, total=750795, anulado=GUIA_ANULADA, **comun),
    ]


def test_libro_de_guias(esquemas) -> None:
    """Venta vigente: solo el caso 2 (940.142). El 3 cuenta como anulado y el 1
    como traslado no venta de tipo 5."""
    xml = firmar_libro(construir_libro_guias(_caratula(folio_notificacion=3), _guias()), _cert(), MOMENTO)
    arbol = _validar(esquemas["LibroGuia"], xml)

    resumen = arbol.find(".//s:ResumenPeriodo", N)
    assert [(etree.QName(h).localname, h.text) for h in resumen if len(h) == 0] == [
        ("TotGuiaAnulada", "1"), ("TotGuiaVenta", "1"), ("TotMntGuiaVta", "940142"),
    ]
    traslado = resumen.find("s:TotTraslado", N)
    assert [(etree.QName(h).localname, h.text) for h in traslado] == [("TpoTraslado", "5"), ("CantGuia", "1")]

    detalle = arbol.findall(".//s:Detalle", N)
    assert detalle[1].findtext("s:FolioDocRef", namespaces=N) == "75"
    assert detalle[2].findtext("s:Anulado", namespaces=N) == "2"
    assert detalle[0].find("s:MntNeto", N) is None
    verificar_libro(arbol, _cert().cert_pem)


def test_los_esquemas_si_detectan_errores(esquemas) -> None:
    """Control del control: sin TipoLibro (obligatorio en ambos) el libro no es válido."""
    for nombre, libro in (
        ("LibroCV", construir_libro_cv(_caratula(), VENTA, _ventas())),
        ("LibroGuia", construir_libro_guias(_caratula(), _guias())),
    ):
        arbol = etree.fromstring(firmar_libro(libro, _cert(), MOMENTO))
        assert esquemas[nombre].validate(arbol)
        folio = arbol.find(".//s:TipoLibro", N)
        folio.getparent().remove(folio)
        assert not esquemas[nombre].validate(arbol), nombre
