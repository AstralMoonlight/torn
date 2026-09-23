"""Cliente del SII (issue #21).

Sin red: las respuestas marcadas REAL son copias exactas de lo que devolvió el
SII el 2026-09-23 (semillas, errores de token y de consulta, la página HTML de
`DTEUpload` sin sesión, y el estado de la primera factura real aceptada). Las
marcadas DOCUMENTADA siguen el formato del manual; el primer envío real
(track 0260003916) las leyó sin problemas, así que el formato está confirmado.

El cliente se prueba con `httpx.MockTransport` y el Redis del compose, así que
el caché del token es real.
"""

from __future__ import annotations

import json
import re
import uuid

import httpx
import pytest
import xmlsec
from lxml import etree

from app.core.certificados import parsear_pfx
from app.dte.sii_client import (
    Canal,
    ClienteSii,
    Resultado,
    SiiAutenticacionError,
    SiiNoDisponibleError,
    SiiRechazoError,
    SiiTokenInvalidoError,
    clasificar,
    desenvolver_soap,
    leer_estado_boleta,
    leer_estado_dte,
    leer_semilla,
    leer_token,
    leer_upload_dte,
)
from tests.factories import CLAVE_PFX, pfx

# ------------------------------------------------------------------ REALES --

SEMILLA_SOAP = b"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <soapenv:Body>
  <getSeedResponse soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
   <getSeedReturn xsi:type="xsd:string">&lt;?xml version=&quot;1.0&quot; encoding=&quot;UTF-8&quot;?&gt;&lt;SII:RESPUESTA xmlns:SII=&quot;http://www.sii.cl/XMLSchema&quot;&gt;&lt;SII:RESP_BODY&gt;&lt;SEMILLA&gt;168441616904&lt;/SEMILLA&gt;&lt;/SII:RESP_BODY&gt;&lt;SII:RESP_HDR&gt;&lt;ESTADO&gt;00&lt;/ESTADO&gt;&lt;/SII:RESP_HDR&gt;&lt;/SII:RESPUESTA&gt;</getSeedReturn>
  </getSeedResponse>
 </soapenv:Body>
