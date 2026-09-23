"""Los pasos de vida de un documento: firmar, enviar, consultar.

Es la orquestación que ejecutan los workers, sin ninguna dependencia de la
librería de colas: `tasks/` solo decide **cuándo** llamar a estas funciones.
El script de diagnóstico de certificación las llama en secuencia, así que lo
que se prueba contra el SII es exactamente lo que corre en producción.

Cada paso es idempotente y empieza **reclamando** el documento con un
`UPDATE ... WHERE estado = <el esperado>`. Si no afecta filas, otro worker ya lo
hizo o el documento está en otro estado, y el paso termina sin hacer nada. La
fuente de verdad es Postgres; Redis puede perderse.

Los reintentos también viven acá y no en la cola: un fallo transitorio deja el
documento en su estado anterior con `next_action_at` en el futuro, y la
reconciliación lo vuelve a encolar cuando toca. Después de `MAX_INTENTOS`, o
ante un error que no se arregla reintentando, va a `ERROR` con una fila en
`dead_letters` para revisión manual.
"""

from __future__ import annotations

import asyncio
import hashlib
import multiprocessing
import traceback
import uuid
from collections.abc import Callable
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from pydantic import ValidationError
from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.almacen import Almacen, IntegridadError, clave_dte, clave_envio
from app.core.certificados import (
    CertificadoCargado,
    CertificadoInvalidoError,
    CertificadoVencidoError,
    SinCertificadoError,
    cargar_certificado,
)
from app.db import tenant_session
from app.dte.builder import BOLETAS, DatosDocumento, Emisor, construir_dte
from app.dte.caf import CafInvalidoError, CafParseado, abrir_caf
from app.dte.signer import DocumentoFirmado, FirmaInvalidaError, ZONA_CHILE, firmar_dte, firmar_sobre
from app.dte.sii_client import (
    Canal,
    ClienteSii,
    Resultado,
    SiiAutenticacionError,
    SiiError,
    SiiNoDisponibleError,
    SiiRechazoError,
)
from app.models import AuditLog, DeadLetter, Document, Envio, EstadoDocumento, EstadoEnvio, Tenant

E = EstadoDocumento

MAX_INTENTOS = 6
#: Espera antes de reintentar un paso que falló, por intento.
ESPERA_REINTENTO = (30, 120, 600, 1800, 3600)
#: Espera entre consultas de estado al SII, por consulta ya hecha.
ESPERA_CONSULTA = (30, 60, 300, 900, 3600)
#: Pasado este plazo sin resultado del SII, el documento va a revisión manual.
TOPE_CONSULTAS = timedelta(hours=24)

#: Errores que no se arreglan reintentando: hace falta una persona.
PERMANENTES = (
    ValidationError,
    ValueError,
    FirmaInvalidaError,
    CafInvalidoError,
    CertificadoInvalidoError,
    CertificadoVencidoError,
    SinCertificadoError,
    SiiAutenticacionError,
    SiiRechazoError,
    # El XML en S3 no calza con su hash: algo lo alteró. Nunca reintentar
    # a ciegas sobre un documento tributario corrupto.
    IntegridadError,
)


@dataclass
class Contexto:
    """Dependencias compartidas por los pasos. Una por proceso de worker."""

    http: httpx.AsyncClient
    redis: Redis
    almacen: Almacen
    ttl_token: int = 1800
    #: Pool de procesos para la firma (CPU). None firma en el mismo proceso.
    ejecutor: Executor | None = None

    def sii(self, ambiente: str) -> ClienteSii:
        return ClienteSii(self.http, self.redis, ambiente, self.ttl_token)


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _espera(tabla: tuple[int, ...], n: int) -> timedelta:
    return timedelta(seconds=tabla[min(n, len(tabla) - 1)])


def canal_de(tipo_dte: int) -> Canal:
    return Canal.BOLETA if tipo_dte in BOLETAS else Canal.DTE


# -------------------------------------------------------------- helpers BD --


