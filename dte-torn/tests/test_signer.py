"""Timbre y firma del DTE (issue #20).

El test que más importa es `test_la_firma_sobrevive_dentro_del_sobre`: firmar
un documento suelto y que la firma siga verificando cuando el documento ya está
dentro del `<EnvioDTE>`. Es la falla clásica de las implementaciones de DTE, y
su control negativo demuestra que no es teórica.
"""

from __future__ import annotations

import base64
import re
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from lxml import etree

from app.core.certificados import parsear_pfx
from app.dte import builder
from app.dte.builder import NS, DatosDocumento, Emisor, Item, Receptor, construir_dte
from app.dte.caf import parsear_caf
from app.dte.signer import (
    RSR_SIN_RECEPTOR,
    FirmaInvalidaError,
    firmar_dte,
    verificar_firma_dte,
)
from tests.factories import CLAVE_PFX, caf_xml, pfx

N = {"s": NS}
MOMENTO = datetime(2026, 9, 23, 13, 30, tzinfo=timezone.utc)  # 10:30 en Chile

EMISOR = Emisor(
    rut="76543210-3",
    razon_social="Empresa de Prueba SpA",
    giro="Venta al por menor",
    acteco="471100",
    direccion="Av. Siempre Viva 742",
    comuna="Santiago",
)
RECEPTOR = Receptor(
    rut="77777777-7",
    razon_social="Pérez & Hijos Ltda",
    giro="Comercio",
    direccion="Calle 1",
    comuna="Providencia",
)


@pytest.fixture(scope="module")
def cert():
    """Certificado de persona natural, como el de un representante legal."""
    return parsear_pfx(pfx(rut="11111111-1"), CLAVE_PFX)


@pytest.fixture(scope="module")
def caf33():
    return parsear_caf(caf_xml(rut="76543210-3", tipo_dte=33, desde=1000, hasta=1100))


@pytest.fixture(scope="module")
def caf39():
    return parsear_caf(caf_xml(rut="76543210-3", tipo_dte=39, desde=1, hasta=500))


def _factura(folio: int = 1000, **kw) -> etree._Element:
    datos = DatosDocumento(
        tipo_dte=33,
        fecha_emision=date(2026, 9, 23),
        receptor=kw.pop("receptor", RECEPTOR),
        items=kw.pop("items", [Item(nombre="Ñandú de peluche", precio=Decimal("10000"))]),
    )
    return construir_dte(EMISOR, datos, folio)


def _sobre(dte_firmado: bytes) -> etree._Element:
    """Mete el DTE en un `<EnvioDTE>` con los namespaces que usa el SII.

    El DTE se inserta como bytes, igual que se hará al armar el envío: el
    documento firmado no se vuelve a serializar nunca.
    """
    cuerpo = dte_firmado.split(b"?>", 1)[1].strip()
    sobre = (
        b'<?xml version="1.0" encoding="ISO-8859-1"?>\n'
        b'<EnvioDTE xmlns="http://www.sii.cl/SiiDte" '
        b'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        b'xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioDTE_v10.xsd" version="1.0">'
        b'<SetDTE ID="SetDoc">' + cuerpo + b"</SetDTE></EnvioDTE>"
    )
    return etree.fromstring(sobre)


# ------------------------------------------------------------------ firma ---


def test_firma_y_verifica(cert, caf33) -> None:
    firmado = firmar_dte(_factura(), caf33, cert, MOMENTO)

    verificar_firma_dte(etree.fromstring(firmado.xml), cert.cert_pem)
    assert (firmado.tipo_dte, firmado.folio) == (33, 1000)
    assert len(firmado.sha256) == 64


def test_la_firma_sobrevive_dentro_del_sobre(cert, caf33) -> None:
    """El C14N inclusivo arrastra los namespaces de los ancestros.

    El `<EnvioDTE>` declara `xsi`; si el DTE no lo declarara también, su forma
    canónica cambiaría al entrar al sobre y la firma dejaría de verificar.
    """
    firmado = firmar_dte(_factura(), caf33, cert, MOMENTO)
    sobre = _sobre(firmado.xml)

    verificar_firma_dte(sobre.find(".//s:DTE", N), cert.cert_pem)


