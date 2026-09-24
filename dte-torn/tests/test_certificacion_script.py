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


def _primera_subida_sin_respuesta(entorno, monkeypatch) -> None:
    """Como pasó en certificación: maullin corta la conexión en la primera subida."""
    cortada = []

    def manejador(pedido: httpx.Request) -> httpx.Response:
        if str(pedido.url).endswith("DTEUpload") and not cortada:
            cortada.append(1)
            entorno.llamadas.append("upload")
            raise httpx.RemoteProtocolError("Server disconnected without sending a response.", request=pedido)
        return entorno(pedido)

    monkeypatch.setattr(
        certificacion, "crear_http", lambda timeout: httpx.AsyncClient(transport=httpx.MockTransport(manejador))
    )


async def _estados_del_set() -> set[str]:
    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        return set((await s.execute(select(Document.estado))).scalars())


async def test_set_ambiguo_que_el_sii_no_tiene_se_reenvia_entero(entorno_set, monkeypatch, capsys) -> None:
    from tests.test_sii_client import _documento_sii

    _primera_subida_sin_respuesta(entorno_set, monkeypatch)
    assert await certificacion.modo_set() == 1
    assert await _estados_del_set() == {"VERIFICAR"}

    entorno_set.documentos = [_documento_sii("FAU", "Documento No Recibido por el SII")] * 8
    assert await certificacion.modo_set() == 0
    assert entorno_set.llamadas.count("upload") == 2  # el reenvío, con los 8 juntos
    assert entorno_set.llamadas.count("documento") == 8
    assert await _estados_del_set() == {"ACEPTADO"}


async def test_set_ambiguo_que_el_sii_si_tiene_no_se_reenvia(entorno_set, monkeypatch, capsys) -> None:
    from tests.test_sii_client import DOCUMENTO_RECIBIDO_REAL

    _primera_subida_sin_respuesta(entorno_set, monkeypatch)
    await certificacion.modo_set()

    entorno_set.documentos = [DOCUMENTO_RECIBIDO_REAL] * 8
    assert await certificacion.modo_set() == 0
    assert entorno_set.llamadas.count("upload") == 1
    salida = capsys.readouterr().out
    assert "ya se había enviado" in salida
    assert "N° de envío: 260003916" in salida


async def test_set_ambiguo_a_medias_no_se_reenvia(entorno_set, monkeypatch, capsys) -> None:
    """Si el SII tiene algunos y otros no, algo raro pasó: no tocar nada."""
    from tests.test_sii_client import DOCUMENTO_RECIBIDO_REAL, _documento_sii

    _primera_subida_sin_respuesta(entorno_set, monkeypatch)
    await certificacion.modo_set()

    entorno_set.documentos = [DOCUMENTO_RECIBIDO_REAL] + [_documento_sii("FAU", "No Recibido")] * 7
    assert await certificacion.modo_set() == 1
    assert entorno_set.llamadas.count("upload") == 1
    assert "estados mezclados" in capsys.readouterr().out


async def test_verificar_no_toca_los_casos_del_set(entorno_set, monkeypatch) -> None:
    """El modo `verificar` reenvía de a uno: rompería el envío único del set."""
    _primera_subida_sin_respuesta(entorno_set, monkeypatch)
    await certificacion.modo_set()

    assert await certificacion.modo_verificar() == 0
    assert entorno_set.llamadas.count("documento") == 0
    assert await _estados_del_set() == {"VERIFICAR"}


async def test_muestras_impresas_del_set(entorno_set, tmp_path, monkeypatch, capsys) -> None:
    """Un PDF por documento del set, más la copia cedible de cada factura."""
    await certificacion.modo_set()
    carpeta = tmp_path / "muestras"
    monkeypatch.setenv("DTE_MUESTRAS", str(carpeta))
    monkeypatch.setenv("DTE_EMISOR_OFICINA_SII", "S.I.I. - Santiago Centro")

    assert await certificacion.modo_muestras() == 0
    pdfs = sorted(p.name for p in carpeta.iterdir())
    assert len(pdfs) == 8 + 4
    assert sum("_cedible" in n for n in pdfs) == 4
    assert all((carpeta / n).read_bytes().startswith(b"%PDF") for n in pdfs)
    async with control_session() as s:
        assert (await s.execute(select(Tenant.oficina_sii))).scalar_one() == "S.I.I. - Santiago Centro"


