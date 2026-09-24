"""Construcción del XML del DTE (issue #14).

Estos tests fijan lo que se puede verificar sin el esquema oficial: montos,
orden de los elementos, codificación y reglas por tipo de documento. La
validación contra los XSD del SII va aparte, en `test_builder_xsd.py`.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from lxml import etree
from pydantic import ValidationError

from app.dte.builder import (
    NS,
    DatosDocumento,
    Emisor,
    Item,
    Receptor,
    Referencia,
    calcular_totales,
    construir_dte,
    serializar,
    texto_sii,
)
from app.dte.rut import validar_rut

N = {"s": NS}

EMISOR = Emisor(
    rut="76543210-3",
    razon_social="Empresa de Prueba SpA",
    giro="Venta al por menor",
    acteco="471100",
    direccion="Av. Siempre Viva 742",
    comuna="Santiago",
    ciudad="Santiago",
)

RECEPTOR = Receptor(
    rut="77777777-7",
    razon_social="Cliente Ltda",
    giro="Servicios",
    direccion="Calle Falsa 123",
    comuna="Providencia",
)


def _factura(items: list[Item], **extra) -> DatosDocumento:
    return DatosDocumento(
        tipo_dte=extra.pop("tipo_dte", 33),
        fecha_emision=date(2026, 9, 23),
        receptor=extra.pop("receptor", RECEPTOR),
        items=items,
        **extra,
    )


def _texto(arbol: etree._Element, ruta: str) -> str | None:
    nodo = arbol.find(ruta, N)
    return nodo.text if nodo is not None else None


def _hijos(arbol: etree._Element, ruta: str) -> list[str]:
    return [etree.QName(h).localname for h in arbol.find(ruta, N)]


# ----------------------------------------------------------------- montos ---


def test_factura_suma_iva_sobre_el_neto() -> None:
    t = calcular_totales(33, [Item(nombre="A", cantidad=2, precio=Decimal("5000"))])
    assert (t.neto, t.exento, t.iva, t.total) == (10000, 0, 1900, 11900)
    assert t.tasa_iva == Decimal("19")


def test_iva_redondea_al_peso_hacia_arriba_en_el_medio() -> None:
    """1.050 * 19% = 199,5 → 200. Redondeo comercial, como el backend."""
    t = calcular_totales(33, [Item(nombre="A", precio=Decimal("1050"))])
    assert t.iva == 200


def test_factura_con_lineas_afectas_y_exentas() -> None:
    t = calcular_totales(
        33,
        [
            Item(nombre="Afecto", precio=Decimal("10000")),
            Item(nombre="Exento", precio=Decimal("3000"), exento=True),
        ],
    )
    assert (t.neto, t.exento, t.iva, t.total) == (10000, 3000, 1900, 14900)


def test_factura_exenta_no_lleva_iva() -> None:
    t = calcular_totales(34, [Item(nombre="A", precio=Decimal("10000"))])
    assert (t.neto, t.exento, t.iva, t.total) == (0, 10000, 0, 10000)
    assert t.tasa_iva is None


def test_boleta_despeja_el_neto_del_precio_con_iva() -> None:
    """En boletas el precio ya trae IVA; neto + IVA tiene que cuadrar exacto."""
    t = calcular_totales(39, [Item(nombre="Pan", precio=Decimal("1190"))])
    assert (t.neto, t.iva, t.total) == (1000, 190, 1190)
    assert t.neto + t.iva == t.total


def test_boleta_con_total_que_no_divide_exacto() -> None:
    """990 / 1,19 = 831,93 → neto 832, IVA 158. La suma sigue siendo 990."""
    t = calcular_totales(39, [Item(nombre="Pan", precio=Decimal("990"))])
    assert (t.neto, t.iva, t.total) == (832, 158, 990)


def test_boleta_exenta() -> None:
    t = calcular_totales(41, [Item(nombre="Libro", precio=Decimal("15000"))])
    assert (t.neto, t.exento, t.iva, t.total) == (0, 15000, 0, 15000)


def test_cantidad_decimal_redondea_la_linea() -> None:
    """1,5 kg a $1.333 = 1.999,5 → 2.000."""
    t = calcular_totales(33, [Item(nombre="Queso", cantidad=Decimal("1.5"), precio=Decimal("1333"))])
    assert t.neto == 2000


def test_descuento_por_linea() -> None:
    t = calcular_totales(33, [Item(nombre="A", precio=Decimal("10000"), descuento=1000)])
    assert t.neto == 9000


def test_descuento_mayor_que_la_linea_se_rechaza() -> None:
    with pytest.raises(ValueError, match="supera"):
        calcular_totales(33, [Item(nombre="A", precio=Decimal("100"), descuento=200)])


# ------------------------------------------------------------- estructura ---


def test_factura_tiene_la_estructura_y_el_orden_del_esquema() -> None:
    """El esquema es xs:sequence: el orden importa tanto como el contenido."""
    dte = construir_dte(EMISOR, _factura([Item(nombre="A", precio=Decimal("5000"))]), 1000)

    assert dte.tag == f"{{{NS}}}DTE"
    assert dte.get("version") == "1.0"
    doc = dte.find("s:Documento", N)
    assert doc.get("ID") == "T33F1000"

    assert _hijos(dte, "s:Documento") == ["Encabezado", "Detalle"]
    assert _hijos(dte, "s:Documento/s:Encabezado") == ["IdDoc", "Emisor", "Receptor", "Totales"]
    assert _hijos(dte, ".//s:IdDoc") == ["TipoDTE", "Folio", "FchEmis"]
    assert _hijos(dte, ".//s:Emisor") == [
        "RUTEmisor", "RznSoc", "GiroEmis", "Acteco",
        "DirOrigen", "CmnaOrigen", "CiudadOrigen",
    ]
    assert _hijos(dte, ".//s:Receptor") == [
        "RUTRecep", "RznSocRecep", "GiroRecep", "DirRecep", "CmnaRecep",
    ]
    assert _hijos(dte, ".//s:Totales") == ["MntNeto", "TasaIVA", "IVA", "MntTotal"]
    assert _hijos(dte, ".//s:Detalle") == [
        "NroLinDet", "NmbItem", "QtyItem", "PrcItem", "MontoItem",
    ]

    assert _texto(dte, ".//s:Folio") == "1000"
    assert _texto(dte, ".//s:MntTotal") == "5950"


def test_la_boleta_usa_sus_propias_etiquetas() -> None:
    """Otro esquema: RznSocEmisor en vez de RznSoc, sin Acteco, con IndServicio."""
    datos = DatosDocumento(
        tipo_dte=39,
        fecha_emision=date(2026, 9, 23),
        items=[Item(nombre="Pan", precio=Decimal("1190"))],
    )
    dte = construir_dte(EMISOR, datos, 1)

    assert _hijos(dte, ".//s:IdDoc") == ["TipoDTE", "Folio", "FchEmis", "IndServicio"]
    assert _texto(dte, ".//s:IndServicio") == "3"
    emisor = _hijos(dte, ".//s:Emisor")
    assert "RznSocEmisor" in emisor and "GiroEmisor" in emisor
    assert "RznSoc" not in emisor and "Acteco" not in emisor
    assert _hijos(dte, ".//s:Totales") == ["MntNeto", "IVA", "MntTotal"]  # sin TasaIVA


def test_boleta_sin_receptor_va_a_consumidor_final() -> None:
    datos = DatosDocumento(
        tipo_dte=39, fecha_emision=date(2026, 9, 23), items=[Item(nombre="Pan", precio=Decimal("1000"))]
    )
    dte = construir_dte(EMISOR, datos, 1)
    assert _texto(dte, ".//s:RUTRecep") == "66666666-6"


def test_linea_exenta_en_factura_lleva_indexe() -> None:
    dte = construir_dte(
        EMISOR,
        _factura([Item(nombre="A", precio=Decimal("1000")), Item(nombre="B", precio=Decimal("500"), exento=True)]),
        1,
    )
    detalles = dte.findall(".//s:Detalle", N)
    assert detalles[0].find("s:IndExe", N) is None
    assert _texto(detalles[1], "s:IndExe") == "1"
    assert _hijos(dte, ".//s:Totales") == ["MntNeto", "MntExe", "TasaIVA", "IVA", "MntTotal"]


def test_factura_exenta_no_marca_cada_linea() -> None:
    dte = construir_dte(EMISOR, _factura([Item(nombre="A", precio=Decimal("1000"))], tipo_dte=34), 1)
    assert dte.find(".//s:IndExe", N) is None
    assert _hijos(dte, ".//s:Totales") == ["MntExe", "MntTotal"]


def test_nota_de_credito_con_referencia() -> None:
    datos = _factura(
        [Item(nombre="Devolución", precio=Decimal("5000"))],
        tipo_dte=61,
        referencias=[
            Referencia(tipo_doc="33", folio="1000", fecha=date(2026, 9, 20), codigo=1, razon="Anula factura")
        ],
    )
    dte = construir_dte(EMISOR, datos, 1)

    assert _hijos(dte, "s:Documento") == ["Encabezado", "Detalle", "Referencia"]
    assert _hijos(dte, ".//s:Referencia") == [
        "NroLinRef", "TpoDocRef", "FolioRef", "FchRef", "CodRef", "RazonRef",
    ]


def test_cantidades_y_precios_sin_notacion_cientifica() -> None:
    dte = construir_dte(
        EMISOR, _factura([Item(nombre="A", cantidad=Decimal("1.500"), precio=Decimal("1000.00"))]), 1
    )
    assert _texto(dte, ".//s:QtyItem") == "1.5"
    assert _texto(dte, ".//s:PrcItem") == "1000"


def test_codigo_de_item() -> None:
    dte = construir_dte(EMISOR, _factura([Item(nombre="A", precio=Decimal("1"), codigo="SKU-1")]), 1)
    assert _texto(dte, ".//s:CdgItem/s:TpoCodigo") == "INT1"
    assert _texto(dte, ".//s:CdgItem/s:VlrCodigo") == "SKU-1"


# ----------------------------------------------------------- validaciones ---


def test_factura_sin_receptor_se_rechaza() -> None:
    with pytest.raises(ValidationError, match="requiere receptor"):
        _factura([Item(nombre="A", precio=Decimal("1"))], receptor=None)


def test_factura_con_receptor_incompleto_se_rechaza() -> None:
    incompleto = Receptor(rut="77777777-7", razon_social="Cliente")
    with pytest.raises(ValidationError, match="giro, direccion, comuna"):
        _factura([Item(nombre="A", precio=Decimal("1"))], receptor=incompleto)


def test_nota_de_credito_sin_referencia_se_rechaza() -> None:
    with pytest.raises(ValidationError, match="referencia"):
        _factura([Item(nombre="A", precio=Decimal("1"))], tipo_dte=61)


def test_rut_con_dv_incorrecto_se_rechaza_antes_de_gastar_folio() -> None:
    with pytest.raises(ValidationError, match="dígito verificador"):
        Receptor(rut="77777777-1", razon_social="X")


def test_tipo_no_soportado() -> None:
    with pytest.raises(ValidationError, match="no soportado"):
        _factura([Item(nombre="A", precio=Decimal("1"))], tipo_dte=46)


def test_emisor_sin_direccion_no_puede_facturar() -> None:
    sin_direccion = Emisor(rut="76543210-3", razon_social="X", giro="Y", acteco="471100")
    with pytest.raises(ValueError, match="dirección y comuna"):
        construir_dte(sin_direccion, _factura([Item(nombre="A", precio=Decimal("1"))]), 1)


def test_el_emisor_es_la_empresa_aunque_firme_una_persona() -> None:
    """El caso normal en Chile: RUT de empresa, certificado de su representante.

    El RUT del emisor del documento es el de la empresa. El de la persona que
    firma no aparece acá: va en `RutEnvia` del envío (#21). Si alguien agrega
    una validación que exija que sean iguales, este caso deja de funcionar.
    """
    empresa = Emisor(
        rut=validar_rut("76.543.210-3"),
        razon_social="Empresa Familiar SpA",
        giro="Comercio",
        acteco="471100",
        direccion="Calle 1",
        comuna="Santiago",
    )
    dte = construir_dte(empresa, _factura([Item(nombre="A", precio=Decimal("1000"))]), 1)
    assert _texto(dte, ".//s:RUTEmisor") == "76543210-3"


# ---------------------------------------------------------------- texto -----


def test_texto_sii_limpia_lo_que_latin1_no_tiene() -> None:
    assert texto_sii("Café “premium” — 500g", 80) == 'Café "premium" - 500g'
    assert texto_sii("Pizza 🍕 grande", 80) == "Pizza grande"
    assert texto_sii("Línea1\nLínea2\t fin", 80) == "Línea1 Línea2 fin"
    assert texto_sii("x" * 100, 80) == "x" * 80
    assert texto_sii("   ", 80) is None


def test_serializa_en_iso_8859_1_sin_referencias_numericas() -> None:
    """Ñ y tildes como un byte; nada de &#...; en la salida."""
    dte = construir_dte(
        EMISOR,
        _factura([Item(nombre="Ñandú “especial” — 🦤", precio=Decimal("1000"))]),
        1,
    )
    salida = serializar(dte)

    assert salida.startswith(b'<?xml version="1.0" encoding="ISO-8859-1"?>')
    assert "Ñandú".encode("latin-1") in salida
    assert b"&#" not in salida


def test_caracteres_especiales_de_xml_se_escapan() -> None:
    """Un & en la razón social tiene que viajar escapado y volver intacto."""
    receptor = Receptor(
        rut="77777777-7",
        razon_social="Pérez & Hijos <Ltda>",
        giro="Comercio",
        direccion="Calle 1",
        comuna="Santiago",
    )
    salida = serializar(construir_dte(EMISOR, _factura([Item(nombre="A", precio=Decimal("1"))], receptor=receptor), 1))

    assert b"P\xe9rez &amp; Hijos &lt;Ltda&gt;" in salida
    releido = etree.fromstring(salida)
    assert _texto(releido, ".//s:RznSocRecep") == "Pérez & Hijos <Ltda>"


def test_linea_sin_precio_omite_prcitem() -> None:
    """El esquema del SII exige PrcItem > 0: un regalo a $0 no puede llevarlo."""
    dte = construir_dte(EMISOR, _factura([Item(nombre="Regalo", precio=Decimal("0"))]), 1)
    detalle = dte.find(".//s:Detalle", N)
    assert detalle.find("s:PrcItem", N) is None
    assert _texto(detalle, "s:MontoItem") == "0"


# ------------------------------------------------------ guía de despacho ---


def test_guia_lleva_traslado_y_despacho_en_su_lugar() -> None:
    """Orden del XSD: FchEmis, IndNoRebaja, TipoDespacho, IndTraslado."""
    guia = _factura(
        [Item(nombre="ITEM 1", cantidad=145, precio=Decimal("3363"))],
        tipo_dte=52, ind_traslado=1, tipo_despacho=2,
    )
    dte = construir_dte(EMISOR, guia, 1)
    assert _hijos(dte, ".//s:IdDoc") == ["TipoDTE", "Folio", "FchEmis", "TipoDespacho", "IndTraslado"]
    assert (_texto(dte, ".//s:TipoDespacho"), _texto(dte, ".//s:IndTraslado")) == ("2", "1")


def test_guia_de_traslado_interno_sin_precios() -> None:
    guia = _factura(
        [Item(nombre="ITEM 1", cantidad=61, precio=0), Item(nombre="ITEM 2", cantidad=73, precio=0)],
        tipo_dte=52, ind_traslado=5,
    )
    dte = construir_dte(EMISOR, guia, 1)
    assert _hijos(dte, ".//s:Totales") == ["MntTotal"]
    assert _texto(dte, ".//s:MntTotal") == "0"
    assert dte.find(".//s:PrcItem", N) is None
    assert _texto(dte, ".//s:TipoDespacho") is None


def test_guia_sin_tipo_de_traslado_se_rechaza() -> None:
    with pytest.raises(ValidationError, match="IndTraslado"):
        _factura([Item(nombre="A", precio=Decimal(1))], tipo_dte=52)


def test_traslado_fuera_de_una_guia_se_rechaza() -> None:
    with pytest.raises(ValidationError, match="guías"):
        _factura([Item(nombre="A", precio=Decimal(1))], ind_traslado=1)
