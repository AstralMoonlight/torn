"""Recepción de documentos de proveedores (intercambio, parte b).

Con Postgres, Redis y MinIO reales; el SII, el servidor de correo y la casilla
simulados. El sobre del proveedor se arma con el mismo `builder` y `signer` de
la emisión, pero con otra empresa y otro certificado: así se prueba que la
firma se verifica con el certificado que trae el sobre, no con el nuestro.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from email.message import EmailMessage

import httpx
import pytest
from lxml import etree
from sqlalchemy import select, text, update

from app.core.buzon import leer_mensaje
from app.core.certificados import parsear_pfx
from app.db import control_session, tenant_session
from app.dte import recepcion, recibidos
from app.dte.builder import NS, DatosDocumento, Emisor, Item, Receptor
from app.dte.caf import parsear_caf
from app.dte.pipeline import construir_y_firmar
from app.dte.rut import digito_verificador
from app.dte.signer import ZONA_CHILE, firmar_sobre
from app.dte.sii_client import SiiNoDisponibleError, leer_fecha_recepcion, leer_respuesta_registro
from app.main import app
from app.models import TABLAS_RLS, Ambiente, DocumentoRecibido, EnvioRecibido, EstadoAcuse, Tenant
from tests.factories import CLAVE_PFX, caf_xml, pfx
from tests.test_api import CLAVE, _alta, api  # noqa: F401 - fixture
from tests.test_intercambio import CorreoFalso
from tests.test_pipeline import RUT_EMPRESA, _ctx, emisor  # noqa: F401 - fixture
from tests.test_sii_client import SiiFalso

RUT_PROVEEDOR = f"76111111-{digito_verificador(76111111)}"
PROVEEDOR = Emisor(rut=RUT_PROVEEDOR, razon_social="Mayorista del Sur SpA", giro="Venta al por mayor",
                   acteco="464903", direccion="Calle Falsa 123", comuna="Concepcion")


@pytest.fixture(scope="module")
def cert_proveedor():
    return parsear_pfx(pfx(rut="22222222-2"), CLAVE_PFX)


@pytest.fixture(scope="module")
def caf_proveedor():
    return parsear_caf(caf_xml(rut=RUT_PROVEEDOR, tipo_dte=33, desde=1, hasta=100))


def sobre_proveedor(cert, caf, *, receptor: str = RUT_EMPRESA, folios=(7,), rut_dte: str | None = None,
                    desfase: int = 0) -> bytes:
    """Un `EnvioDTE` como el que manda un proveedor a nuestra casilla. `desfase`
    (segundos) cambia la hora de firma: dos sobres del mismo segundo son el mismo archivo."""
    momento = datetime.now(ZONA_CHILE) + timedelta(seconds=desfase)
    firmados = []
    for folio in folios:
        datos = DatosDocumento(
            tipo_dte=33, fecha_emision=date(2026, 9, 28),
            receptor=Receptor(rut=rut_dte or receptor, razon_social="Empresa de Prueba SpA", giro="Comercio",
                              direccion="Av. Siempre Viva 742", comuna="Santiago"),
            items=[Item(nombre="Resma carta", codigo="RES-1", cantidad=Decimal("10"), precio=Decimal("3000")),
                   Item(nombre="Corchetera", precio=Decimal("5000"))],
        )
        firmados.append(construir_y_firmar(PROVEEDOR, datos, folio, caf, cert, momento))
    return firmar_sobre(firmados, canal="DTE", rut_emisor=RUT_PROVEEDOR, rut_envia=cert.rut,
                        fecha_resolucion="2014-08-22", numero_resolucion=80, cert=cert, rut_receptor=receptor,
                        momento=momento)


# -------------------------------------------------------------- lectura ---


def test_un_envio_bien_hecho_se_recibe_conforme(cert_proveedor, caf_proveedor) -> None:
    leido = recepcion.leer_envio(sobre_proveedor(cert_proveedor, caf_proveedor, folios=(7, 8)), RUT_EMPRESA)

    assert (leido.estado, leido.firma_valida) == (recepcion.CONFORME, True), leido.glosa
    assert leido.rut_emisor == RUT_PROVEEDOR and leido.razon_social_emisor == "Mayorista del Sur SpA"
    assert leido.envio_dte_id == "SetDoc" and leido.digest
    assert [d.folio for d in leido.documentos] == [7, 8]
    d = leido.documentos[0]
    assert (d.estado, d.monto_neto, d.monto_iva, d.monto_total) == (recepcion.DTE_OK, 35000, 6650, 41650)
    assert d.detalle["lineas"][0]["codigo"] == "RES-1" and d.detalle["lineas"][0]["cantidad"] == "10"


def test_un_sobre_alterado_no_verifica(cert_proveedor, caf_proveedor) -> None:
    xml = sobre_proveedor(cert_proveedor, caf_proveedor).replace(b"Resma carta", b"Resma oficio")
    leido = recepcion.leer_envio(xml, RUT_EMPRESA)

    assert leido.estado == recepcion.ERROR_FIRMA and not leido.firma_valida
    # El documento igual se muestra: el SII lo tiene y corre el plazo para reclamarlo.
    assert len(leido.documentos) == 1


def test_un_sobre_para_otra_empresa_se_rechaza(cert_proveedor, caf_proveedor) -> None:
    otro = f"77000000-{digito_verificador(77000000)}"
    leido = recepcion.leer_envio(sobre_proveedor(cert_proveedor, caf_proveedor, receptor=otro), RUT_EMPRESA)
    assert leido.estado == recepcion.RUT_NO_CORRESPONDE and not leido.documentos


def test_un_dte_para_otro_rut_dentro_del_sobre(cert_proveedor, caf_proveedor) -> None:
    otro = f"77000000-{digito_verificador(77000000)}"
    leido = recepcion.leer_envio(sobre_proveedor(cert_proveedor, caf_proveedor, rut_dte=otro), RUT_EMPRESA)
    assert leido.documentos[0].estado == recepcion.DTE_RUT_RECEPTOR


def test_lo_que_no_es_un_envio_se_ignora() -> None:
    with pytest.raises(recepcion.NoEsEnvioDteError):
        recepcion.leer_envio(b'<RespuestaDTE xmlns="http://www.sii.cl/SiiDte"/>', RUT_EMPRESA)
    assert recepcion.leer_envio(b"<no es xml", RUT_EMPRESA).estado == recepcion.ILEGIBLE


def test_un_xml_de_afuera_no_lee_archivos_locales(tmp_path) -> None:
    secreto = tmp_path / "secreto.txt"
    secreto.write_text("CLAVE")
    xml = (f'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file://{secreto.as_posix()}">]>'
           f'<EnvioDTE xmlns="{NS}"><SetDTE><Caratula><RutReceptor>&e;</RutReceptor></Caratula></SetDTE></EnvioDTE>')
    leido = recepcion.leer_envio(xml.encode(), RUT_EMPRESA)
    assert "CLAVE" not in (leido.glosa + str(leido.rut_receptor))


def test_el_acuse_cumple_el_esquema_y_va_firmado(cert_proveedor, caf_proveedor) -> None:
    leido = recepcion.leer_envio(sobre_proveedor(cert_proveedor, caf_proveedor), RUT_EMPRESA)
    nuestro = parsear_pfx(pfx(rut="11111111-1"), CLAVE_PFX)
    xml = recepcion.respuesta_recepcion(
        recepcion.DatosAcuse(
            codigo=42, nombre_archivo="envio.xml", recibido_at=datetime.now(timezone.utc),
            envio_dte_id=leido.envio_dte_id, digest=leido.digest, rut_emisor=leido.rut_emisor,
            rut_receptor=RUT_EMPRESA, estado=leido.estado, glosa=leido.glosa,
            resultados=[d.resultado() for d in leido.documentos],
        ),
        cert=nuestro, correo_contacto="xml@empresa.cl", momento=datetime.now(ZONA_CHILE),
    )
    raiz = etree.fromstring(xml)
    esquema = recepcion.esquema_respuesta()
    assert esquema.validate(raiz), esquema.error_log
    assert raiz.findtext(f".//{{{NS}}}CodEnvio") == "42"
    assert raiz.findtext(f".//{{{NS}}}EstadoRecepDTE") == "0"


# ------------------------------------------------------ registro del SII ---

_NS_REG = "http://ws.registroreclamodte.diii.sdi.sii.cl"


def _reg(metodo: str, cuerpo: str) -> bytes:
    return (f'<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>'
            f'<ns2:{metodo}Response xmlns:ns2="{_NS_REG}"><return>{cuerpo}</return></ns2:{metodo}Response>'
            f"</S:Body></S:Envelope>").encode()


_EVENTO_ACD = ("<listaEventosDoc><codEvento>ACD</codEvento><descEvento>Acepta Contenido del Documento</descEvento>"
               "<rutResponsable>76543210</rutResponsable><dvResponsable>3</dvResponsable>"
               "<fechaEvento>29-09-2026 12:05:36</fechaEvento></listaEventosDoc>")


def test_respuestas_del_registro() -> None:
    r = leer_respuesta_registro(_reg("listarEventosHistDoc",
                                     f"<codResp>15</codResp><descResp>Listado de eventos del documento</descResp>{_EVENTO_ACD}"))
    assert (r.codigo, r.eventos[0]["codigo"], r.eventos[0]["responsable"]) == (15, "ACD", "76543210-3")
    assert r.eventos[0]["fecha"].startswith("2026-09-29T12:05:36")
    with pytest.raises(SiiNoDisponibleError):
        leer_respuesta_registro(_reg("ingresarAceptacionReclamoDoc", "<codResp>-1</codResp><descResp>Error</descResp>"))
    fecha = leer_fecha_recepcion(_reg("consultarFechaRecepcionSii", "28-09-2026 19:02:03"))
    assert fecha == datetime(2026, 9, 28, 19, 2, 3, tzinfo=ZONA_CHILE)
    assert leer_fecha_recepcion(_reg("consultarFechaRecepcionSii", "")) is None


class RegistroFalso(SiiFalso):
    """El SII con el registro de aceptación o reclamo."""

    def __init__(self, cod_accion: int = 0, desc_accion: str = "Acción Completada OK") -> None:
        super().__init__()
        self.cod_accion, self.desc_accion = cod_accion, desc_accion
        self.acciones: list[bytes] = []

    def __call__(self, pedido: httpx.Request) -> httpx.Response:
        if "registroreclamodte" not in str(pedido.url):
            return super().__call__(pedido)
        assert pedido.headers["cookie"] == "TOKEN=TOKENVALIDO123"
        cuerpo = pedido.content
        if b"ingresarAceptacionReclamoDoc" in cuerpo:
            self.acciones.append(cuerpo)
            return httpx.Response(200, content=_reg("ingresarAceptacionReclamoDoc",
                                                    f"<codResp>{self.cod_accion}</codResp><descResp>{self.desc_accion}</descResp>"))
        if b"consultarFechaRecepcionSii" in cuerpo:
            return httpx.Response(200, content=_reg("consultarFechaRecepcionSii", "28-09-2026 10:00:00"))
        eventos = _EVENTO_ACD if self.acciones else ""
        return httpx.Response(200, content=_reg("listarEventosHistDoc", f"<codResp>{15 if eventos else 16}</codResp>{eventos}"))


# ------------------------------------------------------- guardar y acusar ---


async def _tenant(tid: uuid.UUID) -> Tenant:
    async with control_session() as s:
        return (await s.execute(select(Tenant).where(Tenant.id == tid))).scalar_one()


async def test_guardar_es_idempotente_y_marca_repetidos(emisor, almacen, cert_proveedor, caf_proveedor) -> None:
    tenant = await _tenant(emisor)
    xml = sobre_proveedor(cert_proveedor, caf_proveedor)

    envio, docs, nuevo = await recibidos.guardar_envio(
        almacen, tenant, xml, origen="CORREO", nombre_archivo="DTE_7.xml", correo_origen="dte@mayorista.cl")
    assert nuevo and len(docs) == 1
    assert envio.acuse_estado == EstadoAcuse.PENDIENTE
    assert docs[0].registro_next_at is not None  # factura: sigue el registro del SII

    otra_vez, docs2, nuevo2 = await recibidos.guardar_envio(
        almacen, tenant, xml, origen="CORREO", nombre_archivo="DTE_7.xml", correo_origen="dte@mayorista.cl")
    assert (otra_vez.id, docs2, nuevo2) == (envio.id, [], False)

    # El mismo documento en otro sobre (el proveedor lo reenvió): repetido.
    reenvio, docs3, _ = await recibidos.guardar_envio(
        almacen, tenant, sobre_proveedor(cert_proveedor, caf_proveedor, desfase=5), origen="MANUAL",
        nombre_archivo="x.xml")
    assert docs3 == [] and reenvio.resultados[0]["estado"] == recepcion.DTE_REPETIDO
    assert reenvio.acuse_estado == EstadoAcuse.NO_APLICA


async def test_el_acuse_llega_al_proveedor(emisor, almacen, redis_limpio, cert_proveedor, caf_proveedor) -> None:
    tenant = await _tenant(emisor)
    envio, _, _ = await recibidos.guardar_envio(
        almacen, tenant, sobre_proveedor(cert_proveedor, caf_proveedor), origen="CORREO",
        nombre_archivo="DTE_7.xml", correo_origen="dte@mayorista.cl")
    ctx = _ctx(SiiFalso(), redis_limpio, almacen)
    ctx.correo = CorreoFalso()

    assert await recibidos.acusar(ctx, emisor, envio.id) == EstadoAcuse.ENVIADO
    msg = ctx.correo.enviados[0]
    assert msg["To"] == "dte@mayorista.cl"
    adjunto = next(msg.iter_attachments()).get_content()
    raiz = etree.fromstring(adjunto)
    assert recepcion.esquema_respuesta().validate(raiz)
    assert raiz.findtext(f".//{{{NS}}}RutRecibe") == RUT_PROVEEDOR
    # Ya enviado: una segunda vuelta no lo repite.
    assert await recibidos.acusar(ctx, emisor, envio.id) == EstadoAcuse.ENVIADO
    assert len(ctx.correo.enviados) == 1


async def test_aceptar_va_al_registro_del_sii(emisor, almacen, redis_limpio, cert_proveedor, caf_proveedor) -> None:
    tenant = await _tenant(emisor)
    _, docs, _ = await recibidos.guardar_envio(
        almacen, tenant, sobre_proveedor(cert_proveedor, caf_proveedor), origen="MANUAL", nombre_archivo="x.xml")
    sii = RegistroFalso()
    ctx = _ctx(sii, redis_limpio, almacen)

    doc = await recibidos.registrar_accion(ctx, tenant, docs[0].id, "ACD", "admin@empresa.cl")

    assert (doc.accion, doc.accion_actor) == ("ACD", "admin@empresa.cl")
    assert recibidos.estado_registro(doc.eventos, doc.accion) == "ACEPTADO"
    pedido = etree.fromstring(sii.acciones[0])
    assert [n.text for n in pedido.iter() if etree.QName(n).localname in ("rutEmisor", "dvEmisor", "folio", "accionDoc")] \
        == ["76111111", RUT_PROVEEDOR[-1], "7", "ACD"]


async def test_el_sii_puede_no_registrar(emisor, almacen, redis_limpio, cert_proveedor, caf_proveedor) -> None:
    tenant = await _tenant(emisor)
    _, docs, _ = await recibidos.guardar_envio(
        almacen, tenant, sobre_proveedor(cert_proveedor, caf_proveedor), origen="MANUAL", nombre_archivo="x.xml")
    ctx = _ctx(RegistroFalso(8, "Pasados 8 días después de la recepción no es posible registrar reclamos o eventos."),
               redis_limpio, almacen)

    with pytest.raises(recibidos.RegistroRechazadoError, match="Pasados 8 días"):
        await recibidos.registrar_accion(ctx, tenant, docs[0].id, "RCD", "admin@empresa.cl")
    async with tenant_session(emisor) as s:
        assert (await s.execute(select(DocumentoRecibido.accion))).scalar_one() is None


async def test_en_desarrollador_no_se_habla_con_el_sii(emisor, almacen, redis_limpio, cert_proveedor, caf_proveedor) -> None:
    async with control_session() as s:
        await s.execute(update(Tenant).where(Tenant.id == emisor).values(ambiente=Ambiente.DEV))
    tenant = await _tenant(emisor)
    _, docs, _ = await recibidos.guardar_envio(
        almacen, tenant, sobre_proveedor(cert_proveedor, caf_proveedor), origen="CORREO",
        nombre_archivo="x.xml", correo_origen="dte@mayorista.cl")
    assert docs[0].registro_next_at is None

    def sin_red(pedido):
        raise AssertionError(f"No debía llamar al SII: {pedido.url}")

    doc = await recibidos.registrar_accion(_ctx(sin_red, redis_limpio, almacen), tenant, docs[0].id, "RFT", None)
    assert recibidos.estado_registro(doc.eventos, doc.accion) == "RECLAMADO"


async def test_la_consulta_trae_la_fecha_del_sii(emisor, almacen, redis_limpio, cert_proveedor, caf_proveedor) -> None:
    tenant = await _tenant(emisor)
    _, docs, _ = await recibidos.guardar_envio(
        almacen, tenant, sobre_proveedor(cert_proveedor, caf_proveedor), origen="MANUAL", nombre_archivo="x.xml")

    assert await recibidos.actualizar_registro(_ctx(RegistroFalso(), redis_limpio, almacen), emisor, docs[0].id) == "OK"
    async with tenant_session(emisor) as s:
        doc = (await s.execute(select(DocumentoRecibido))).scalar_one()
    assert doc.fecha_recepcion_sii == datetime(2026, 9, 28, 10, 0, tzinfo=ZONA_CHILE)
    assert doc.eventos == []
    # Mientras corre el plazo se sigue consultando; después ya no.
    assert doc.registro_next_at is not None
    assert recibidos.plazo(doc) == datetime(2026, 10, 6, 10, 0, tzinfo=ZONA_CHILE)


# --------------------------------------------------------------- casilla ---


def _correo(adjuntos: list[tuple[str, bytes]]) -> bytes:
    msg = EmailMessage()
    msg["From"] = "Facturacion <facturacion@mayorista.cl>"
    msg["Reply-To"] = "dte@mayorista.cl"
    msg["To"] = "xml@empresa.cl"
    msg["Subject"] = "Factura 7"
    msg.set_content("Adjuntamos el documento.")
    for nombre, xml in adjuntos:
        msg.add_attachment(xml, maintype="application", subtype="octet-stream", filename=nombre)
    return msg.as_bytes()


async def test_un_correo_de_la_casilla_se_guarda_a_nombre_de_su_empresa(
    emisor, almacen, cert_proveedor, caf_proveedor
) -> None:
    acuse_de_un_cliente = b'<RespuestaDTE xmlns="http://www.sii.cl/SiiDte"/>'
    correo = leer_mensaje(b"12", _correo([
        ("DTE_7.xml", sobre_proveedor(cert_proveedor, caf_proveedor)),
        ("respuesta.xml", acuse_de_un_cliente),
    ]))
    assert (correo.remitente, correo.responder_a) == ("facturacion@mayorista.cl", "dte@mayorista.cl")
    assert len(correo.adjuntos) == 2

    nuevos = await recibidos.procesar_correo(almacen, correo)

    assert len(nuevos) == 1 and nuevos[0].correo_origen == "dte@mayorista.cl"
    async with tenant_session(emisor) as s:
        assert (await s.execute(select(DocumentoRecibido.folio))).scalars().all() == [7]


async def test_un_correo_para_una_empresa_que_no_esta_se_ignora(limpiar, almacen, cert_proveedor, caf_proveedor) -> None:
    correo = leer_mensaje(b"13", _correo([("DTE.xml", sobre_proveedor(cert_proveedor, caf_proveedor))]))
    assert await recibidos.procesar_correo(almacen, correo) == []


# -------------------------------------------------------------------- API ---


async def test_cargar_listar_y_aceptar_por_la_api(api, cert_proveedor, caf_proveedor) -> None:
    h = await _alta(api)
    sii = RegistroFalso()
    app.state.ctx.http = httpx.AsyncClient(transport=httpx.MockTransport(sii))
    xml = sobre_proveedor(cert_proveedor, caf_proveedor, receptor="76543210-3")

    r = await api.post("/recibidos", headers=h, files={"archivo": ("DTE_7.xml", xml)})
    assert r.status_code == 201, r.text
    carga = r.json()
    assert carga["nuevo"] and carga["envio"]["estado"] == 0 and len(carga["documentos"]) == 1
    doc_id = carga["documentos"][0]["id"]

    lista = (await api.get("/recibidos", headers=h, params={"sin_responder": True})).json()
    assert [d["folio"] for d in lista] == [7]
    assert lista[0]["plazo_aproximado"] and lista[0]["estado_registro"] is None
    assert (await api.get("/recibidos", headers=h, params={"q": "mayorista"})).json()[0]["id"] == doc_id

    detalle = (await api.get(f"/recibidos/{doc_id}", headers=h)).json()
    assert detalle["detalle"]["lineas"][0]["nombre"] == "Resma carta"
    assert (await api.get(f"/recibidos/{doc_id}/xml", headers=h)).content.startswith(b"<?xml")

    r = await api.post(f"/recibidos/{doc_id}/accion", headers={**h, "X-Actor": "admin@empresa.cl"}, json={"accion": "ACD"})
    assert r.status_code == 200, r.text
    assert r.json()["estado_registro"] == "ACEPTADO"
    assert (await api.get("/recibidos", headers=h, params={"sin_responder": True})).json() == []

    assert (await api.post("/recibidos", headers=h, files={"archivo": ("a.xml", b"<RespuestaDTE/>")})).status_code == 422


async def test_otra_empresa_no_ve_lo_recibido(api, cert_proveedor, caf_proveedor) -> None:
    h = await _alta(api)
    otra = await _alta(api, rut=f"77000000-{digito_verificador(77000000)}")
    xml = sobre_proveedor(cert_proveedor, caf_proveedor, receptor="76543210-3")
    doc_id = (await api.post("/recibidos", headers=h, files={"archivo": ("x.xml", xml)})).json()["documentos"][0]["id"]

    assert (await api.get("/recibidos", headers=otra)).json() == []
    assert (await api.get(f"/recibidos/{doc_id}", headers=otra)).status_code == 404


# -------------------------------------------------------------------- RLS ---


async def test_toda_tabla_de_empresa_tiene_rls(limpiar) -> None:
    async with control_session() as s:
        filas = dict((await s.execute(text(
            "SELECT relname, relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = ANY(:t)"
        ), {"t": list(TABLAS_RLS)})).all())
    assert filas == {t: True for t in TABLAS_RLS}


def test_plazo_sin_fecha_del_sii_cuenta_desde_la_llegada() -> None:
    llegada = datetime(2026, 9, 29, 9, 0, tzinfo=timezone.utc)
    doc = DocumentoRecibido(created_at=llegada, fecha_recepcion_sii=None)
    assert recibidos.plazo(doc) == llegada + timedelta(days=8)
