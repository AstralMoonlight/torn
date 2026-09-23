"""Cliente del SII: semilla, token, envío y consulta de estado (issue #21).

Hay dos canales con protocolos distintos:

- **DTE** (facturas, notas): servicios SOAP de Axis 1 (`*.jws`) para semilla,
  token y consulta, y un CGI con multipart para subir el sobre.
- **BOLETA**: API REST, con XML para semilla y token y JSON para envío y consulta.

Formatos verificados contra el SII real (2026-09-23), y usados como fixtures en
`tests/test_sii_client.py`: la semilla de ambos canales, el error de `getToken`
con firma inválida (`ESTADO 10`), el de `getEstUp` con token inválido
(`ESTADO 001`, "TOKEN NO EXISTE"), el 401 de la consulta de boletas y la página
HTML que devuelve `DTEUpload` con **HTTP 200** cuando no hay sesión. Esto último
es la razón por la que acá nunca se confía en el código HTTP para saber si una
subida funcionó: se lee el cuerpo.

Los errores salen clasificados según qué debe hacer quien llama, que es lo que
necesita la capa de colas:

- `SiiNoDisponibleError`: transitorio. Reintentar con espera.
- `SiiTokenInvalidoError`: el token se rechazó al usarlo. El cliente ya pidió
  uno nuevo y reintentó una vez; si llega hasta afuera, volvió a fallar.
- `SiiAutenticacionError`: no se pudo obtener token. Casi siempre es el
  certificado (vencido, sin permiso para esa empresa). No se arregla solo.
- `SiiRechazoError`: el SII rechazó el envío (esquema, firma, permisos). No
  reintentar: el mismo sobre va a ser rechazado de nuevo.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import TypeVar

import httpx
from lxml import etree
from redis.asyncio import Redis

from app.core.certificados import CertificadoCargado
from app.dte.signer import firmar_semilla

T = TypeVar("T")

#: El CGI de subida del SII históricamente exige este User-Agent. Es el que
#: documenta el propio SII en su manual de upload.
USER_AGENT = "Mozilla/4.0 (compatible; PROG 1.0; Windows NT 5.0; YComp 5.0.2.4)"


class Canal(StrEnum):
    DTE = "DTE"
    BOLETA = "BOLETA"


@dataclass(frozen=True, slots=True)
class Endpoints:
    semilla: str
    token: str
    envio: str
    estado: str


#: Verificados contra el SII el 2026-09-23. maullin/apicert/pangal son
#: certificación; palena/api/rahue son producción.
ENDPOINTS: dict[tuple[str, Canal], Endpoints] = {
    ("CERT", Canal.DTE): Endpoints(
        semilla="https://maullin.sii.cl/DTEWS/CrSeed.jws",
        token="https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws",
        envio="https://maullin.sii.cl/cgi_dte/UPL/DTEUpload",
        estado="https://maullin.sii.cl/DTEWS/QueryEstUp.jws",
    ),
    ("PROD", Canal.DTE): Endpoints(
        semilla="https://palena.sii.cl/DTEWS/CrSeed.jws",
        token="https://palena.sii.cl/DTEWS/GetTokenFromSeed.jws",
        envio="https://palena.sii.cl/cgi_dte/UPL/DTEUpload",
        estado="https://palena.sii.cl/DTEWS/QueryEstUp.jws",
    ),
    ("CERT", Canal.BOLETA): Endpoints(
        semilla="https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla",
        token="https://apicert.sii.cl/recursos/v1/boleta.electronica.token",
        envio="https://pangal.sii.cl/recursos/v1/boleta.electronica.envio",
        estado="https://apicert.sii.cl/recursos/v1/boleta.electronica.envio",
    ),
    ("PROD", Canal.BOLETA): Endpoints(
        semilla="https://api.sii.cl/recursos/v1/boleta.electronica.semilla",
        token="https://api.sii.cl/recursos/v1/boleta.electronica.token",
        envio="https://rahue.sii.cl/recursos/v1/boleta.electronica.envio",
        estado="https://api.sii.cl/recursos/v1/boleta.electronica.envio",
    ),
}


# ----------------------------------------------------------------- errores --


class SiiError(Exception):
    """Error del SII, con el código y la respuesta cruda para diagnóstico."""

    def __init__(self, mensaje: str, estado: str | None = None, respuesta: str | None = None) -> None:
        super().__init__(mensaje)
        self.estado = estado
        self.respuesta = respuesta


class SiiNoDisponibleError(SiiError):
    """Transitorio: red, timeout, 5xx, sistema bloqueado. Reintentar."""


class SiiTokenInvalidoError(SiiError):
    """El token fue rechazado al usarlo."""


class SiiAutenticacionError(SiiError):
    """No se pudo obtener token: casi siempre, problema del certificado."""


class SiiRechazoError(SiiError):
    """El SII rechazó el envío. Reintentar el mismo sobre no sirve."""


# ---------------------------------------------------------------- estados ---


class Resultado(StrEnum):
    EN_PROCESO = "EN_PROCESO"
    ACEPTADO = "ACEPTADO"
    REPAROS = "REPAROS"
    RECHAZADO = "RECHAZADO"


#: Estados del envío. Los intermedios dicen que el SII todavía está revisando.
EN_PROCESO = frozenset({"REC", "SOK", "CRT", "FOK", "PDR", "PRD"})
#: Rechazo del envío completo: esquema, firma o carátula.
RECHAZO_TOTAL = frozenset({"RSC", "RFR", "RCT", "RCH"})
#: Procesado: el resultado por documento está en los conteos.
PROCESADO = frozenset({"EPR", "RPR"})


@dataclass(frozen=True, slots=True)
class EstadoEnvio:
    estado: str
    glosa: str | None
    informados: int
    aceptados: int
    rechazados: int
    reparos: int
    resultado: Resultado
    crudo: str


def clasificar(estado: str, aceptados: int, rechazados: int, reparos: int) -> Resultado:
    """Traduce el estado del envío a lo que le pasa al documento.

    Supone un documento por envío, que es como opera este servicio (ver
    DESIGN.md §2, `envios`). Con varios, los conteos no dicen **cuál** fue
    rechazado y habría que consultar documento por documento.

    Un estado desconocido se trata como "en proceso": se sigue consultando, y
    el tope de consultas de la capa de colas lo termina mandando a revisión
    manual con la respuesta cruda guardada.
    """
    if estado in RECHAZO_TOTAL:
        return Resultado.RECHAZADO
    if estado in PROCESADO:
        if rechazados:
            return Resultado.RECHAZADO
        if reparos:
            return Resultado.REPAROS
        if aceptados:
            return Resultado.ACEPTADO
    return Resultado.EN_PROCESO


# ---------------------------------------------------------------- parseos ---
#
# Funciones puras: bytes de respuesta → dato o excepción clasificada. Se prueban
# contra respuestas reales del SII sin tocar la red.


def _xml(contenido: bytes, que: str) -> etree._Element:
    try:
        return etree.fromstring(contenido)
    except etree.XMLSyntaxError as exc:
        raise SiiNoDisponibleError(
            f"Respuesta de {que} que no es XML", respuesta=contenido[:500].decode("latin-1")
        ) from exc


def _local(raiz: etree._Element, nombre: str) -> etree._Element | None:
    """Busca un nodo por nombre local, ignorando prefijos (`SII:`, `soapenv:`)."""
    for nodo in raiz.iter():
        if isinstance(nodo.tag, str) and etree.QName(nodo).localname == nombre:
            return nodo
    return None


def _texto(raiz: etree._Element, nombre: str) -> str | None:
    nodo = _local(raiz, nombre)
    return nodo.text.strip() if nodo is not None and nodo.text else None


def desenvolver_soap(contenido: bytes, retorno: str) -> bytes:
    """Saca el XML de negocio que Axis devuelve escapado dentro del sobre SOAP.

    El `<getSeedReturn>` trae como **texto** otro documento XML, con su propia
    declaración `encoding="UTF-8"`. Se devuelve como bytes UTF-8: lxml rechaza
    parsear un `str` que traiga declaración de encoding.
    """
    raiz = _xml(contenido, retorno)
    nodo = _local(raiz, retorno)
    if nodo is None or not nodo.text:
        raise SiiNoDisponibleError(
            f"Respuesta SOAP sin {retorno}", respuesta=contenido[:500].decode("latin-1")
        )
    return nodo.text.strip().encode("utf-8")


def _respuesta_sii(contenido: bytes, que: str) -> tuple[etree._Element, str | None, str | None]:
    raiz = _xml(contenido, que)
    return raiz, _texto(raiz, "ESTADO"), _texto(raiz, "GLOSA")


def leer_semilla(contenido: bytes) -> str:
    """Semilla desde un `<SII:RESPUESTA>`: la de boletas directa, la de DTE ya
    desenvuelta del SOAP."""
    raiz, estado, glosa = _respuesta_sii(contenido, "semilla")
    semilla = _texto(raiz, "SEMILLA")
    if estado != "00" or not semilla:
        raise SiiNoDisponibleError(f"El SII no entregó semilla: {glosa}", estado, contenido.decode("utf-8", "replace"))
    return semilla


def leer_token(contenido: bytes) -> str:
    """Token desde un `<SII:RESPUESTA>`.

    Un estado distinto de `00` al pedir el token casi siempre es la firma de la
    semilla: certificado vencido, no autorizado, o firma mal formada. El SII lo
    informa como "Error Interno" (`ESTADO 10`), que confunde; por eso se
    clasifica como problema de autenticación y no como caída del SII.
    """
    raiz, estado, glosa = _respuesta_sii(contenido, "token")
    token = _texto(raiz, "TOKEN")
    if estado != "00" or not token:
        raise SiiAutenticacionError(
            f"El SII no entregó token (estado {estado}: {glosa}). Revisar que el "
            "certificado esté vigente y autorizado para operar por la empresa.",
            estado,
            contenido.decode("utf-8", "replace"),
        )
    return token


#: Códigos de `<STATUS>` de `DTEUpload`, según el manual de upload del SII.
_UPLOAD_TOKEN = {"5"}              # no autenticado
_UPLOAD_TRANSITORIO = {"9"}        # sistema bloqueado
_UPLOAD_RECHAZO = {
    "1": "el que envía no tiene permiso para enviar por esta empresa",
    "2": "error en el tamaño del archivo",
    "3": "archivo cortado",
    "6": "la empresa no está autorizada a enviar archivos",
    "7": "el sobre no cumple el esquema",
    "8": "error en la firma del documento",
}


def leer_upload_dte(contenido: bytes) -> str:
    """Track ID de la respuesta de `DTEUpload`.

    Sin sesión, el SII contesta HTTP 200 con una **página HTML** de error, no
    con XML. Se trata como token inválido: fuerza pedir uno nuevo y reintentar
    una vez.
    """
    try:
        raiz = etree.fromstring(contenido)
    except etree.XMLSyntaxError:
        raiz = None
    if raiz is None or etree.QName(raiz).localname != "RECEPCIONDTE":
        raise SiiTokenInvalidoError(
            "DTEUpload no devolvió RECEPCIONDTE (típicamente: sin sesión)",
            respuesta=contenido[:500].decode("latin-1"),
        )

    status = _texto(raiz, "STATUS")
    track = _texto(raiz, "TRACKID")
    crudo = contenido.decode("latin-1")
    if status == "0" and track:
        return track
    if status in _UPLOAD_TOKEN:
        raise SiiTokenInvalidoError("DTEUpload: no autenticado", status, crudo)
    if status in _UPLOAD_RECHAZO:
        raise SiiRechazoError(f"Envío rechazado: {_UPLOAD_RECHAZO[status]}", status, crudo)
    if status in _UPLOAD_TRANSITORIO:
        raise SiiNoDisponibleError("DTEUpload: sistema del SII bloqueado", status, crudo)
    raise SiiNoDisponibleError(f"DTEUpload: estado {status} no reconocido", status, crudo)


def leer_estado_dte(contenido: bytes) -> EstadoEnvio:
    """Estado del envío desde `getEstUp` (ya desenvuelto).

    `001` es "TOKEN NO EXISTE" (verificado contra el SII). Otros códigos
    numéricos son errores de la consulta, no del envío: se tratan como
    transitorios porque justo después de subir, el SII puede aún no conocer el
    track ID.
    """
    raiz, estado, glosa = _respuesta_sii(contenido, "estado")
    crudo = contenido.decode("utf-8", "replace")
    if estado == "001":
        raise SiiTokenInvalidoError(f"getEstUp: {glosa}", estado, crudo)
    if not estado or estado.lstrip("-").isdigit():
        raise SiiNoDisponibleError(f"getEstUp: {glosa} (estado {estado})", estado, crudo)

    def numero(tag: str) -> int:
        return int(_texto(raiz, tag) or 0)

    aceptados, rechazados, reparos = numero("ACEPTADOS"), numero("RECHAZADOS"), numero("REPAROS")
    return EstadoEnvio(
        estado=estado,
        glosa=glosa,
        informados=numero("INFORMADOS"),
        aceptados=aceptados,
        rechazados=rechazados,
        reparos=reparos,
        resultado=clasificar(estado, aceptados, rechazados, reparos),
        crudo=crudo,
    )


def leer_upload_boleta(contenido: bytes) -> str:
    """Track ID de la respuesta JSON del envío de boletas."""
    try:
        datos = json.loads(contenido)
        return str(datos["trackid"])
    except (ValueError, KeyError, TypeError) as exc:
        raise SiiNoDisponibleError(
            "Envío de boleta sin trackid", respuesta=contenido[:500].decode("utf-8", "replace")
        ) from exc


def leer_estado_boleta(contenido: bytes) -> EstadoEnvio:
    """Estado del envío de boletas, desde la respuesta JSON."""
    crudo = contenido.decode("utf-8", "replace")
    try:
        datos = json.loads(contenido)
        estado = str(datos["estado"])
    except (ValueError, KeyError, TypeError) as exc:
        raise SiiNoDisponibleError("Consulta de boleta sin estado", respuesta=crudo[:500]) from exc

    filas = datos.get("estadistica") or []
    total = {k: sum(int(f.get(k) or 0) for f in filas) for k in ("informados", "aceptados", "rechazados", "reparos")}
    return EstadoEnvio(
        estado=estado,
        glosa=datos.get("glosa"),
        informados=total["informados"],
        aceptados=total["aceptados"],
        rechazados=total["rechazados"],
        reparos=total["reparos"],
        resultado=clasificar(estado, total["aceptados"], total["rechazados"], total["reparos"]),
        crudo=crudo,
    )


def _separar_rut(rut: str) -> tuple[str, str]:
    cuerpo, dv = rut.split("-")
    return cuerpo, dv


def _soap(metodo: str, parametros: str) -> bytes:
    return (
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
        f"<soapenv:Body><{metodo}>{parametros}</{metodo}></soapenv:Body></soapenv:Envelope>"
    ).encode("utf-8")


# ----------------------------------------------------------------- cliente --


class ClienteSii:
    """Habla con el SII en nombre de un tenant.

    El token se cachea en Redis por tenant, canal y certificado. No es fuente de
    verdad de nada: si Redis se pierde, se pide otro.

    Args:
        http: Cliente HTTP. Inyectado para poder probar con `httpx.MockTransport`.
        redis: Donde se cachea el token.
        ambiente: "CERT" o "PROD", el del tenant.
        ttl_token: Segundos que se reusa un token. Por debajo de su vigencia real;
            si el SII lo invalida antes, el reintento por token inválido lo cubre.
    """

    def __init__(self, http: httpx.AsyncClient, redis: Redis, ambiente: str, ttl_token: int) -> None:
        self.http = http
        self.redis = redis
        self.ambiente = ambiente
        self.ttl_token = ttl_token

    def _ep(self, canal: Canal) -> Endpoints:
        return ENDPOINTS[(self.ambiente, canal)]

    async def _pedir(self, metodo: str, url: str, **kwargs) -> httpx.Response:
        try:
            respuesta = await self.http.request(metodo, url, **kwargs)
        except httpx.TransportError as exc:
            raise SiiNoDisponibleError(f"Sin conexión con el SII: {exc!r}") from exc
        if respuesta.status_code >= 500:
            raise SiiNoDisponibleError(
                f"El SII respondió {respuesta.status_code}", str(respuesta.status_code), respuesta.text[:500]
            )
        return respuesta

    async def _pedir_soap(self, url: str, metodo: str, parametros: str) -> bytes:
        respuesta = await self._pedir(
            "POST",
            url,
            content=_soap(metodo, parametros),
            headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": '""'},
        )
        return desenvolver_soap(respuesta.content, f"{metodo}Return")

    # -- token ------------------------------------------------------------

    def _clave_token(self, canal: Canal, tenant_id: uuid.UUID, cert: CertificadoCargado) -> str:
        # El certificado es parte de la clave: si la empresa sube uno nuevo, el
        # token del anterior deja de usarse solo.
        return f"dte:token:{tenant_id}:{self.ambiente}:{canal}:{cert.fingerprint_sha256[:16]}"

    async def obtener_token(
        self, canal: Canal, tenant_id: uuid.UUID, cert: CertificadoCargado, forzar: bool = False
    ) -> str:
        """Token del caché, o uno nuevo: semilla → firma → token."""
        clave = self._clave_token(canal, tenant_id, cert)
        if not forzar:
            guardado = await self.redis.get(clave)
            if guardado:
                return guardado.decode() if isinstance(guardado, bytes) else guardado

        ep = self._ep(canal)
        if canal is Canal.DTE:
            semilla = leer_semilla(await self._pedir_soap(ep.semilla, "getSeed", ""))
            firmado = firmar_semilla(semilla, cert).decode("utf-8")
            token = leer_token(
                await self._pedir_soap(ep.token, "getToken", f"<pszXml><![CDATA[{firmado}]]></pszXml>")
            )
        else:
            semilla = leer_semilla((await self._pedir("GET", ep.semilla)).content)
            respuesta = await self._pedir(
                "POST", ep.token, content=firmar_semilla(semilla, cert),
                headers={"Content-Type": "application/xml"},
            )
            token = leer_token(respuesta.content)

        # Dos workers pidiendo token a la vez es inofensivo: el SII entrega dos
        # válidos y el último en escribir gana.
        await self.redis.set(clave, token, ex=self.ttl_token)
        return token

    async def _con_token(
        self,
        canal: Canal,
        tenant_id: uuid.UUID,
        cert: CertificadoCargado,
        operacion: Callable[[str], Awaitable[T]],
    ) -> T:
        """Ejecuta con el token cacheado; si el SII lo rechaza, pide otro una vez.

        Reintentar una subida acá es seguro: si el token fue rechazado, el SII
        no aceptó el sobre y no hay track ID que duplicar.
        """
        token = await self.obtener_token(canal, tenant_id, cert)
        try:
            return await operacion(token)
        except SiiTokenInvalidoError:
            token = await self.obtener_token(canal, tenant_id, cert, forzar=True)
            return await operacion(token)

    # -- envío ------------------------------------------------------------

    async def enviar(
        self,
        canal: Canal,
        tenant_id: uuid.UUID,
        cert: CertificadoCargado,
        rut_emisor: str,
        sobre: bytes,
        nombre_archivo: str,
    ) -> str:
        """Sube un sobre firmado y devuelve el track ID.

        `rutSender` es el titular del certificado (quien firma y envía) y
        `rutCompany` es la empresa: en general son RUT distintos.
        """
        if not cert.rut:
            raise SiiAutenticacionError(
                "El certificado no trae el RUT de su titular; el SII lo necesita como rutSender"
            )
        ep = self._ep(canal)
        rut_sender, dv_sender = _separar_rut(cert.rut)
        rut_company, dv_company = _separar_rut(rut_emisor)
        campos = {
            "rutSender": rut_sender,
            "dvSender": dv_sender,
            "rutCompany": rut_company,
            "dvCompany": dv_company,
        }

        async def subir(token: str) -> str:
            respuesta = await self._pedir(
                "POST",
                ep.envio,
                data=campos,
                files={"archivo": (nombre_archivo, sobre, "application/octet-stream")},
                headers={"Cookie": f"TOKEN={token}", "User-Agent": USER_AGENT},
            )
            if canal is Canal.DTE:
                return leer_upload_dte(respuesta.content)
            if respuesta.status_code == 401 or (
                respuesta.status_code == 400 and b"TOKEN" in respuesta.content[:100]
            ):
                raise SiiTokenInvalidoError("Envío de boleta sin sesión", str(respuesta.status_code), respuesta.text[:500])
            if respuesta.status_code >= 400:
                raise SiiRechazoError(f"Envío de boleta rechazado: {respuesta.text[:200]}", str(respuesta.status_code), respuesta.text)
            return leer_upload_boleta(respuesta.content)

        return await self._con_token(canal, tenant_id, cert, subir)

    # -- consulta ---------------------------------------------------------

    async def consultar(
        self,
        canal: Canal,
        tenant_id: uuid.UUID,
        cert: CertificadoCargado,
        rut_emisor: str,
        track_id: str,
    ) -> EstadoEnvio:
        """Consulta en qué va un envío."""
        ep = self._ep(canal)
        rut, dv = _separar_rut(rut_emisor)

        async def preguntar(token: str) -> EstadoEnvio:
            if canal is Canal.DTE:
                return leer_estado_dte(
                    await self._pedir_soap(
                        ep.estado,
                        "getEstUp",
                        f"<RutCompania>{rut}</RutCompania><DvCompania>{dv}</DvCompania>"
                        f"<TrackId>{track_id}</TrackId><Token>{token}</Token>",
                    )
                )
            respuesta = await self._pedir(
                "GET",
                f"{ep.estado}/{rut}-{dv}-{track_id}",
                headers={"Cookie": f"TOKEN={token}", "Accept": "application/json"},
            )
            if respuesta.status_code == 401:
                raise SiiTokenInvalidoError("Consulta de boleta: token rechazado", "401", respuesta.text[:200])
            return leer_estado_boleta(respuesta.content)

        return await self._con_token(canal, tenant_id, cert, preguntar)


def crear_http(timeout: float) -> httpx.AsyncClient:
    """Cliente HTTP para hablar con el SII."""
    return httpx.AsyncClient(timeout=timeout, headers={"User-Agent": USER_AGENT})