def test_sin_xsi_en_el_dte_la_firma_se_rompe_en_el_sobre(cert, caf33, monkeypatch) -> None:
    """Control negativo: demuestra que el problema es real y no teórico.

    Si alguien "limpia" el namespace `xsi` del DTE porque no se usa, este test
    explica por qué estaba ahí.
    """
    monkeypatch.setattr(builder, "NSMAP_DTE", {None: NS})
    firmado = firmar_dte(_factura(), caf33, cert, MOMENTO)

    verificar_firma_dte(etree.fromstring(firmado.xml), cert.cert_pem)  # suelto, sí
    with pytest.raises(FirmaInvalidaError):
        verificar_firma_dte(_sobre(firmado.xml).find(".//s:DTE", N), cert.cert_pem)


def test_alterar_un_monto_rompe_la_firma(cert, caf33) -> None:
    firmado = firmar_dte(_factura(), caf33, cert, MOMENTO)
    alterado = re.sub(rb"<MntTotal>\d+</MntTotal>", b"<MntTotal>1</MntTotal>", firmado.xml)

    with pytest.raises(FirmaInvalidaError):
        verificar_firma_dte(etree.fromstring(alterado), cert.cert_pem)


def test_usa_los_algoritmos_que_fija_el_sii(cert, caf33) -> None:
    """C14N inclusivo, rsa-sha1 y sha1: el esquema del SII no acepta otros."""
    xml = firmar_dte(_factura(), caf33, cert, MOMENTO).xml

    assert b'Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"' in xml
    assert b'Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"' in xml
    assert b'Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"' in xml
    assert b'URI="#T33F1000"' in xml
    assert b"<X509Certificate>" in xml and b"<Modulus>" in xml


# ----------------------------------------------------------------- timbre ---


def _dd_y_frmt(xml: bytes) -> tuple[bytes, bytes]:
    dd = re.search(rb"<DD>.*?</DD>", xml, re.S).group(0)
    frmt = re.search(rb'<FRMT algoritmo="SHA1withRSA">(.*?)</FRMT>', xml, re.S).group(1)
    return dd, base64.b64decode(frmt)


def test_el_timbre_verifica_con_la_llave_del_caf(cert, caf33) -> None:
    """El SII verifica el `<DD>` tal como está escrito en el documento."""
    xml = firmar_dte(_factura(), caf33, cert, MOMENTO).xml
    dd, frmt = _dd_y_frmt(xml)

    llave = serialization.load_pem_private_key(caf33.llave_ted_pem, password=None)
    llave.public_key().verify(frmt, dd, padding.PKCS1v15(), hashes.SHA1())


def test_el_dd_esta_aplanado(cert, caf33) -> None:
    """Sin espacios entre etiquetas: lo firmado y lo escrito son iguales."""
    dd, _ = _dd_y_frmt(firmar_dte(_factura(), caf33, cert, MOMENTO).xml)
    assert re.search(rb">\s+<", dd) is None


def test_el_dd_trae_los_datos_del_documento(cert, caf33) -> None:
    dd, _ = _dd_y_frmt(firmar_dte(_factura(), caf33, cert, MOMENTO).xml)

    assert b"<RE>76543210-3</RE><TD>33</TD><F>1000</F><FE>2026-09-23</FE>" in dd
    assert b"<RR>77777777-7</RR>" in dd
    assert b"<RSR>P\xe9rez &amp; Hijos Ltda</RSR>" in dd  # latin-1 y escapado
    assert b"<MNT>11900</MNT>" in dd
    assert "<IT1>Ñandú de peluche</IT1>".encode("latin-1") in dd
    assert b"<TSTED>2026-09-23T10:30:00</TSTED>" in dd  # hora de Chile


def test_el_caf_del_timbre_queda_en_el_namespace_del_sii(cert, caf33) -> None:
    """Pegado como texto dentro del DTE, el CAF hereda el namespace del SII."""
    arbol = etree.fromstring(firmar_dte(_factura(), caf33, cert, MOMENTO).xml)
    assert arbol.find(".//s:TED/s:DD/s:CAF/s:DA/s:RE", N) is not None


