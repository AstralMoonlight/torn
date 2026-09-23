"""Validación del XML construido contra los esquemas oficiales del SII.

Los XSD están en `app/dte/xsd/`, tal como los publica el SII (`schema_dte.zip`
y `schema_envio_bol.zip`). Validar contra ellos es la única forma de saber que
la estructura es correcta sin mandarle nada al SII.

Se valida el DTE **completo**: construido por `builder.py` y timbrado y
firmado por `signer.py`, tal como sale hacia el SII.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

import pytest
from lxml import etree

from app.dte.builder import (
    NS,
    DatosDocumento,
    Emisor,
    Item,
    Receptor,
    Referencia,
    construir_dte,
)
from app.core.certificados import parsear_pfx
from app.dte.caf import parsear_caf
from app.dte.signer import firmar_dte
from tests.factories import CLAVE_PFX, caf_xml, pfx

XSD = Path(__file__).resolve().parent.parent / "app" / "dte" / "xsd"
N = {"s": NS}

EMISOR = Emisor(
    rut="76543210-3",
    razon_social="Empresa de Prueba SpA",
    giro="Venta al por menor",
    acteco="471100",
    direccion="Av. Siempre Viva 742",
    comuna="Santiago",
    ciudad="Santiago",
    telefono="+56 2 2345 6789",
    correo="facturas@empresa.cl",
)
RECEPTOR = Receptor(
    rut="77777777-7",
    razon_social="Cliente Ltda",
    giro="Servicios",
    direccion="Calle Falsa 123",
    comuna="Providencia",
    ciudad="Santiago",
    correo="pagos@cliente.cl",
)
HOY = date(2026, 9, 23)


@pytest.fixture(scope="module")
def esquema_dte() -> etree.XMLSchema:
    return etree.XMLSchema(etree.parse(str(XSD / "dte" / "DTE_v10.xsd")))


@pytest.fixture(scope="module")
def esquema_boleta(tmp_path_factory: pytest.TempPathFactory) -> etree.XMLSchema:
    """El XSD de boletas solo declara `EnvioBOLETA` como elemento global.

    Para validar una boleta suelta se envuelve el tipo `BOLETADefType` en un
    elemento `DTE` global, incluyendo el esquema oficial sin tocarlo.
    """
    carpeta = tmp_path_factory.mktemp("xsd")

    # Defecto del esquema oficial: `DescuentoPct` y `RecargoPct` restringen
    # `PctType` con mínimo 0.00, pero `PctType` ya tiene mínimo 0.01. Una
    # restricción no puede ampliar el rango de su tipo base, así que libxml2
    # (correctamente) se niega a compilar el esquema. Se corrige en una copia:
    # el archivo del SII queda intacto en el repositorio.
    original = (XSD / "boleta" / "EnvioBOLETA_v11.xsd").read_bytes()
    assert original.count(b'<xs:minInclusive value="0.00"/>') == 2, (
        "El SII cambió el esquema de boletas; revisar si el defecto sigue ahí"
    )
    (carpeta / "EnvioBOLETA_v11.xsd").write_bytes(
        original.replace(b'<xs:minInclusive value="0.00"/>', b'<xs:minInclusive value="0.01"/>')
    )
    (carpeta / "xmldsignature_v10.xsd").write_bytes(
        (XSD / "boleta" / "xmldsignature_v10.xsd").read_bytes()
    )

    envoltorio = carpeta / "boleta_suelta.xsd"
    oficial = (carpeta / "EnvioBOLETA_v11.xsd").as_uri()
    envoltorio.write_text(
        f"""<?xml version="1.0" encoding="UTF-8"?>
<xs:schema targetNamespace="{NS}" xmlns:SiiDte="{NS}"
           xmlns:xs="http://www.w3.org/2001/XMLSchema"
           elementFormDefault="qualified" attributeFormDefault="unqualified">
  <xs:include schemaLocation="{oficial}"/>
  <xs:element name="DTE" type="SiiDte:BOLETADefType"/>