</soapenv:Envelope>"""

SEMILLA_BOLETA = (
    b'<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">'
    b"<SII:RESP_BODY><SEMILLA>168441617038</SEMILLA></SII:RESP_BODY>"
    b"<SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>"
)

#: `getToken` con firma inválida: el SII lo informa como "Error Interno".
TOKEN_RECHAZADO = (
    b'<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">'
    b"<SII:RESP_HDR><ESTADO>10</ESTADO><GLOSA>Error Interno</GLOSA></SII:RESP_HDR></SII:RESPUESTA>"
)

#: `getEstUp` con token inválido, con los CR que manda el SII.
ESTADO_TOKEN_NO_EXISTE = (
    b'<?xml version="1.0" encoding="UTF-8"?>\r\n<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">\r\n'
    b"    <SII:RESP_HDR>\r\n        <ESTADO>001</ESTADO>\r\n        <GLOSA>TOKEN NO EXISTE</GLOSA>\r\n"
    b"    </SII:RESP_HDR>\r\n</SII:RESPUESTA>"
)

#: `DTEUpload` sin sesión: HTTP 200 y una página HTML (recortada).
UPLOAD_HTML = (
    b'<HTML> <HEAD> <TITLE>Error 501</TITLE> </HEAD> <BODY> <div align="center"><center> '
    b'<table border="0" cellpadding="0" cellspacing="0" width="630"> <tr> <td colspan="2"></tr>'
)

#: `getEstUp` del primer envío real aceptado por el SII de certificación
#: (2026-09-23, una factura emitida por este servicio). Confirma el formato que
#: estaba escrito según el manual.
ESTADO_ACEPTADO_REAL = (
    b'<?xml version="1.0" encoding="UTF-8"?>\n<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">\n'
    b"    <SII:RESP_BODY>\n        <TIPO_DOCTO>33</TIPO_DOCTO>\n        <INFORMADOS>1</INFORMADOS>\n"
    b"        <ACEPTADOS>1</ACEPTADOS>\n        <RECHAZADOS>0</RECHAZADOS>\n        <REPAROS>0</REPAROS>\n"
    b"    </SII:RESP_BODY>\n    <SII:RESP_HDR>\n        <TRACKID>0260003916</TRACKID>\n"
    b"        <ESTADO>EPR</ESTADO>\n        <GLOSA>Envio Procesado</GLOSA>\n"
    b"        <NUM_ATENCION>34909   ( 2026/09/23 16:29:53)</NUM_ATENCION>\n"
    b"    </SII:RESP_HDR>\n</SII:RESPUESTA>"
)

# ------------------------------------------------------------ DOCUMENTADAS --


def _respuesta_sii(cuerpo: str, estado: str = "00", glosa: str = "") -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">'
        f"<SII:RESP_BODY>{cuerpo}</SII:RESP_BODY>"
        f"<SII:RESP_HDR><ESTADO>{estado}</ESTADO><GLOSA>{glosa}</GLOSA></SII:RESP_HDR></SII:RESPUESTA>"
    ).encode()


def _soap(metodo: str, interno: bytes) -> bytes:
    escapado = interno.decode().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (
        '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope '
        'xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>'
        f"<{metodo}Response><{metodo}Return>{escapado}</{metodo}Return></{metodo}Response>"
        "</soapenv:Body></soapenv:Envelope>"
    ).encode()


#: Formato confirmado el 2026-09-23: `leer_token` leyó sin problemas las respuestas
#: reales de maullin y apicert al pedir token con un certificado real. La
#: respuesta real no se guarda como fixture porque trae un token vivo.
TOKEN_OK = _respuesta_sii("<TOKEN>TOKENVALIDO123</TOKEN>")


def _upload(status: str, track: str = "0123456789") -> bytes:
    return (
        f"<?xml version='1.0' encoding='ISO-8859-1'?><RECEPCIONDTE><RUTSENDER>11111111-1</RUTSENDER>"
        f"<RUTCOMPANY>76543210-3</RUTCOMPANY><FILE>envio.xml</FILE><TIMESTAMP>2026-09-23 10:30:00</TIMESTAMP>"
        f"<STATUS>{status}</STATUS><TRACKID>{track}</TRACKID></RECEPCIONDTE>"
    ).encode()


def _estado(estado: str, aceptados=0, rechazados=0, reparos=0, glosa="") -> bytes:
    return _respuesta_sii(
        f"<TIPO_DOCTO>33</TIPO_DOCTO><INFORMADOS>1</INFORMADOS><ACEPTADOS>{aceptados}</ACEPTADOS>"
        f"<RECHAZADOS>{rechazados}</RECHAZADOS><REPAROS>{reparos}</REPAROS>",
        estado,
        glosa,
    )


# ---------------------------------------------------------------- parseos ---


def test_semilla_real_del_canal_dte() -> None:
    assert leer_semilla(desenvolver_soap(SEMILLA_SOAP, "getSeedReturn")) == "168441616904"


def test_semilla_real_del_canal_boletas() -> None:
    assert leer_semilla(SEMILLA_BOLETA) == "168441617038"


def test_token_rechazado_real_es_problema_de_autenticacion() -> None:
    """El SII dice "Error Interno", pero reintentar no lo arregla: es el certificado."""
    with pytest.raises(SiiAutenticacionError, match="certificado"):
        leer_token(TOKEN_RECHAZADO)


def test_token_no_existe_real() -> None:
    with pytest.raises(SiiTokenInvalidoError, match="TOKEN NO EXISTE"):
        leer_estado_dte(ESTADO_TOKEN_NO_EXISTE)


def test_upload_con_html_y_http_200_no_es_exito() -> None:
    """Sin sesión el SII responde 200 con HTML: el código HTTP no sirve."""
    with pytest.raises(SiiTokenInvalidoError):
        leer_upload_dte(UPLOAD_HTML)


def test_upload_exitoso() -> None:
    assert leer_upload_dte(_upload("0", "8765432")) == "8765432"


@pytest.mark.parametrize(
    ("status", "error"),
    [
        ("5", SiiTokenInvalidoError),
        ("7", SiiRechazoError),
        ("8", SiiRechazoError),
        ("1", SiiRechazoError),
        ("9", SiiNoDisponibleError),
        ("99", SiiNoDisponibleError),
    ],
)
def test_codigos_de_upload(status: str, error: type) -> None:
    with pytest.raises(error):
        leer_upload_dte(_upload(status))


@pytest.mark.parametrize(
    ("estado", "a", "r", "p", "esperado"),
    [
        ("REC", 0, 0, 0, Resultado.EN_PROCESO),
        ("SOK", 0, 0, 0, Resultado.EN_PROCESO),
        ("EPR", 1, 0, 0, Resultado.ACEPTADO),
        ("EPR", 0, 0, 1, Resultado.REPAROS),
        ("EPR", 0, 1, 0, Resultado.RECHAZADO),
        ("RPR", 0, 0, 1, Resultado.REPAROS),
        ("RSC", 0, 0, 0, Resultado.RECHAZADO),
        ("RFR", 0, 0, 0, Resultado.RECHAZADO),
        ("RCT", 0, 0, 0, Resultado.RECHAZADO),
        ("XYZ", 0, 0, 0, Resultado.EN_PROCESO),  # desconocido: se sigue consultando
    ],
)
def test_clasificacion_de_estados(estado, a, r, p, esperado) -> None:
    assert clasificar(estado, a, r, p) is esperado


def test_estado_aceptado_real() -> None:
    """La respuesta del SII al primer documento real que emitió este servicio."""
    estado = leer_estado_dte(ESTADO_ACEPTADO_REAL)
    assert estado.resultado is Resultado.ACEPTADO
    assert (estado.estado, estado.glosa) == ("EPR", "Envio Procesado")
    assert (estado.informados, estado.aceptados, estado.rechazados, estado.reparos) == (1, 1, 0, 0)


def test_estado_dte_procesado() -> None:
    estado = leer_estado_dte(_estado("EPR", aceptados=1, glosa="Envio Procesado"))
    assert estado.resultado is Resultado.ACEPTADO
    assert (estado.informados, estado.aceptados) == (1, 1)
    assert "EPR" in estado.crudo  # la respuesta cruda se guarda para diagnóstico


def test_estado_boleta_suma_la_estadistica() -> None:
    cuerpo = json.dumps(
        {
            "estado": "EPR",
            "estadistica": [{"tipo": 39, "informados": 1, "aceptados": 1, "rechazados": 0, "reparos": 0}],
        }
    ).encode()
    assert leer_estado_boleta(cuerpo).resultado is Resultado.ACEPTADO


# ---------------------------------------------------------------- cliente ---


@pytest.fixture(scope="module")
def cert():
    """Certificado de la representante: RUT distinto al de la empresa."""
    return parsear_pfx(pfx(rut="11111111-1"), CLAVE_PFX)


class SiiFalso:
    """Imita al SII por URL y método SOAP, y registra cada llamada."""

    def __init__(self) -> None:
        self.llamadas: list[str] = []
        self.token = TOKEN_OK
        self.estados: list[bytes] = [_estado("EPR", aceptados=1)]
        self.uploads: list[tuple[int, bytes]] = [(200, _upload("0"))]
        self.pedidos: list[httpx.Request] = []

    def __call__(self, pedido: httpx.Request) -> httpx.Response:
        self.pedidos.append(pedido)
        url = str(pedido.url)
        cuerpo = pedido.content
        if url.endswith("CrSeed.jws"):
            self.llamadas.append("semilla")
            return httpx.Response(200, content=SEMILLA_SOAP)
        if url.endswith("GetTokenFromSeed.jws"):
            self.llamadas.append("token")
            return httpx.Response(200, content=_soap("getToken", self.token))
        if url.endswith("QueryEstUp.jws"):
            self.llamadas.append("estado")
            return httpx.Response(200, content=_soap("getEstUp", self.estados.pop(0)))
        if url.endswith("DTEUpload"):
            self.llamadas.append("upload")
            status, contenido = self.uploads.pop(0)
            return httpx.Response(status, content=contenido)
        raise AssertionError(f"URL inesperada: {url} {cuerpo[:80]!r}")


def _cliente(sii: SiiFalso, redis) -> ClienteSii:
    http = httpx.AsyncClient(transport=httpx.MockTransport(sii))
    return ClienteSii(http, redis, ambiente="CERT", ttl_token=600)


async def test_el_token_se_pide_con_la_semilla_firmada(cert, redis_limpio) -> None:
    sii = SiiFalso()
    token = await _cliente(sii, redis_limpio).obtener_token(Canal.DTE, uuid.uuid4(), cert)

    assert token == "TOKENVALIDO123"
    assert sii.llamadas == ["semilla", "token"]

    # Lo que viajó en pszXml es un getToken con la semilla recibida, bien firmado.
    pedido = sii.pedidos[1].content
    firmado = re.search(rb"<!\[CDATA\[(.*)\]\]>", pedido, re.S).group(1)
    raiz = etree.fromstring(firmado)
    assert raiz.findtext("item/Semilla") == "168441616904"
    ctx = xmlsec.SignatureContext()
    ctx.key = xmlsec.Key.from_memory(cert.cert_pem, xmlsec.KeyFormat.CERT_PEM)
    ctx.verify(raiz.find(f"{{{xmlsec.constants.DSigNs}}}Signature"))


async def test_el_token_se_cachea_en_redis(cert, redis_limpio) -> None:
    sii = SiiFalso()
    cliente = _cliente(sii, redis_limpio)
    tenant = uuid.uuid4()

    await cliente.obtener_token(Canal.DTE, tenant, cert)
    await cliente.obtener_token(Canal.DTE, tenant, cert)

    assert sii.llamadas == ["semilla", "token"]  # la segunda vez, del caché


async def test_el_cache_es_por_tenant(cert, redis_limpio) -> None:
    sii = SiiFalso()
    cliente = _cliente(sii, redis_limpio)

    await cliente.obtener_token(Canal.DTE, uuid.uuid4(), cert)
    await cliente.obtener_token(Canal.DTE, uuid.uuid4(), cert)

    assert sii.llamadas.count("token") == 2


async def test_token_rechazado_no_queda_en_cache(cert, redis_limpio) -> None:
    sii = SiiFalso()
    sii.token = TOKEN_RECHAZADO

    with pytest.raises(SiiAutenticacionError):
        await _cliente(sii, redis_limpio).obtener_token(Canal.DTE, uuid.uuid4(), cert)
    assert await redis_limpio.dbsize() == 0


async def test_token_vencido_se_renueva_una_vez(cert, redis_limpio) -> None:
    """El SII invalida el token antes de lo esperado: se pide otro y se reintenta."""
    sii = SiiFalso()
    sii.estados = [ESTADO_TOKEN_NO_EXISTE, _estado("EPR", aceptados=1)]

    estado = await _cliente(sii, redis_limpio).consultar(
        Canal.DTE, uuid.uuid4(), cert, "76543210-3", "123"
    )

    assert estado.resultado is Resultado.ACEPTADO
    assert sii.llamadas == ["semilla", "token", "estado", "semilla", "token", "estado"]


async def test_el_envio_distingue_empresa_y_quien_envia(cert, redis_limpio) -> None:
    """rutSender es la persona del certificado; rutCompany, la empresa."""
    sii = SiiFalso()
    track = await _cliente(sii, redis_limpio).enviar(
        Canal.DTE, uuid.uuid4(), cert, "76543210-3", b"<EnvioDTE/>", "envio.xml"
    )

    assert track == "0123456789"
    subida = sii.pedidos[-1]
    cuerpo = subida.content
    for campo, valor in [("rutSender", b"11111111"), ("dvSender", b"1"), ("rutCompany", b"76543210"), ("dvCompany", b"3")]:
        assert re.search(rf'name="{campo}"\r\n\r\n'.encode() + valor + b"\r\n", cuerpo), campo
    assert b'filename="envio.xml"' in cuerpo
    assert subida.headers["Cookie"] == "TOKEN=TOKENVALIDO123"
    assert "YComp" in subida.headers["User-Agent"]


async def test_sin_sesion_se_reintenta_una_sola_vez(cert, redis_limpio) -> None:
    sii = SiiFalso()
    sii.uploads = [(200, UPLOAD_HTML), (200, UPLOAD_HTML)]

    with pytest.raises(SiiTokenInvalidoError):
        await _cliente(sii, redis_limpio).enviar(Canal.DTE, uuid.uuid4(), cert, "76543210-3", b"x", "e.xml")
    assert sii.llamadas.count("upload") == 2


async def test_un_rechazo_no_se_reintenta(cert, redis_limpio) -> None:
    """El mismo sobre va a ser rechazado de nuevo: reintentar solo gasta tiempo."""
    sii = SiiFalso()
    sii.uploads = [(200, _upload("7"))]

    with pytest.raises(SiiRechazoError, match="esquema"):
        await _cliente(sii, redis_limpio).enviar(Canal.DTE, uuid.uuid4(), cert, "76543210-3", b"x", "e.xml")
    assert sii.llamadas.count("upload") == 1


async def test_sii_caido_es_transitorio(cert, redis_limpio) -> None:
    def caido(pedido: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("sin red", request=pedido)

    cliente = ClienteSii(httpx.AsyncClient(transport=httpx.MockTransport(caido)), redis_limpio, "CERT", 600)
    with pytest.raises(SiiNoDisponibleError):
        await cliente.obtener_token(Canal.DTE, uuid.uuid4(), cert)


async def test_error_500_es_transitorio(cert, redis_limpio) -> None:
    cliente = ClienteSii(
        httpx.AsyncClient(transport=httpx.MockTransport(lambda p: httpx.Response(503))),
        redis_limpio,
        "CERT",
        600,
    )
    with pytest.raises(SiiNoDisponibleError):
        await cliente.obtener_token(Canal.DTE, uuid.uuid4(), cert)


async def test_certificado_sin_rut_no_puede_enviar(redis_limpio) -> None:
    sin_rut = parsear_pfx(pfx(rut=None), CLAVE_PFX)
    with pytest.raises(SiiAutenticacionError, match="rutSender"):
        await _cliente(SiiFalso(), redis_limpio).enviar(
            Canal.DTE, uuid.uuid4(), sin_rut, "76543210-3", b"x", "e.xml"
        )


# ----------------------------------------------------------------- boletas --


async def test_flujo_de_boletas(cert, redis_limpio) -> None:
    """Semilla y token en XML, envío y consulta en JSON, y renovación por 401."""
    llamadas: list[str] = []
    consultas = [httpx.Response(401, text="Error de Permiso"), None]

    def sii(pedido: httpx.Request) -> httpx.Response:
        url = str(pedido.url)
        if url.endswith("semilla"):
            llamadas.append("semilla")
            return httpx.Response(200, content=SEMILLA_BOLETA)
        if url.endswith("token"):
            llamadas.append("token")
            assert b"<Semilla>168441617038</Semilla>" in pedido.content
            return httpx.Response(200, content=TOKEN_OK)
        if pedido.method == "POST" and url.endswith("boleta.electronica.envio"):
            llamadas.append("envio")
            return httpx.Response(200, json={"trackid": 5550001, "estado": "REC"})
        if "boleta.electronica.envio/76543210-3-5550001" in url:
            llamadas.append("estado")
            respuesta = consultas.pop(0)
            return respuesta or httpx.Response(
                200,
                json={"estado": "EPR", "estadistica": [{"tipo": 39, "informados": 1, "aceptados": 1}]},
            )
        raise AssertionError(url)

    cliente = ClienteSii(httpx.AsyncClient(transport=httpx.MockTransport(sii)), redis_limpio, "CERT", 600)
    tenant = uuid.uuid4()

    track = await cliente.enviar(Canal.BOLETA, tenant, cert, "76543210-3", b"<EnvioBOLETA/>", "b.xml")
    estado = await cliente.consultar(Canal.BOLETA, tenant, cert, "76543210-3", track)

    assert track == "5550001"
    assert estado.resultado is Resultado.ACEPTADO
    assert llamadas == ["semilla", "token", "envio", "estado", "semilla", "token", "estado"]