def test_el_ted_devuelto_es_el_que_quedo_escrito(cert, caf33) -> None:
    """Lo que va al PDF417 tiene que ser exactamente lo que está en el XML."""
    firmado = firmar_dte(_factura(), caf33, cert, MOMENTO)
    assert firmado.ted in firmado.xml
    assert firmado.ted.startswith(b'<TED version="1.0"><DD>')


def test_boleta_a_consumidor_final(cert, caf39) -> None:
    datos = DatosDocumento(
        tipo_dte=39,
        fecha_emision=date(2026, 9, 23),
        items=[Item(nombre="Pan", precio=Decimal("1190"))],
    )
    xml = firmar_dte(construir_dte(EMISOR, datos, 1), caf39, cert, MOMENTO).xml
    dd, _ = _dd_y_frmt(xml)

    assert b"<RR>66666666-6</RR>" in dd
    assert f"<RSR>{RSR_SIN_RECEPTOR}</RSR>".encode() in dd


def test_comillas_fuera_del_timbre_pero_no_del_documento(cert, caf33) -> None:
    """Las comillas se quitan solo del `<DD>`; el documento las conserva."""
    receptor = Receptor(
        rut="77777777-7",
        razon_social='Comercial "El Sol" Ltda',
        giro="Comercio",
        direccion="Calle 1",
        comuna="Santiago",
    )
    xml = firmar_dte(_factura(receptor=receptor), caf33, cert, MOMENTO).xml
    dd, _ = _dd_y_frmt(xml)

    assert b"<RSR>Comercial El Sol Ltda</RSR>" in dd
    assert b'<RznSocRecep>Comercial "El Sol" Ltda</RznSocRecep>' in xml


def test_tmst_firma_en_hora_de_chile(cert, caf33) -> None:
    xml = firmar_dte(_factura(), caf33, cert, MOMENTO).xml
    assert b"<TmstFirma>2026-09-23T10:30:00</TmstFirma>" in xml


# ----------------------------------------------------------- validaciones ---


def test_folio_fuera_del_rango_del_caf(cert, caf33) -> None:
    """Timbrar con un CAF que no autoriza ese folio produce un timbre falso."""
    with pytest.raises(FirmaInvalidaError, match="no pertenece al CAF"):
        firmar_dte(_factura(folio=5), caf33, cert, MOMENTO)


def test_caf_de_otro_tipo_de_documento(cert, caf39) -> None:
    with pytest.raises(FirmaInvalidaError, match="no pertenece al CAF"):
        firmar_dte(_factura(folio=10), caf39, cert, MOMENTO)


# --------------------------------------------------------------- semilla -----


def test_la_semilla_firmada_verifica(cert) -> None:
    """El `<getToken>` lleva firma envuelta (URI vacía, todo el documento)."""
    import xmlsec

    from app.dte.signer import firmar_semilla

    firmado = firmar_semilla("168441616904", cert)
    raiz = etree.fromstring(firmado)

    assert raiz.tag == "getToken"
    assert raiz.findtext("item/Semilla") == "168441616904"
    assert b"xmldsig#enveloped-signature" in firmado

    ctx = xmlsec.SignatureContext()
    ctx.key = xmlsec.Key.from_memory(cert.cert_pem, xmlsec.KeyFormat.CERT_PEM)
    ctx.verify(raiz.find(f"{{{xmlsec.constants.DSigNs}}}Signature"))


# ------------------------------------------------------------------ sobre ----


def _firmados(cert, caf33, n: int = 2):
    return [firmar_dte(_factura(folio=1000 + i), caf33, cert, MOMENTO) for i in range(n)]


def _sobre_dte(cert, caf33, n: int = 2) -> bytes:
    from app.dte.signer import firmar_sobre

    return firmar_sobre(
        _firmados(cert, caf33, n),
        canal="DTE",
        rut_emisor="76543210-3",
        rut_envia=cert.rut,
        fecha_resolucion="2026-09-01",
        numero_resolucion=0,
        cert=cert,
        momento=MOMENTO,
    )