</xs:schema>
""",
        encoding="utf-8",
    )
    return etree.XMLSchema(etree.parse(str(envoltorio)))


@lru_cache(maxsize=1)
def _cert():
    return parsear_pfx(pfx(rut="11111111-1"), CLAVE_PFX)


def _completar(dte: etree._Element) -> etree._Element:
    """Timbra y firma con el firmador real, para validar el DTE completo.

    Valida lo mismo que el SII: timbre, `TmstFirma` y firma incluidos. Devuelve
    el árbol releído desde los bytes firmados, que es lo que se guarda y se envía.
    """
    rut = dte.findtext(".//s:RUTEmisor", namespaces=N)
    tipo = int(dte.findtext(".//s:TipoDTE", namespaces=N))
    caf = parsear_caf(caf_xml(rut=rut, tipo_dte=tipo, desde=1, hasta=5000))
    firmado = firmar_dte(dte, caf, _cert(), datetime(2026, 9, 23, 13, 0, tzinfo=timezone.utc))
    return etree.fromstring(firmado.xml)


def _validar(esquema: etree.XMLSchema, dte: etree._Element) -> None:
    """Valida el DTE firmado, releído desde sus bytes: lo que verá el SII."""
    arbol = _completar(dte)
    if not esquema.validate(arbol):
        errores = "\n".join(f"  línea {e.line}: {e.message}" for e in esquema.error_log)
        pytest.fail(f"El XML no cumple el esquema del SII:\n{errores}")


def _item(**kw) -> Item:
    return Item(**{"nombre": "Producto de prueba", "precio": Decimal("10000"), **kw})


FACTURAS = {
    "33 simple": DatosDocumento(tipo_dte=33, fecha_emision=HOY, receptor=RECEPTOR, items=[_item()]),
    "33 completa": DatosDocumento(
        tipo_dte=33,
        fecha_emision=HOY,
        receptor=RECEPTOR,
        forma_pago=2,
        fecha_vencimiento=date(2026, 10, 23),
        items=[
            _item(codigo="SKU-001", unidad="UN", descripcion="Descripción larga, con ñ"),
            _item(nombre="Queso", cantidad=Decimal("1.5"), precio=Decimal("1333"), unidad="KG"),
            _item(nombre="Con descuento", descuento=500),
            _item(nombre="Exento", exento=True),
        ],
    ),
    "34 exenta": DatosDocumento(tipo_dte=34, fecha_emision=HOY, receptor=RECEPTOR, items=[_item()]),
    "56 nota de débito": DatosDocumento(
        tipo_dte=56,
        fecha_emision=HOY,
        receptor=RECEPTOR,
        items=[_item(nombre="Intereses")],
        referencias=[Referencia(tipo_doc="33", folio="1000", fecha=HOY, codigo=3, razon="Corrige monto")],
    ),
    "61 nota de crédito": DatosDocumento(
        tipo_dte=61,
        fecha_emision=HOY,
        receptor=RECEPTOR,
        items=[_item(nombre="Devolución")],
        referencias=[Referencia(tipo_doc="33", folio="1000", fecha=HOY, codigo=1, razon="Anula")],
    ),
    "33 caso de certificación": DatosDocumento(
        tipo_dte=33,
        fecha_emision=HOY,
        receptor=RECEPTOR,
        items=[_item()],
        referencias=[Referencia(tipo_doc="SET", folio="1", fecha=HOY, razon="CASO 4012345-1")],
    ),
}

BOLETAS = {
    "39 consumidor final": DatosDocumento(
        tipo_dte=39, fecha_emision=HOY, items=[_item(precio=Decimal("1190"))]
    ),
    "39 con receptor": DatosDocumento(
        tipo_dte=39,
        fecha_emision=HOY,
        receptor=Receptor(rut="77777777-7", razon_social="Cliente", direccion="Calle 1", comuna="Santiago"),
        items=[_item(precio=Decimal("990")), _item(nombre="Exento", exento=True)],
    ),
    "41 exenta": DatosDocumento(tipo_dte=41, fecha_emision=HOY, items=[_item()]),
}


@pytest.mark.parametrize("caso", FACTURAS)
def test_factura_cumple_el_esquema(caso: str, esquema_dte: etree.XMLSchema) -> None:
    _validar(esquema_dte, construir_dte(EMISOR, FACTURAS[caso], 1000))


@pytest.mark.parametrize("caso", BOLETAS)
def test_boleta_cumple_el_esquema(caso: str, esquema_boleta: etree.XMLSchema) -> None:
    _validar(esquema_boleta, construir_dte(EMISOR, BOLETAS[caso], 1000))


def test_el_esquema_si_detecta_errores(esquema_dte: etree.XMLSchema) -> None:
    """Control del control: un documento roto tiene que fallar.

    Sin esto, un esquema mal cargado que acepta cualquier cosa haría pasar
    todos los tests de arriba sin probar nada.
    """
    dte = _completar(construir_dte(EMISOR, FACTURAS["33 simple"], 1000))
    assert esquema_dte.validate(dte)
    folio = dte.find(".//s:Folio", N)
    folio.getparent().remove(folio)

    assert not esquema_dte.validate(dte)
