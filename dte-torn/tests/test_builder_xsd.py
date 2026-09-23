"""Validación del XML construido contra los esquemas oficiales del SII.

Los XSD están en `app/dte/xsd/`, tal como los publica el SII (`schema_dte.zip`
y `schema_envio_bol.zip`). Validar contra ellos es la única forma de saber que
la estructura es correcta sin mandarle nada al SII.

El esquema exige `<TED>`, `<TmstFirma>` y `<ds:Signature>`, que produce el
firmador (#20). Mientras no exista, `_completar` les pone relleno con la forma
correcta: lo que se está validando acá es todo lo demás.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
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
    serializar,
)
from app.dte.caf import parsear_caf
from tests.factories import caf_xml

XSD = Path(__file__).resolve().parent.parent / "app" / "dte" / "xsd"
DS = "http://www.w3.org/2000/09/xmldsig#"
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


def _completar(dte: etree._Element) -> etree._Element:
    """Agrega TED, TmstFirma y Signature de relleno, con la forma del esquema.

    El TED se arma como texto y el `<CAF>` se inserta **literal**, igual que lo
    hará el firmador: al quedar dentro del namespace por defecto del `<DTE>`, sus
    elementos pasan a ser del namespace del SII. Reconstruirlo nodo por nodo lo
    dejaría fuera del namespace (con `xmlns=""`) y el esquema lo rechazaría.
    """
    doc = dte.find("s:Documento", N)
    t = lambda ruta: doc.findtext(ruta, namespaces=N)  # noqa: E731
    caf = parsear_caf(caf_xml(rut=t(".//s:RUTEmisor"), tipo_dte=int(t(".//s:TipoDTE"))))

    ted = (
        f'<TED xmlns="{NS}" version="1.0"><DD>'
        f"<RE>{t('.//s:RUTEmisor')}</RE>"
        f"<TD>{t('.//s:TipoDTE')}</TD>"
        f"<F>{t('.//s:Folio')}</F>"
        f"<FE>{t('.//s:FchEmis')}</FE>"
        f"<RR>{t('.//s:RUTRecep')}</RR>"
        f"<RSR>{(t('.//s:RznSocRecep') or 'CONSUMIDOR FINAL')[:40]}</RSR>"
        f"<MNT>{t('.//s:MntTotal')}</MNT>"
        f"<IT1>{t('.//s:NmbItem')[:40]}</IT1>"
    ).encode("latin-1")
    ted += caf.nodo_caf
    ted += b'<TSTED>2026-09-23T10:00:00</TSTED></DD><FRMT algoritmo="SHA1withRSA">AAAA</FRMT></TED>'
    # Sin declaración, lxml asume UTF-8 y una "ó" en latin-1 revienta el parseo.
    # Es la misma trampa que tendrá el firmador al armar el TED.
    doc.append(etree.fromstring(b'<?xml version="1.0" encoding="ISO-8859-1"?>' + ted))

    tmst = etree.SubElement(doc, f"{{{NS}}}TmstFirma")
    tmst.text = "2026-09-23T10:00:00"

    firma = etree.fromstring(
        f"""<Signature xmlns="{DS}"><SignedInfo>
<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
<Reference URI="#{doc.get('ID')}"><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
<DigestValue>AAAA</DigestValue></Reference></SignedInfo>
<SignatureValue>AAAA</SignatureValue>
<KeyInfo><KeyValue><RSAKeyValue><Modulus>AAAA</Modulus><Exponent>AQAB</Exponent></RSAKeyValue></KeyValue>
<X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo></Signature>"""
    )
    dte.append(firma)
    return dte


def _validar(esquema: etree.XMLSchema, dte: etree._Element) -> None:
    """Valida después de serializar y releer, que es lo que verá el SII."""
    arbol = etree.fromstring(serializar(_completar(dte)))
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
    folio = dte.find(".//s:Folio", N)
    folio.getparent().remove(folio)

    assert not esquema_dte.validate(etree.fromstring(serializar(dte)))