def test_el_sobre_cumple_el_esquema_del_sii(cert, caf33) -> None:
    """El `<EnvioDTE>` completo, con dos facturas firmadas, contra el XSD oficial."""
    from pathlib import Path

    xsd = Path(builder.__file__).parent / "xsd" / "dte" / "EnvioDTE_v10.xsd"
    esquema = etree.XMLSchema(etree.parse(str(xsd)))
    sobre = etree.fromstring(_sobre_dte(cert, caf33))

    assert esquema.validate(sobre), "\n".join(str(e) for e in esquema.error_log)


def test_el_sobre_de_boletas_cumple_su_esquema(cert, caf39, tmp_path) -> None:
    from app.dte.signer import firmar_sobre
    from tests.factories import xsd_boleta_parcheado

    datos = DatosDocumento(
        tipo_dte=39, fecha_emision=date(2026, 9, 23), items=[Item(nombre="Pan", precio=Decimal("1190"))]
    )
    boleta = firmar_dte(construir_dte(EMISOR, datos, 1), caf39, cert, MOMENTO)
    sobre = firmar_sobre(
        [boleta],
        canal="BOLETA",
        rut_emisor="76543210-3",
        rut_envia=cert.rut,
        fecha_resolucion="2026-09-01",
        numero_resolucion=0,
        cert=cert,
        momento=MOMENTO,
    )
    esquema = etree.XMLSchema(etree.parse(str(xsd_boleta_parcheado(tmp_path))))
    arbol = etree.fromstring(sobre)

    assert arbol.tag == f"{{{NS}}}EnvioBOLETA"
    assert esquema.validate(arbol), "\n".join(str(e) for e in esquema.error_log)


def test_todas_las_firmas_verifican_dentro_del_sobre(cert, caf33) -> None:
    """La del sobre y la de cada DTE, en el contexto donde las verifica el SII."""
    from app.dte.signer import verificar_sobre

    verificar_sobre(etree.fromstring(_sobre_dte(cert, caf33, n=3)), cert.cert_pem)


def test_los_dte_entran_al_sobre_byte_a_byte(cert, caf33) -> None:
    """Un DTE firmado no se vuelve a serializar por su cuenta: se inserta tal cual."""
    from app.dte.signer import firmar_sobre

    firmados = _firmados(cert, caf33, 2)
    sobre = firmar_sobre(
        firmados, canal="DTE", rut_emisor="76543210-3", rut_envia=cert.rut,
        fecha_resolucion="2026-09-01", numero_resolucion=0, cert=cert, momento=MOMENTO,
    )
    for doc in firmados:
        assert doc.xml.split(b"?>", 1)[1].strip() in sobre


def test_la_caratula(cert, caf33) -> None:
    """RutEnvia es el titular del certificado; RutEmisor, la empresa."""
    sobre = etree.fromstring(_sobre_dte(cert, caf33, n=2))
    caratula = sobre.find(".//s:Caratula", N)

    assert caratula.findtext("s:RutEmisor", namespaces=N) == "76543210-3"
    assert caratula.findtext("s:RutEnvia", namespaces=N) == "11111111-1"
    assert caratula.findtext("s:RutReceptor", namespaces=N) == "60803000-K"
    assert caratula.findtext("s:NroResol", namespaces=N) == "0"
    assert caratula.findtext("s:TmstFirmaEnv", namespaces=N) == "2026-09-23T10:30:00"
    assert caratula.findtext("s:SubTotDTE/s:TpoDTE", namespaces=N) == "33"
    assert caratula.findtext("s:SubTotDTE/s:NroDTE", namespaces=N) == "2"


def test_alterar_el_sobre_rompe_su_firma(cert, caf33) -> None:
    from app.dte.signer import verificar_sobre

    sobre = _sobre_dte(cert, caf33)
    alterado = sobre.replace(b"<NroResol>0</NroResol>", b"<NroResol>1</NroResol>")

    with pytest.raises(FirmaInvalidaError, match="del sobre"):
        verificar_sobre(etree.fromstring(alterado), cert.cert_pem)