async def _reclamar(tenant_id: uuid.UUID, doc_id: uuid.UUID, desde: E, hacia: E) -> str | None:
    """Pasa el documento de `desde` a `hacia` si sigue en `desde`.

    Returns:
        None si lo reclamó; si no, el estado en que está (para que el llamador
        sepa por qué no hizo nada).
    """
    async with tenant_session(tenant_id) as s:
        reclamado = (
            await s.execute(
                update(Document)
                .where(Document.id == doc_id, Document.estado == desde)
                .values(estado=hacia, intentos=Document.intentos + 1, updated_at=_ahora())
                .returning(Document.id)
            )
        ).scalar_one_or_none()
        if reclamado is not None:
            return None
        return (await s.execute(select(Document.estado).where(Document.id == doc_id))).scalar_one()


async def _cargar(s: AsyncSession, tenant_id: uuid.UUID, doc_id: uuid.UUID) -> tuple[Document, Tenant]:
    doc = (await s.execute(select(Document).where(Document.id == doc_id))).scalar_one()
    tenant = (await s.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
    return doc, tenant


async def _fallar(
    tenant_id: uuid.UUID,
    doc_id: uuid.UUID,
    volver_a: E,
    cola: str,
    exc: BaseException,
    permanente: bool | None = None,
) -> str:
    """Registra el fallo de un paso y decide entre reintento y revisión manual."""
    if permanente is None:
        permanente = isinstance(exc, PERMANENTES)
    async with tenant_session(tenant_id) as s:
        intentos = (
            await s.execute(select(Document.intentos).where(Document.id == doc_id))
        ).scalar_one()
        if permanente or intentos >= MAX_INTENTOS:
            await s.execute(
                update(Document)
                .where(Document.id == doc_id)
                .values(estado=E.ERROR, last_error=str(exc)[:2000], next_action_at=None)
            )
            s.add(
                DeadLetter(
                    tenant_id=tenant_id,
                    document_id=doc_id,
                    cola=cola,
                    error=f"{type(exc).__name__}: {exc}"[:4000],
                    traceback="".join(traceback.format_exception(exc))[-8000:],
                    intentos=intentos,
                )
            )
            return E.ERROR
        await s.execute(
            update(Document)
            .where(Document.id == doc_id)
            .values(
                estado=volver_a,
                last_error=str(exc)[:2000],
                next_action_at=_ahora() + _espera(ESPERA_REINTENTO, intentos - 1),
            )
        )
        return volver_a


# ------------------------------------------------------------------- firma --


def construir_y_firmar(
    emisor: Emisor,
    datos: DatosDocumento,
    folio: int,
    caf: CafParseado,
    cert: CertificadoCargado,
    momento: datetime,
) -> DocumentoFirmado:
    """La parte de CPU de la firma, en una función de nivel de módulo.

    Todo lo que recibe y devuelve se puede serializar con pickle, que es lo que
    necesita un `ProcessPoolExecutor`: así la firma no bloquea el event loop del
    worker. Los árboles de lxml no se pueden pasar entre procesos; por eso se
    construyen acá adentro.
    """
    return firmar_dte(construir_dte(emisor, datos, folio), caf, cert, momento)


def crear_ejecutor_firma(procesos: int) -> ProcessPoolExecutor:
    """Pool de procesos para la firma, con `spawn` y no `fork`.

    El worker es multihilo (event loop, pool de conexiones, cliente HTTP). Hacer
    `fork` de un proceso multihilo copia locks tomados por otros hilos y el hijo
    puede quedar bloqueado para siempre. `spawn` arranca un intérprete limpio.
    """
    return ProcessPoolExecutor(max_workers=procesos, mp_context=multiprocessing.get_context("spawn"))


async def _en_ejecutor(ctx: Contexto, funcion: Callable[..., Any], *args: Any) -> Any:
    if ctx.ejecutor is None:
        return funcion(*args)
    return await asyncio.get_running_loop().run_in_executor(ctx.ejecutor, funcion, *args)


async def firmar(ctx: Contexto, tenant_id: uuid.UUID, doc_id: uuid.UUID) -> str:
    """PENDIENTE → FIRMADO: construye, timbra, firma y guarda el XML en S3.

    Cada firma deja una fila `FIRMA` en `audit_log`, con éxito o sin él.

    Returns:
        El estado en que quedó el documento.
    """
    ocupado = await _reclamar(tenant_id, doc_id, E.PENDIENTE, E.FIRMANDO)
    if ocupado is not None:
        return ocupado

    cert: CertificadoCargado | None = None
    try:
        async with tenant_session(tenant_id) as s:
            doc, tenant = await _cargar(s, tenant_id, doc_id)
            caf = await abrir_caf(s, doc.caf_id, tenant_id)
            cert = await cargar_certificado(
                s, tenant_id, motivo=f"firma {doc.tipo_dte}-{doc.folio}", document_id=doc_id
            )
        firmado: DocumentoFirmado = await _en_ejecutor(
            ctx,
            construir_y_firmar,
            Emisor.desde_tenant(tenant),
            DatosDocumento.model_validate(doc.payload),
            doc.folio,
            caf,
            cert,
            datetime.now(ZONA_CHILE),
        )
        clave = clave_dte(tenant_id, doc.tipo_dte, doc.folio, firmado.sha256)
        await ctx.almacen.guardar(clave, firmado.xml)
    except Exception as exc:
        async with tenant_session(tenant_id) as s:
            s.add(
                AuditLog(
                    tenant_id=tenant_id,
                    document_id=doc_id,
                    operacion="FIRMA",
                    resultado="ERROR",
                    cert_fingerprint=cert.fingerprint_sha256 if cert else None,
                    actor="worker-firma",
                    detalle={"error": type(exc).__name__, "mensaje": str(exc)[:500]},
                )
            )
        return await _fallar(tenant_id, doc_id, E.PENDIENTE, "firma", exc)

    async with tenant_session(tenant_id) as s:
        confirmado = (
            await s.execute(
                update(Document)
                .where(Document.id == doc_id, Document.estado == E.FIRMANDO)
                .values(
                    estado=E.FIRMADO,
                    xml_key=clave,
                    xml_sha256=firmado.sha256,
                    xml_bytes=len(firmado.xml),
                    ted_barcode=firmado.ted.decode("latin-1"),
                    # Los intentos cuentan por paso: el envío parte de cero.
                    intentos=0,
                    last_error=None,
                    next_action_at=_ahora(),
                )
                .returning(Document.id)
            )
        ).scalar_one_or_none()
        s.add(
            AuditLog(
                tenant_id=tenant_id,
                document_id=doc_id,
                operacion="FIRMA",
                resultado="OK" if confirmado else "DESCARTADA",
                cert_fingerprint=cert.fingerprint_sha256,
                actor="worker-firma",
                detalle={"folio": doc.folio, "tipo_dte": doc.tipo_dte, "sha256": firmado.sha256},
            )
        )
    # Si no se confirmó, alguien movió el documento mientras se firmaba (la
    # reconciliación lo devolvió a PENDIENTE). El XML subido queda huérfano y
    # sin referencia: no se envió, así que no se "regeneró" nada que exista.
    return E.FIRMADO if confirmado else await _estado(tenant_id, doc_id)


async def _estado(tenant_id: uuid.UUID, doc_id: uuid.UUID) -> str:
    async with tenant_session(tenant_id) as s:
        return (await s.execute(select(Document.estado).where(Document.id == doc_id))).scalar_one()


# ------------------------------------------------------------------- envío --


async def enviar(ctx: Contexto, tenant_id: uuid.UUID, doc_id: uuid.UUID) -> str:
    """FIRMADO → ENVIADO: arma el sobre, lo guarda en S3 y lo sube al SII.

    Si la subida falla de forma **ambigua** (el pedido salió y no hubo
    respuesta), el documento va a revisión manual en vez de reintentarse: el SII
    pudo haberlo recibido, y reenviarlo a ciegas duplicaría el envío.
    """
    ocupado = await _reclamar(tenant_id, doc_id, E.FIRMADO, E.ENVIANDO)
    if ocupado is not None:
        return ocupado

    try:
        async with tenant_session(tenant_id) as s:
            doc, tenant = await _cargar(s, tenant_id, doc_id)
            cert = await cargar_certificado(
                s, tenant_id, motivo=f"envío {doc.tipo_dte}-{doc.folio}", document_id=doc_id
            )
        if tenant.resolucion_fecha is None:
            raise ValueError(
                "El emisor no tiene fecha de resolución del SII; sin ella la carátula es inválida"
            )
        if not cert.rut:
            raise ValueError("El certificado no trae el RUT de su titular (RutEnvia)")

        xml = await ctx.almacen.leer(doc.xml_key, doc.xml_sha256)
        firmado = DocumentoFirmado(
            xml=xml,
            ted=(doc.ted_barcode or "").encode("latin-1"),
            sha256=doc.xml_sha256,
            tipo_dte=doc.tipo_dte,
            folio=doc.folio,
        )
        canal = canal_de(doc.tipo_dte)
        sobre = firmar_sobre(
            [firmado],
            canal=canal,
            rut_emisor=tenant.rut_emisor,
            rut_envia=cert.rut,
            fecha_resolucion=tenant.resolucion_fecha.isoformat(),
            numero_resolucion=tenant.resolucion_numero,
            cert=cert,
        )
        envio_id = uuid.uuid4()
        sha_sobre = hashlib.sha256(sobre).hexdigest()
        clave = clave_envio(tenant_id, envio_id, sha_sobre)
        # El sobre se guarda antes de subirlo: lo que queda en S3 es
        # exactamente lo que se mandó.
        await ctx.almacen.guardar(clave, sobre)

        track = await ctx.sii(tenant.ambiente).enviar(
            canal, tenant_id, cert, tenant.rut_emisor, sobre, f"{envio_id}.xml"
        )
    except SiiNoDisponibleError as exc:
        if exc.ambiguo:
            # El SII pudo haber recibido el sobre: no se reenvía. Queda en
            # VERIFICAR, y el paso `verificar` le pregunta al SII por el folio.
            async with tenant_session(tenant_id) as s:
                await s.execute(
                    update(Document)
                    .where(Document.id == doc_id)
                    .values(
                        estado=E.VERIFICAR,
                        intentos=0,
                        last_error=f"Subida ambigua: el sobre pudo llegar al SII ({exc})"[:2000],
                        next_action_at=_ahora() + _espera(ESPERA_REINTENTO, 0),
                    )
                )
            return E.VERIFICAR
        return await _fallar(tenant_id, doc_id, E.FIRMADO, "envio", exc)
    except Exception as exc:
        return await _fallar(tenant_id, doc_id, E.FIRMADO, "envio", exc)

    ahora = _ahora()
    async with tenant_session(tenant_id) as s:
        s.add(
            Envio(
                id=envio_id,
                tenant_id=tenant_id,
                tipo_envio=canal.value,
                track_id=track,
                xml_key=clave,
                xml_sha256=sha_sobre,
                estado=EstadoEnvio.ENVIADO,
                next_poll_at=ahora + _espera(ESPERA_CONSULTA, 0),
            )
        )
        await s.flush()
        await s.execute(
            update(Document)
            .where(Document.id == doc_id)
            .values(
                estado=E.ENVIADO,
                envio_id=envio_id,
                intentos=0,
                last_error=None,
                next_action_at=ahora + _espera(ESPERA_CONSULTA, 0),
            )
        )
        s.add(
            AuditLog(
                tenant_id=tenant_id,
                document_id=doc_id,
                operacion="ENVIO",
                resultado="OK",
                cert_fingerprint=cert.fingerprint_sha256,
                actor="worker-envio",
                detalle={"track_id": track, "canal": canal.value, "sha256": sha_sobre},
            )
        )
    return E.ENVIADO


# ---------------------------------------------------------------- verificar --


async def verificar(ctx: Contexto, tenant_id: uuid.UUID, doc_id: uuid.UUID) -> str:
    """VERIFICAR → FIRMADO | ENVIADO | ERROR, preguntándole al SII por el folio.

    Resuelve una subida ambigua sin arriesgar un envío duplicado:

    - El SII **no tiene** el documento: vuelve a FIRMADO y se reenvía.
    - El SII **lo tiene** con los mismos datos: pasa a ENVIADO con el track ID
      que informa el SII, y la consulta de estado sigue desde ahí.
    - El SII tiene **otro** documento con ese folio: ERROR. Nunca se reenvía.
    - La respuesta no permite concluir, o el SII no responde: sigue en
      VERIFICAR con espera, y tras `MAX_INTENTOS` va a revisión manual.
    """
    async with tenant_session(tenant_id) as s:
        doc, tenant = await _cargar(s, tenant_id, doc_id)
        if doc.estado != E.VERIFICAR:
            return doc.estado
        if doc.tipo_dte in BOLETAS:
            raise NotImplementedError("La verificación por folio de boletas usa otra API del SII")
        cert = await cargar_certificado(
            s, tenant_id, motivo=f"verificación {doc.tipo_dte}-{doc.folio}", document_id=doc_id
        )
        await s.execute(update(Document).where(Document.id == doc_id).values(intentos=Document.intentos + 1))

    try:
        # El receptor sale del payload, que es la fuente de verdad del documento.
        receptor = DatosDocumento.model_validate(doc.payload).receptor
        respuesta = await ctx.sii(tenant.ambiente).consultar_documento(
            tenant_id, cert, tenant.rut_emisor, receptor.rut, doc.tipo_dte,
            doc.folio, doc.fecha_emision, doc.monto_total,
        )
    except SiiError as exc:
        respuesta, error = None, exc
    else:
        error = None

    ahora = _ahora()
    async with tenant_session(tenant_id) as s:
        def auditar(resultado: str, detalle: dict) -> None:
            s.add(AuditLog(tenant_id=tenant_id, document_id=doc_id, operacion="VERIFICACION",
                           resultado=resultado, actor="worker-envio", detalle=detalle))

        if respuesta is not None and respuesta.recibido is False:
            await s.execute(update(Document).where(Document.id == doc_id, Document.estado == E.VERIFICAR)
                            .values(estado=E.FIRMADO, intentos=0, last_error=None, next_action_at=ahora))
            auditar("OK", {"estado_sii": respuesta.estado, "decision": "reenviar"})
            return E.FIRMADO

        if respuesta is not None and respuesta.recibido and respuesta.datos_coinciden and respuesta.track_id:
            envio_id = uuid.uuid4()
            s.add(Envio(id=envio_id, tenant_id=tenant_id, tipo_envio=canal_de(doc.tipo_dte).value,
                        track_id=respuesta.track_id, estado=EstadoEnvio.ENVIADO, next_poll_at=ahora,
                        respuesta_raw=respuesta.crudo))
            await s.flush()
            await s.execute(update(Document).where(Document.id == doc_id, Document.estado == E.VERIFICAR)
                            .values(estado=E.ENVIADO, envio_id=envio_id, intentos=0, last_error=None,
                                    next_action_at=ahora))
            auditar("OK", {"estado_sii": respuesta.estado, "decision": "ya recibido", "track_id": respuesta.track_id})
            return E.ENVIADO

        if respuesta is not None and respuesta.recibido and not respuesta.datos_coinciden:
            motivo = (f"El SII tiene un documento con este folio pero con otros datos ({respuesta.estado}: "
                      f"{respuesta.glosa}). No se reenvía: revisar a mano.")
            s.add(DeadLetter(tenant_id=tenant_id, document_id=doc_id, cola="verificacion", error=motivo,
                             intentos=doc.intentos + 1))
            await s.execute(update(Document).where(Document.id == doc_id)
                            .values(estado=E.ERROR, last_error=motivo, next_action_at=None))
            auditar("ERROR", {"estado_sii": respuesta.estado, "decision": "datos distintos"})
            return E.ERROR

        # No concluyente: el SII no respondió o respondió algo que no se entiende.
        motivo = str(error) if error else f"Respuesta no concluyente del SII: {respuesta.estado} ({respuesta.glosa})"
        if doc.intentos + 1 >= MAX_INTENTOS:
            s.add(DeadLetter(tenant_id=tenant_id, document_id=doc_id, cola="verificacion",
                             error=f"No se pudo verificar la subida ambigua: {motivo}"[:4000], intentos=doc.intentos + 1))
            await s.execute(update(Document).where(Document.id == doc_id)
                            .values(estado=E.ERROR, last_error=motivo[:2000], next_action_at=None))
            return E.ERROR
        await s.execute(update(Document).where(Document.id == doc_id)
                        .values(last_error=motivo[:2000],
                                next_action_at=ahora + _espera(ESPERA_REINTENTO, doc.intentos)))
        return E.VERIFICAR


# ---------------------------------------------------------------- consulta --

_FINALES = {
    Resultado.ACEPTADO: (E.ACEPTADO, EstadoEnvio.ACEPTADO),
    Resultado.REPAROS: (E.REPAROS, EstadoEnvio.REPAROS),
    Resultado.RECHAZADO: (E.RECHAZADO, EstadoEnvio.RECHAZADO),
}


async def consultar(ctx: Contexto, tenant_id: uuid.UUID, doc_id: uuid.UUID) -> str:
    """ENVIADO → ACEPTADO | REPAROS | RECHAZADO, o reprograma la consulta.

    No reclama el documento: consultar es de solo lectura contra el SII, y dos
    consultas simultáneas llegan al mismo resultado.
    """
    async with tenant_session(tenant_id) as s:
        doc, tenant = await _cargar(s, tenant_id, doc_id)
        if doc.estado != E.ENVIADO:
            return doc.estado
        envio = (await s.execute(select(Envio).where(Envio.id == doc.envio_id))).scalar_one()
        cert = await cargar_certificado(
            s, tenant_id, motivo=f"consulta {doc.tipo_dte}-{doc.folio}", document_id=doc_id
        )

    try:
        estado = await ctx.sii(tenant.ambiente).consultar(
            canal_de(doc.tipo_dte), tenant_id, cert, tenant.rut_emisor, envio.track_id
        )
    except SiiError as exc:
        # Consultar no gasta nada: cualquier error del SII se reintenta, hasta el
        # tope de 24 horas.
        estado, error = None, exc
    else:
        error = None

    ahora = _ahora()
    async with tenant_session(tenant_id) as s:
        if estado is not None and estado.resultado in _FINALES:
            final_doc, final_envio = _FINALES[estado.resultado]
            await s.execute(
                update(Envio)
                .where(Envio.id == envio.id)
                .values(estado=final_envio, respuesta_raw=estado.crudo, consultas=Envio.consultas + 1, next_poll_at=None)
            )
            await s.execute(
                update(Document)
                .where(Document.id == doc_id, Document.estado == E.ENVIADO)
                .values(
                    estado=final_doc,
                    estado_sii=estado.estado,
                    glosa_sii=estado.glosa,
                    next_action_at=None,
                    last_error=None,
                )
            )
            s.add(
                AuditLog(
                    tenant_id=tenant_id,
                    document_id=doc_id,
                    operacion="CONSULTA",
                    resultado="OK",
                    actor="worker-estado",
                    detalle={
                        "track_id": envio.track_id,
                        "estado_sii": estado.estado,
                        "resultado": estado.resultado.value,
                        # Cuánto tardó el SII en dar el resultado final, medido
                        # hasta esta consulta: la precisión es el intervalo entre
                        # consultas.
                        "segundos_desde_envio": int((ahora - envio.sent_at).total_seconds()),
                    },
                )
            )
            return final_doc

        if ahora - envio.sent_at > TOPE_CONSULTAS:
            motivo = error or RuntimeError(
                f"El SII no dio resultado en {TOPE_CONSULTAS} (último estado: "
                f"{estado.estado if estado else 'sin respuesta'})"
            )
            s.add(DeadLetter(tenant_id=tenant_id, document_id=doc_id, cola="estado", error=str(motivo)[:4000], intentos=envio.consultas))
            await s.execute(update(Document).where(Document.id == doc_id).values(estado=E.ERROR, last_error=str(motivo)[:2000], next_action_at=None))
            return E.ERROR

        siguiente = ahora + _espera(ESPERA_CONSULTA, envio.consultas + 1)
        await s.execute(
            update(Envio)
            .where(Envio.id == envio.id)
            .values(
                consultas=Envio.consultas + 1,
                next_poll_at=siguiente,
                respuesta_raw=estado.crudo if estado else envio.respuesta_raw,
            )
        )
        await s.execute(
            update(Document)
            .where(Document.id == doc_id)
            .values(
                estado_sii=estado.estado if estado else doc.estado_sii,
                last_error=str(error)[:2000] if error else None,
                next_action_at=siguiente,
            )
        )
    return E.ENVIADO
