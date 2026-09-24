"""Set de pruebas del SII: lectura, armado de los casos y validación.

El texto de abajo replica el formato exacto del archivo del SII (latin-1,
columnas separadas por tabulaciones), con el contenido del set básico real y el
número de atención cambiado.

Los totales esperados están calculados **a mano**, no con el código que se
prueba: si `calcular_totales` tuviera un error, compararlo consigo mismo no lo
mostraría.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

import pytest
from lxml import etree

from app.core.certificados import parsear_pfx
from app.dte.builder import (
    NS,
    DatosDocumento,
    DescuentoGlobal,
    Emisor,
    Item,
    Receptor,
    calcular_totales,
    construir_dte,
)
from app.dte.caf import parsear_caf
from app.dte.set_pruebas import (
    ANULA,
    CORRIGE_MONTOS,
    CORRIGE_TEXTO,
    SetInvalidoError,
    armar_documento,
    folios_necesarios,
    parsear_set,
    resolver_lineas,
)
from app.dte.signer import firmar_dte
from tests.factories import CLAVE_PFX, caf_xml, pfx

T = "\t"
SET_BASICO = "\r\n".join(
    [
        "INDICACIONES GENERALES:",
        "",
        "Se debe adjuntar ejemplar tributario y cedible de los documentos: Factura Electrónica.",
        "",
        "SET BASICO - NUMERO DE ATENCION: 1234567",
        "",
        "IMPORTANTE: Considerar que los descuentos por línea o globales deben ser indicados.",
        "",
        "",
        "CASO 1234567-1",
        "==============",
        f"DOCUMENTO{T}FACTURA ELECTRONICA",
        "",
        f"ITEM{T}{T}{T}CANTIDAD{T}PRECIO UNITARIO",
        f"Cajón AFECTO{T}{T}    140{T}{T}   1850",
        f"Relleno AFECTO{T}{T}     59{T}{T}   3041",
        "",
        "",
        "CASO 1234567-2",
        "==============",
        f"DOCUMENTO{T}FACTURA ELECTRONICA",
        "",
        f"ITEM{T}{T}{T}CANTIDAD{T}PRECIO UNITARIO{T}{T}DESCUENTO ITEM",
        f"Pañuelo AFECTO{T}{T}    424{T}{T}   3352{T}{T}{T}      6%",
        f"ITEM 2 AFECTO{T}{T}    357{T}{T}   2412{T}{T}{T}     12%",
        "",
        "",
        "CASO 1234567-3",
        "==============",
        f"DOCUMENTO{T}FACTURA ELECTRONICA",
        "",
        f"ITEM{T}{T}{T}CANTIDAD{T}PRECIO UNITARIO",
        f"Pintura B&W AFECTO{T}     32{T}{T}   3844",
        f"ITEM 2 AFECTO{T}{T}    180{T}{T}   3266",
        f"ITEM 3 SERVICIO EXENTO{T}      1{T}{T}  34917",
        "",
        "",
        "CASO 1234567-4",
        "==============",
        f"DOCUMENTO{T}FACTURA ELECTRONICA",
        "",
        f"ITEM{T}{T}{T}CANTIDAD{T}PRECIO UNITARIO",
        f"ITEM 1 AFECTO{T}{T}    201{T}{T}   3206",
        f"ITEM 2 AFECTO{T}{T}     86{T}{T}   3500",
        f"ITEM 3 SERVICIO EXENTO{T}      2{T}{T}   6791",
        "",
        f"DESCUENTO GLOBAL ITEMES AFECTOS{T}{T}     12%",
        "",
        "",
        "CASO 1234567-5",
        "==============",
        f"DOCUMENTO{T}{T}NOTA DE CREDITO ELECTRONICA",
        f"REFERENCIA{T}{T}FACTURA ELECTRONICA CORRESPONDIENTE A CASO 1234567-1",
        f"RAZON REFERENCIA{T}CORRIGE GIRO DEL RECEPTOR",
        "",
        "",
        "CASO 1234567-6",
        "==============",
        f"DOCUMENTO{T}{T}NOTA DE CREDITO ELECTRONICA",
        f"REFERENCIA{T}{T}FACTURA  ELECTRONICA CORRESPONDIENTE A CASO 1234567-2",
        f"RAZON REFERENCIA{T}DEVOLUCION DE MERCADERIAS",
        "",
        f"ITEM{T}{T}{T}CANTIDAD",
        f"Pañuelo AFECTO{T}{T}    156",
        f"ITEM 2 AFECTO{T}{T}    242",
        "",
        "",
        "CASO 1234567-7",
        "==============",
        f"DOCUMENTO{T}{T}NOTA DE CREDITO ELECTRONICA",
        f"REFERENCIA{T}{T}FACTURA ELECTRONICA CORRESPONDIENTE A CASO 1234567-3",
        f"RAZON REFERENCIA{T}ANULA FACTURA",
        "",
        "",
        "CASO 1234567-8",
        "==============",
        f"DOCUMENTO{T}{T}NOTA DE DEBITO ELECTRONICA",
        f"REFERENCIA{T}{T}NOTA DE CREDITO ELECTRONICA CORRESPONDIENTE A CASO 1234567-5",
        f"RAZON REFERENCIA{T}ANULA NOTA DE CREDITO ELECTRONICA",
        "",
    ]
)

#: (neto, exento, iva, total), calculados a mano. Ver el detalle en cada test.
ESPERADOS = {
    "1234567-1": (438419, 0, 83300, 521719),
    "1234567-2": (2093727, 0, 397808, 2491535),
    "1234567-3": (710888, 34917, 135069, 880874),
    "1234567-4": (831957, 13582, 158072, 1003611),
    "1234567-5": (0, 0, 0, 0),
    "1234567-6": (1005197, 0, 190987, 1196184),
    "1234567-7": (710888, 34917, 135069, 880874),
    "1234567-8": (0, 0, 0, 0),
}

RECEPTOR = Receptor(
    rut="60803000-K",
    razon_social="Servicio de Impuestos Internos",
    giro="Gobierno",
    direccion="Teatinos 120",
    comuna="Santiago",
)
FECHA = date(2026, 9, 23)


def _documentos():
    """Arma los 8 casos con folios ficticios, en orden, como lo hará el envío."""
    set_ = parsear_set(SET_BASICO)
    resueltos = resolver_lineas(set_)
    folios: dict[str, tuple[int, int]] = {}
    docs: dict[str, DatosDocumento] = {}
    siguiente = {33: 100, 61: 200, 56: 300}
    for caso in set_.casos:
        lineas, global_pct = resueltos[caso.id]
        docs[caso.id] = armar_documento(set_, caso, lineas, global_pct, RECEPTOR, FECHA, folios)
        folios[caso.id] = (caso.tipo_dte, siguiente[caso.tipo_dte])
        siguiente[caso.tipo_dte] += 1
    return set_, docs, folios


# ----------------------------------------------------------------- lectura --


def test_lee_los_ocho_casos() -> None:
    set_ = parsear_set(SET_BASICO)

    assert set_.numero_atencion == "1234567"
    assert [c.tipo_dte for c in set_.casos] == [33, 33, 33, 33, 61, 61, 61, 56]
    assert folios_necesarios(set_) == {33: 4, 61: 3, 56: 1}


def test_lee_lineas_descuentos_y_exentos() -> None:
    set_ = parsear_set(SET_BASICO)

    caso2 = set_.caso("1234567-2")
    assert [(l.nombre, l.cantidad, l.precio, l.descuento_pct) for l in caso2.lineas] == [
        ("Pañuelo AFECTO", 424, 3352, 6),
        ("ITEM 2 AFECTO", 357, 2412, 12),
    ]
    caso3 = set_.caso("1234567-3")
    assert caso3.lineas[0].nombre == "Pintura B&W AFECTO"
    assert [l.exento for l in caso3.lineas] == [False, False, True]
    assert set_.caso("1234567-4").descuento_global_pct == 12


def test_deduce_el_codigo_de_referencia() -> None:
    set_ = parsear_set(SET_BASICO)

    assert set_.caso("1234567-5").codigo_referencia == CORRIGE_TEXTO  # corrige giro
    assert set_.caso("1234567-6").codigo_referencia == CORRIGE_MONTOS  # devolución
    assert set_.caso("1234567-7").codigo_referencia == ANULA
    assert set_.caso("1234567-8").codigo_referencia == ANULA
    assert set_.caso("1234567-8").referencia == "1234567-5"


def test_la_devolucion_toma_precio_y_descuento_de_la_factura() -> None:
    """El set solo trae las cantidades devueltas: lo demás sale del caso 2."""
    lineas, _ = resolver_lineas(parsear_set(SET_BASICO))["1234567-6"]
    assert [(l.nombre, l.cantidad, l.precio, l.descuento_pct) for l in lineas] == [
        ("Pañuelo AFECTO", 156, 3352, 6),
        ("ITEM 2 AFECTO", 242, 2412, 12),
    ]


def test_anular_copia_el_documento_completo() -> None:
    resueltos = resolver_lineas(parsear_set(SET_BASICO))
    assert [l.nombre for l in resueltos["1234567-7"][0]] == [l.nombre for l in resueltos["1234567-3"][0]]
    # La nota de débito anula la nota del caso 5, que no tiene montos.
    assert [l.precio for l in resueltos["1234567-8"][0]] == [0]


def test_set_sin_numero_de_atencion() -> None:
    with pytest.raises(SetInvalidoError):
        parsear_set("CASO 1-1\nDOCUMENTO\tFACTURA ELECTRONICA\n")


def test_documento_no_soportado() -> None:
    texto = SET_BASICO.replace("NOTA DE DEBITO ELECTRONICA\r\nREF", "GUIA DE DESPACHO ELECTRONICA\r\nREF")
    with pytest.raises(SetInvalidoError, match="no soportado"):
        parsear_set(texto)


def test_archivo_con_varios_sets_lee_solo_el_pedido() -> None:
    # Así llega cuando se piden varios sets: el de guías trae un documento que
    # el set básico no soporta, y no debe leerse.
    separador = "-" * 80 + "\r\n"
    guias = (
        "SET GUIA DE DESPACHO - NUMERO DE ATENCIÓN: 7654321\r\n\r\n"
        "CASO 7654321-1\r\n==============\r\nDOCUMENTO\tGUIA DE DESPACHO\r\n"
    )
    texto = SET_BASICO + separador + guias
    set_ = parsear_set(texto)
    assert set_.numero_atencion == parsear_set(SET_BASICO).numero_atencion
    assert len(set_.casos) == 8
    with pytest.raises(SetInvalidoError, match="no trae"):
        parsear_set(texto, "SET FACTURA EXENTA")


# ------------------------------------------------------------------ montos --


@pytest.mark.parametrize("caso", ESPERADOS)
def test_totales_calculados_a_mano(caso: str) -> None:
    """Caso 2: 424×3352=1.421.248, 6%=85.274,88→85.275 → 1.335.973;
    357×2412=861.084, 12%=103.330,08→103.330 → 757.754; neto 2.093.727;
    IVA 397.808,13→397.808. Caso 4: afectos 945.406, 12%=113.448,72→113.449,
    neto 831.957, IVA 158.071,83→158.072, exento 13.582. Caso 6: 156×3352
    −6% = 491.537; 242×2412 −12% = 513.660; neto 1.005.197."""
    _, docs, _ = _documentos()
    d = docs[caso]
    t = calcular_totales(d.tipo_dte, d.items, d.descuentos_globales)
    assert (t.neto, t.exento, t.iva, t.total) == ESPERADOS[caso]


# ------------------------------------------------------------- referencias --


def test_todo_caso_referencia_al_set() -> None:
    _, docs, _ = _documentos()
    for caso, d in docs.items():
        assert d.referencias[0].tipo_doc == "SET"
        assert d.referencias[0].razon == f"CASO {caso}"


def test_las_notas_referencian_el_folio_del_caso() -> None:
    _, docs, folios = _documentos()

    nc = docs["1234567-6"].referencias[1]
    assert (nc.tipo_doc, nc.folio, nc.codigo) == ("33", str(folios["1234567-2"][1]), CORRIGE_MONTOS)
    nd = docs["1234567-8"].referencias[1]
    assert (nd.tipo_doc, nd.folio, nd.codigo) == ("61", str(folios["1234567-5"][1]), ANULA)


def test_una_nota_no_se_arma_antes_que_su_factura() -> None:
    set_ = parsear_set(SET_BASICO)
    resueltos = resolver_lineas(set_)
    caso = set_.caso("1234567-5")
    with pytest.raises(SetInvalidoError, match="primero hay que emitir"):
        armar_documento(set_, caso, *resueltos[caso.id], RECEPTOR, FECHA, folios={})


# ----------------------------------------------------------------- esquema --

XSD = Path(__file__).resolve().parent.parent / "app" / "dte" / "xsd" / "dte" / "DTE_v10.xsd"
EMISOR = Emisor(
    rut="76543210-3", razon_social="Empresa de Prueba SpA", giro="Comercio",
    acteco="464903", direccion="Calle 1", comuna="Concepcion",
)


@lru_cache(maxsize=1)
def _cert():
    return parsear_pfx(pfx(rut="11111111-1"), CLAVE_PFX)


@lru_cache(maxsize=4)
def _caf(tipo: int):
    return parsear_caf(caf_xml(rut="76543210-3", tipo_dte=tipo, desde=1, hasta=1000))


@pytest.fixture(scope="module")
def esquema() -> etree.XMLSchema:
    return etree.XMLSchema(etree.parse(str(XSD)))


@pytest.mark.parametrize("caso", ESPERADOS)
def test_cada_caso_firmado_cumple_el_esquema(caso: str, esquema) -> None:
    _, docs, folios = _documentos()
    d = docs[caso]
    folio = folios[caso][1]
    firmado = firmar_dte(
        construir_dte(EMISOR, d, folio), _caf(d.tipo_dte), _cert(),
        datetime(2026, 9, 23, 13, tzinfo=timezone.utc),
    )
    arbol = etree.fromstring(firmado.xml)
    assert esquema.validate(arbol), "\n".join(str(e) for e in esquema.error_log)

    # El total del XML es el calculado a mano.
    assert arbol.findtext(".//{%s}MntTotal" % NS) == str(ESPERADOS[caso][3])


def test_descuentos_en_el_xml() -> None:
    """Descuento por línea (Pct + Monto) y global (DscRcgGlobal), en su lugar."""
    _, docs, folios = _documentos()
    dte = construir_dte(EMISOR, docs["1234567-2"], 100)
    detalle = dte.find(f".//{{{NS}}}Detalle")
    hijos = [etree.QName(h).localname for h in detalle]
    assert hijos[hijos.index("PrcItem"):] == ["PrcItem", "DescuentoPct", "DescuentoMonto", "MontoItem"]
    assert detalle.findtext(f"{{{NS}}}DescuentoMonto") == "85275"

    dte4 = construir_dte(EMISOR, docs["1234567-4"], 101)
    doc = dte4.find(f"{{{NS}}}Documento")
    orden = [etree.QName(h).localname for h in doc]
    assert orden.index("DscRcgGlobal") > max(i for i, n in enumerate(orden) if n == "Detalle")
    assert orden.index("DscRcgGlobal") < orden.index("Referencia")
    assert doc.findtext(f"{{{NS}}}DscRcgGlobal/{{{NS}}}ValorDR") == "12"


def test_descuento_en_pesos_y_porcentaje_a_la_vez_se_rechaza() -> None:
    with pytest.raises(ValueError, match="no ambos"):
        Item(nombre="X", precio=Decimal(100), descuento=10, descuento_pct=Decimal(5))


def test_descuento_global_sobre_exentos() -> None:
    t = calcular_totales(
        33,
        [Item(nombre="A", precio=Decimal(1000)), Item(nombre="B", precio=Decimal(1000), exento=True)],
        [DescuentoGlobal(valor=Decimal(10), exento=True)],
    )
    assert (t.neto, t.exento, t.iva) == (1000, 900, 190)


def test_el_sobre_del_set_cumple_el_esquema_de_envio() -> None:
    """Los 8 casos (facturas, notas de crédito y débito) en un solo EnvioDTE."""
    from app.dte.signer import firmar_sobre, verificar_sobre

    _, docs, folios = _documentos()
    momento = datetime(2026, 9, 23, 13, tzinfo=timezone.utc)
    firmados = [
        firmar_dte(construir_dte(EMISOR, d, folios[caso][1]), _caf(d.tipo_dte), _cert(), momento)
        for caso, d in docs.items()
    ]
    sobre = firmar_sobre(
        firmados, canal="DTE", rut_emisor="76543210-3", rut_envia="11111111-1",
        fecha_resolucion="2020-11-30", numero_resolucion=0, cert=_cert(), momento=momento,
    )
    arbol = etree.fromstring(sobre)
    esquema = etree.XMLSchema(etree.parse(str(XSD.parent / "EnvioDTE_v10.xsd")))
    assert esquema.validate(arbol), "\n".join(str(e) for e in esquema.error_log)
    verificar_sobre(arbol, _cert().cert_pem)

    subtotales = {
        int(s.findtext(f"{{{NS}}}TpoDTE")): int(s.findtext(f"{{{NS}}}NroDTE"))
        for s in arbol.iter(f"{{{NS}}}SubTotDTE")
    }
    assert subtotales == {33: 4, 56: 1, 61: 3}


# --------------------------------------------------------- factura exenta --

SET_EXENTA = "\r\n".join(
    [
        "SET FACTURA EXENTA - NUMERO DE ATENCIÓN: 7654321",
        "INDICACIÓN: No se debe señalar el monto IVA 19% en los documentos de Factura No Afecta o Exenta.",
        "CASO 7654321-1",
        "==============",
        f"DOCUMENTO{T}FACTURA NO AFECTA O EXENTA ELECTRONICA",
        f"ITEM{T}{T}{T}CANTIDAD{T}UNIDAD MEDIDA{T}VALOR UNITARIO",
        f"HORAS PROGRAMADOR{T}     10{T}{T}Hora{T}{T}   5968",
        "CASO 7654321-2",
        "==============",
        f"DOCUMENTO{T}{T}NOTA DE CREDITO ELECTRONICA",
        f"REFERENCIA{T}{T}FACTURA NO AFECTA O EXENTA ELECTRONICA CORRESPONDIENTE A CASO 7654321-1",
        f"RAZON REFERENCIA{T}MODIFICA MONTO",
        f"ITEM{T}{T}{T}VALOR UNITARIO",
        f"HORAS PROGRAMADOR {T}    746",
        "CASO 7654321-3",
        "==============",
        f"DOCUMENTO{T}FACTURA NO AFECTA O EXENTA ELECTRONICA",
        f"ITEM{T}{T}{T}{T}{T}CANTIDAD{T}VALOR UNITARIO",
        f"SERV CONSULTORIA FACT ELECTRONICA{T}1{T}{T} 318672",
        f"SERV CONSULTORIA GUIA DESPACHO ELECT{T}1{T}{T} 246793",
        "CASO 7654321-4",
        "==============",
        f"DOCUMENTO{T}{T}NOTA DE CREDITO ELECTRONICA",
        f"REFERENCIA{T}{T}FACTURA NO AFECTA O EXENTA ELECTRONICA CORRESPONDIENTE A CASO 7654321-3",
        f"RAZON REFERENCIA{T}CORRIGE GIRO",
        "CASO 7654321-5",
        "==============",
        f"DOCUMENTO{T}{T}NOTA DE DEBITO ELECTRONICA",
        f"REFERENCIA{T}{T}NOTA DE CREDITO ELECTRONICA CORRESPONDIENTE A CASO 7654321-4",
        f"RAZON REFERENCIA{T}ANULA NOTA DE CREDITO ELECTRONICA",
        "CASO 7654321-6",
        "==============",
        f"DOCUMENTO{T}FACTURA NO AFECTA O EXENTA ELECTRONICA",
        f"ITEM{T}{T}{T}{T}CANTIDAD{T}VALOR UNITARIO",
        f"CAPACITACION USO CIGUEÑALES{T}1{T}{T} 332530",
        f"CAPACITACION USO PLC's CNC{T}1{T}{T} 223896",
        "CASO 7654321-7",
        "==============",
        f"DOCUMENTO{T}{T}NOTA DE CREDITO ELECTRONICA",
        f"REFERENCIA{T}{T}FACTURA NO AFECTA O EXENTA ELECTRONICA CORRESPONDIENTE A CASO 7654321-6",
        f"RAZON REFERENCIA{T}MODIFICA MONTO",
        f"ITEM{T}{T}{T}{T}VALOR UNITARIO",
        f"CAPACITACION USO CIGUEÑALES{T} 166265",
        "CASO 7654321-8",
        "==============",
        f"DOCUMENTO{T}{T}NOTA DE DEBITO ELECTRONICA",
        f"REFERENCIA{T}{T}FACTURA NO AFECTA O EXENTA ELECTRONICA CORRESPONDIENTE A CASO 7654321-6",
        f"RAZON REFERENCIA{T}MODIFICA MONTO",
        f"ITEM{T}{T}{T}{T}VALOR UNITARIO",
        f"CAPACITACION USO PLC's CNC{T}  44779",
    ]
)

#: (exento, total) a mano. Caso 1: 10×5.968 = 59.680. Caso 2: la cantidad (10)
#: sale del caso 1, 10×746 = 7.460. Caso 3: 318.672+246.793 = 565.465. Casos 4
#: y 5: corrección de giro y su anulación, sin montos. Caso 6: 332.530+223.896
#: = 556.426. Casos 7 y 8: cantidad 1 del caso 6.
ESPERADOS_EXENTA = {
    "7654321-1": (59680, 59680),
    "7654321-2": (7460, 7460),
    "7654321-3": (565465, 565465),
    "7654321-4": (0, 0),
    "7654321-5": (0, 0),
    "7654321-6": (556426, 556426),
    "7654321-7": (166265, 166265),
    "7654321-8": (44779, 44779),
}


def _documentos_exenta():
    set_ = parsear_set(SET_EXENTA, "SET FACTURA EXENTA")
    resueltos = resolver_lineas(set_)
    folios: dict[str, tuple[int, int]] = {}
    docs: dict[str, DatosDocumento] = {}
    siguiente = {34: 100, 61: 200, 56: 300}
    for caso in set_.casos:
        docs[caso.id] = armar_documento(set_, caso, *resueltos[caso.id], RECEPTOR, FECHA, folios)
        folios[caso.id] = (caso.tipo_dte, siguiente[caso.tipo_dte])
        siguiente[caso.tipo_dte] += 1
    return docs, folios


def test_exenta_lee_los_ocho_casos() -> None:
    set_ = parsear_set(SET_EXENTA, "SET FACTURA EXENTA")
    assert set_.numero_atencion == "7654321"
    assert folios_necesarios(set_) == {34: 3, 61: 3, 56: 2}
    linea = set_.caso("7654321-1").lineas[0]
    assert (linea.nombre, linea.cantidad, linea.unidad, linea.precio) == ("HORAS PROGRAMADOR", 10, "Hora", 5968)
    assert set_.caso("7654321-2").codigo_referencia == CORRIGE_MONTOS
    assert set_.caso("7654321-4").codigo_referencia == CORRIGE_TEXTO
    assert set_.caso("7654321-8").referencia == "7654321-6"


def test_exenta_modifica_monto_toma_la_cantidad_del_caso_referenciado() -> None:
    resueltos = resolver_lineas(parsear_set(SET_EXENTA, "SET FACTURA EXENTA"))
    [linea] = resueltos["7654321-2"][0]
    assert (linea.cantidad, linea.precio, linea.unidad, linea.exento) == (10, 746, "Hora", True)
    [linea] = resueltos["7654321-8"][0]
    assert (linea.nombre, linea.cantidad, linea.precio) == ("CAPACITACION USO PLC's CNC", 1, 44779)


@pytest.mark.parametrize("caso", ESPERADOS_EXENTA)
def test_exenta_totales_sin_iva(caso: str) -> None:
    docs, _ = _documentos_exenta()
    d = docs[caso]
    t = calcular_totales(d.tipo_dte, d.items, d.descuentos_globales)
    assert (t.neto, t.iva, t.tasa_iva) == (0, 0, None)
    assert (t.exento, t.total) == ESPERADOS_EXENTA[caso]


@pytest.mark.parametrize("caso", ESPERADOS_EXENTA)
def test_exenta_cumple_el_esquema_sin_iva(caso: str, esquema) -> None:
    docs, folios = _documentos_exenta()
    d = docs[caso]
    firmado = firmar_dte(
        construir_dte(EMISOR, d, folios[caso][1]), _caf(d.tipo_dte), _cert(),
        datetime(2026, 9, 23, 13, tzinfo=timezone.utc),
    )
    arbol = etree.fromstring(firmado.xml)
    assert esquema.validate(arbol), "\n".join(str(e) for e in esquema.error_log)
    totales = arbol.find(".//{%s}Totales" % NS)
    assert [etree.QName(h).localname for h in totales] == (
        ["MntExe", "MntTotal"] if ESPERADOS_EXENTA[caso][1] else ["MntTotal"]
    )
    assert totales.findtext("{%s}MntTotal" % NS) == str(ESPERADOS_EXENTA[caso][1])