async def test_muestras_sin_set_emitido(entorno_set, tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("DTE_MUESTRAS", str(tmp_path))
    monkeypatch.setenv("DTE_EMISOR_OFICINA_SII", "S.I.I. - Santiago Centro")
    assert await certificacion.modo_muestras() == 1


# ------------------------------------------------------------ otros sets --


@pytest.fixture
def entorno_exenta(entorno, tmp_path, monkeypatch):
    """Archivo con el set básico y el de exenta, como lo entrega el SII."""
    from tests.test_set_pruebas import SET_BASICO, SET_EXENTA

    ruta_set = tmp_path / "set.txt"
    ruta_set.write_bytes((SET_BASICO + "\r\n" + "-" * 80 + "\r\n" + SET_EXENTA).encode("latin-1"))
    rutas = []
    for tipo in (34, 61, 56):
        ruta = tmp_path / f"caf_{tipo}.xml"
        ruta.write_bytes(caf_xml(rut="76543210-3", tipo_dte=tipo, desde=1, hasta=10))
        rutas.append(str(ruta))
    monkeypatch.setenv("DTE_SET", str(ruta_set))
    monkeypatch.setenv("DTE_SET_NOMBRE", "SET FACTURA EXENTA")
    monkeypatch.setenv("DTE_CAFS", ",".join(rutas))
    monkeypatch.setenv("DTE_CAF", rutas[0])
    entorno.estados = [_estado("EPR", aceptados=8)] * 5
    return entorno


def test_revisar_set_usa_el_set_pedido(entorno_exenta, capsys) -> None:
    assert certificacion.modo_revisar_set() == 0
    salida = capsys.readouterr().out
    assert "Set número de atención 7654321: 8 casos" in salida
    assert "3 de factura exenta (tipo 34)" in salida


async def test_el_set_de_exenta_va_en_un_solo_envio_sin_iva(entorno_exenta, capsys) -> None:
    assert await certificacion.modo_set() == 0
    assert entorno_exenta.llamadas.count("upload") == 1

    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        docs = (await s.execute(select(Document))).scalars().all()
    assert sorted(d.external_id for d in docs) == [f"set-7654321-7654321-{n}" for n in range(1, 9)]
    assert {d.estado for d in docs} == {"ACEPTADO"}
    assert {(d.monto_neto, d.monto_iva) for d in docs} == {(0, 0)}


async def test_enviar_una_factura_exenta_de_prueba(entorno, tmp_path, monkeypatch) -> None:
    """Para subir el máximo de folios del 34 antes de pedir los del set."""
    caf = tmp_path / "caf_34.xml"
    caf.write_bytes(caf_xml(rut="76543210-3", tipo_dte=34, desde=1, hasta=10))
    monkeypatch.setenv("DTE_CAF", str(caf))
    assert await certificacion.modo_enviar() == 0

    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        doc = (await s.execute(select(Document))).scalar_one()
    assert (doc.tipo_dte, doc.monto_exento, doc.monto_iva, doc.estado) == (34, 1000, 0, "ACEPTADO")


async def test_el_set_de_guias_manda_el_traslado_interno_al_propio_emisor(entorno, tmp_path, monkeypatch) -> None:
    from tests.test_set_pruebas import SET_GUIA

    ruta_set = tmp_path / "set.txt"
    ruta_set.write_bytes(SET_GUIA.encode("latin-1"))
    caf = tmp_path / "caf_52.xml"
    caf.write_bytes(caf_xml(rut="76543210-3", tipo_dte=52, desde=1, hasta=10))
    monkeypatch.setenv("DTE_SET", str(ruta_set))
    monkeypatch.setenv("DTE_SET_NOMBRE", "SET GUIA DE DESPACHO")
    monkeypatch.setenv("DTE_CAFS", str(caf))
    entorno.estados = [_estado("EPR", aceptados=3)] * 5
    assert await certificacion.modo_set() == 0

    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        docs = (await s.execute(select(Document).order_by(Document.folio))).scalars().all()
    assert [(d.receptor_rut, d.payload["ind_traslado"], d.monto_total) for d in docs] == [
        ("76543210-3", 5, 0), ("60803000-K", 1, 940142), ("60803000-K", 1, 750795),
    ]
    assert docs[0].payload["receptor"]["direccion"] == "Av. Siempre Viva 742"


async def test_enviar_una_guia_de_prueba(entorno, tmp_path, monkeypatch) -> None:
    """Para subir el máximo de folios del 52: una guía de venta."""
    caf = tmp_path / "caf_52.xml"
    caf.write_bytes(caf_xml(rut="76543210-3", tipo_dte=52, desde=1, hasta=10))
    monkeypatch.setenv("DTE_CAF", str(caf))
    assert await certificacion.modo_enviar() == 0

    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        doc = (await s.execute(select(Document))).scalar_one()
    assert (doc.tipo_dte, doc.payload["ind_traslado"], doc.monto_total, doc.estado) == (52, 1, 1190, "ACEPTADO")



# ----------------------------------------------------------------- libros --


async def test_libro_de_ventas_con_los_documentos_del_set(entorno_set, tmp_path, monkeypatch, capsys) -> None:
    """Totales de facturas del set básico de prueba, a mano (ver
    test_set_pruebas.ESPERADOS): 521.719 + 2.491.535 + 880.874 + 1.003.611 = 4.897.739."""
    from lxml import etree

    from app.dte.builder import NS

    await certificacion.modo_set()
    monkeypatch.setenv("DTE_LIBRO", "ventas")
    monkeypatch.setenv("DTE_MUESTRAS", str(tmp_path / "libros"))
    entorno_set.uploads.append((200, _upload("0", "5555")))
    entorno_set.estados = [_estado("LOK", glosa="Libro Cuadrado")]
    assert await certificacion.modo_libro() == 0

    assert entorno_set.llamadas.count("upload") == 2
    salida = capsys.readouterr().out
    assert "N° de envío 5555" in salida
    arbol = etree.fromstring((tmp_path / "libros" / "libro_ventas.xml").read_bytes())
    n = {"s": NS}
    facturas = arbol.find(".//s:TotalesPeriodo[s:TpoDoc='33']", n)
    assert (facturas.findtext("s:TotDoc", namespaces=n), facturas.findtext("s:TotMntTotal", namespaces=n)) == (
        "4", "4897739",
    )
    assert len(arbol.findall(".//s:Detalle", n)) == 8
    assert arbol.findtext(".//s:FolioNotificacion", namespaces=n) == "1"


async def test_libro_sin_set_emitido_no_parte(entorno_set, monkeypatch) -> None:
    monkeypatch.setenv("DTE_LIBRO", "ventas")
    with pytest.raises(SystemExit, match="primero corre"):
        await certificacion.modo_libro()



async def test_libro_de_guias_con_factura_y_anulada(entorno, tmp_path, monkeypatch, capsys) -> None:
    """Caso 1 traslado interno, caso 2 facturado (referencia a su factura), caso 3 anulado."""
    from lxml import etree

    from app.dte.builder import NS
    from tests.test_set_pruebas import SET_GUIA

    libro = (
        "SET LIBRO DE GUIAS - NUMERO DE ATENCION: 5550009\r\n\r\n"
        "- EL CASO 2 CORRESPONDE A UNA GUIA QUE SE FACTURO EN EL PERIODO\r\n"
        "- EL CASO 3 CORRESPONDE A UNA GUIA ANULADA\r\n"
    )
    ruta_set = tmp_path / "set.txt"
    ruta_set.write_bytes((SET_GUIA + "\r\n" + "-" * 80 + "\r\n" + libro).encode("latin-1"))
    caf52 = tmp_path / "caf_52.xml"
    caf52.write_bytes(caf_xml(rut="76543210-3", tipo_dte=52, desde=1, hasta=10))
    caf33 = tmp_path / "caf_33.xml"
    caf33.write_bytes(caf_xml(rut="76543210-3", tipo_dte=33, desde=1, hasta=10))
    monkeypatch.setenv("DTE_SET", str(ruta_set))
    monkeypatch.setenv("DTE_SET_NOMBRE", "SET GUIA DE DESPACHO")
    monkeypatch.setenv("DTE_CAFS", str(caf52))
    entorno.estados = [_estado("EPR", aceptados=3)] * 3
    assert await certificacion.modo_set() == 0

    # Sin la factura de la guía 2, el libro no se arma.
    monkeypatch.setenv("DTE_LIBRO", "guias")
    monkeypatch.setenv("DTE_MUESTRAS", str(tmp_path / "libros"))
    with pytest.raises(SystemExit, match="DTE_FACTURA_DE_GUIA=2"):
        await certificacion.modo_libro()

    monkeypatch.setenv("DTE_CAF", str(caf33))
    monkeypatch.setenv("DTE_FACTURA_DE_GUIA", "2")
    entorno.uploads.append((200, _upload("0", "777")))
    entorno.estados = [_estado("EPR", aceptados=1)]
    assert await certificacion.modo_enviar() == 0

    entorno.uploads.append((200, _upload("0", "888")))
    entorno.estados = [_estado("LOK", glosa="Envio de Libro Aceptado - Cuadrado")]
    assert await certificacion.modo_libro() == 0
    assert "N° de envío 888" in capsys.readouterr().out

    n = {"s": NS}
    arbol = etree.fromstring((tmp_path / "libros" / "libro_guias.xml").read_bytes())
    assert arbol.findtext(".//s:FolioNotificacion", namespaces=n) == "5550009"
    detalle = arbol.findall(".//s:Detalle", n)
    assert [d.findtext("s:TpoOper", namespaces=n) for d in detalle] == ["5", "1", "1"]
    assert (detalle[1].findtext("s:TpoDocRef", namespaces=n), detalle[1].findtext("s:FolioDocRef", namespaces=n)) == ("33", "1")
    assert detalle[1].findtext("s:MntTotal", namespaces=n) == "940142"
    assert detalle[2].findtext("s:Anulado", namespaces=n) == "2"
    assert arbol.findtext(".//s:TotMntGuiaVta", namespaces=n) == "940142"



async def test_reenviar_un_set_rechazado_emite_con_folios_nuevos(entorno_set, monkeypatch) -> None:
    await certificacion.modo_set()
    monkeypatch.setenv("DTE_SET_INTENTO", "2")
    entorno_set.uploads.append((200, _upload("0", "222")))
    entorno_set.estados = [_estado("EPR", aceptados=8)] * 3
    assert await certificacion.modo_set() == 0
    assert entorno_set.llamadas.count("upload") == 2

    async with control_session() as s:
        tenant_id = (await s.execute(select(Tenant.id))).scalar_one()
    async with tenant_session(tenant_id) as s:
        docs = (await s.execute(select(Document).order_by(Document.tipo_dte, Document.folio))).scalars().all()
    assert len(docs) == 16
    nuevos = [d for d in docs if d.external_id.startswith("set-1234567-r2-")]
    assert len(nuevos) == 8 and {d.estado for d in nuevos} == {"ACEPTADO"}
    assert len({d.folio for d in docs if d.tipo_dte == 33}) == 8  # ningún folio repetido
