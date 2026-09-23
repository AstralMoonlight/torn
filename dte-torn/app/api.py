"""API HTTP del servicio. La consume solo el backend Torn, por la red interna.

Autenticación (DESIGN.md §8.2): `X-Internal-Api-Key`, comparada en tiempo
constante, más `X-Tenant-Id` en todo lo que es de un tenant. El tenant fija el
RLS de la sesión: un documento de otra empresa no existe para esta, ni siquiera
para decir 404 en vez de 403.

`X-Actor` (opcional) es quién hizo la acción del lado del backend, para la
auditoría de cargas de certificado y CAF.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from prometheus_client import Counter
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.core.certificados import (
    CertificadoInvalidoError,
    CertificadoVencidoError,
    guardar_certificado,
)
from app.core.config import get_settings
from app.db import control_session, tenant_session
from app.dte import pipeline
from app.dte.builder import BOLETAS, DatosDocumento, Emisor, calcular_totales, construir_dte
from app.dte.caf import CafInvalidoError, RangoSolapadoError, guardar_caf
from app.dte.folios import DatosEmision, PayloadDistintoError, SinFoliosError, emitir_documento, folios_disponibles
from app.dte.pdf import DatosImpresion, generar_pdf
from app.dte.rut import validar_rut
from app.models import CAF, AuditLog, Certificate, Document, EstadoCAF, EstadoDocumento, Envio, Tenant
from app.tasks import colas

E = EstadoDocumento
log = logging.getLogger(__name__)
router = APIRouter()

EMITIDOS = Counter("dte_documentos_emitidos_total", "Documentos creados por la API", ["tipo_dte"])
#: Un .pfx o un CAF pesan unos pocos KB. Esto corta un upload absurdo antes de parsearlo.
MAX_ARCHIVO = 1_000_000


# -------------------------------------------------------------------- auth ---


def autenticar(x_internal_api_key: Annotated[str, Header()] = "") -> None:
    if not secrets.compare_digest(x_internal_api_key.encode(), get_settings().internal_api_key.encode()):
        raise HTTPException(401, "API key inválida")


async def tenant_actual(
    x_tenant_id: Annotated[uuid.UUID, Header()],
    _: Annotated[None, Depends(autenticar)],
) -> Tenant:
    async with control_session() as s:
        tenant = (await s.execute(select(Tenant).where(Tenant.id == x_tenant_id))).scalar_one_or_none()
    if tenant is None or not tenant.activo:
        raise HTTPException(404, "Tenant desconocido o inactivo")
    return tenant


def contexto(request: Request) -> pipeline.Contexto:
    """Dependencias del pipeline de la API (la firma en línea usa S3, no el SII)."""
    return request.app.state.ctx


TenantDep = Annotated[Tenant, Depends(tenant_actual)]
Actor = Annotated[str | None, Header(alias="X-Actor", max_length=150)]


async def _leer_archivo(archivo: UploadFile) -> bytes:
    datos = await archivo.read(MAX_ARCHIVO + 1)
    if len(datos) > MAX_ARCHIVO:
        raise HTTPException(413, "Archivo demasiado grande")
    return datos


# ----------------------------------------------------------------- tenants ---


class TenantIn(BaseModel):
    """Copia del `Issuer` del backend (DESIGN.md §8.4)."""

    rut_emisor: str
    razon_social: str = Field(min_length=1, max_length=200)
    giro: str = Field(min_length=1, max_length=200)
    acteco: str = Field(min_length=1, max_length=10)
    direccion: str | None = Field(default=None, max_length=300)
    comuna: str | None = Field(default=None, max_length=100)
    ciudad: str | None = Field(default=None, max_length=100)
    telefono: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=150)
    ambiente: Literal["CERT", "PROD"] = "CERT"
    resolucion_numero: int = Field(default=0, ge=0)
    resolucion_fecha: date | None = None
    oficina_sii: str | None = Field(default=None, max_length=60)
    activo: bool = True

    @field_validator("rut_emisor")
    @classmethod
    def _rut(cls, v: str) -> str:
        return validar_rut(v)


class TenantOut(TenantIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


@router.put("/tenants/{tenant_id}", response_model=TenantOut, dependencies=[Depends(autenticar)])
async def sincronizar_tenant(tenant_id: uuid.UUID, datos: TenantIn) -> Tenant:
    """Upsert idempotente: el backend lo llama cada vez que guarda su emisor."""
    valores = datos.model_dump()
    try:
        async with control_session() as s:
            await s.execute(
                pg_insert(Tenant)
                .values(id=tenant_id, **valores)
                .on_conflict_do_update(index_elements=[Tenant.id], set_={**valores, "updated_at": datetime.now(timezone.utc)})
            )
            return (await s.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
    except IntegrityError as exc:
        raise HTTPException(409, "Ese RUT ya pertenece a otro tenant") from exc


# ------------------------------------------------------------ certificados ---


class CertificadoOut(BaseModel):
    """Vigencia del certificado, sin nada sensible (DESIGN.md §10)."""

    titular_rut: str | None
    fingerprint_sha256: str
    not_before: datetime | None
    not_after: datetime | None
    dias_restantes: int | None
    subido_en: datetime


def _certificado_out(c: Certificate) -> CertificadoOut:
    return CertificadoOut(
        titular_rut=c.subject_rut,
        fingerprint_sha256=c.fingerprint_sha256,
        not_before=c.not_before,
        not_after=c.not_after,
        dias_restantes=(c.not_after - datetime.now(timezone.utc)).days if c.not_after else None,
        subido_en=c.uploaded_at,
    )


@router.post("/certificates", response_model=CertificadoOut, status_code=201)
async def subir_certificado(
    tenant: TenantDep,
    archivo: Annotated[UploadFile, File(description=".pfx de la empresa")],
    password: Annotated[str, Form()],
    actor: Actor = None,
) -> CertificadoOut:
    """Carga el .pfx, lo cifra y lo deja como el activo del tenant (#15)."""
    pfx = await _leer_archivo(archivo)
    try:
        async with tenant_session(tenant.id) as s:
            fila = await guardar_certificado(s, tenant.id, pfx, password, subido_por=actor)
        async with tenant_session(tenant.id) as s:
            fila = (await s.execute(select(Certificate).where(Certificate.id == fila.id))).scalar_one()
    except (CertificadoInvalidoError, CertificadoVencidoError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return _certificado_out(fila)


@router.get("/certificates/actual", response_model=CertificadoOut)
async def certificado_actual(tenant: TenantDep) -> CertificadoOut:
    async with tenant_session(tenant.id) as s:
        fila = (await s.execute(select(Certificate).where(Certificate.activo.is_(True)))).scalar_one_or_none()
    if fila is None:
        raise HTTPException(404, "La empresa no tiene certificado cargado")
    return _certificado_out(fila)


# -------------------------------------------------------------------- CAF ----


class CafOut(BaseModel):
    id: uuid.UUID
    tipo_dte: int
    folio_desde: int
    folio_hasta: int
    ultimo_folio_usado: int
    disponibles: int
    estado: str
    fecha_autorizacion: date | None
    fecha_vencimiento: date | None


def _caf_out(caf: CAF) -> CafOut:
    return CafOut(
        id=caf.id, tipo_dte=caf.tipo_dte, folio_desde=caf.folio_desde, folio_hasta=caf.folio_hasta,
        ultimo_folio_usado=caf.ultimo_folio_usado, estado=caf.estado,
        disponibles=folios_disponibles(caf) if caf.estado == EstadoCAF.ACTIVO else 0,
        fecha_autorizacion=caf.fecha_autorizacion, fecha_vencimiento=caf.fecha_vencimiento,
    )


@router.post("/cafs", response_model=CafOut, status_code=201)
async def subir_caf(
    tenant: TenantDep,
    archivo: Annotated[UploadFile, File(description="XML del CAF tal como lo entrega el SII")],
    actor: Actor = None,
) -> CafOut:
    """Carga manual de un CAF (#22). También es la salida de emergencia si la
    solicitud automática al SII falla."""
    xml = await _leer_archivo(archivo)
    try:
        async with tenant_session(tenant.id) as s:
            caf = await guardar_caf(s, tenant.id, xml, subido_por=actor)
    except RangoSolapadoError as exc:
        raise HTTPException(409, str(exc)) from exc
    except CafInvalidoError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _caf_out(caf)


class StockFolios(BaseModel):
    tipo_dte: int
    disponibles: int
    cafs: list[CafOut]


@router.get("/folios", response_model=list[StockFolios])
async def stock_folios(tenant: TenantDep) -> list[StockFolios]:
    """Folios disponibles por tipo de documento, con sus CAF."""
    async with tenant_session(tenant.id) as s:
        cafs = (await s.execute(select(CAF).order_by(CAF.tipo_dte, CAF.folio_desde))).scalars().all()
    por_tipo: dict[int, list[CafOut]] = {}
    for caf in cafs:
        por_tipo.setdefault(caf.tipo_dte, []).append(_caf_out(caf))
    return [StockFolios(tipo_dte=t, disponibles=sum(c.disponibles for c in lista), cafs=lista) for t, lista in por_tipo.items()]


# -------------------------------------------------------------- documentos ---


class DocumentoIn(DatosDocumento):
    #: Clave de idempotencia: típicamente el id de la venta en el backend.
    external_id: str = Field(min_length=1, max_length=100)


class DocumentoOut(BaseModel):
    id: uuid.UUID
    external_id: str
    tipo_dte: int
    folio: int | None
    estado: str
    fecha_emision: date
    receptor_rut: str | None
    monto_neto: int
    monto_exento: int
    monto_iva: int
    monto_total: int
    #: Contenido del PDF417, para que el POS imprima sin esperar al SII.
    ted: str | None
    track_id: str | None
    estado_sii: str | None
    glosa_sii: str | None
    ultimo_error: str | None
    creado_en: datetime


async def _documento_out(tenant_id: uuid.UUID, doc: Document) -> DocumentoOut:
    track = None
    if doc.envio_id:
        async with tenant_session(tenant_id) as s:
            track = (await s.execute(select(Envio.track_id).where(Envio.id == doc.envio_id))).scalar_one_or_none()
    return DocumentoOut(
        id=doc.id, external_id=doc.external_id, tipo_dte=doc.tipo_dte, folio=doc.folio, estado=doc.estado,
        fecha_emision=doc.fecha_emision, receptor_rut=doc.receptor_rut,
        monto_neto=doc.monto_neto, monto_exento=doc.monto_exento, monto_iva=doc.monto_iva,
        monto_total=doc.monto_total, ted=doc.ted_barcode, track_id=track, estado_sii=doc.estado_sii,
        glosa_sii=doc.glosa_sii, ultimo_error=doc.last_error, creado_en=doc.created_at,
    )


async def _emitir(tenant: Tenant, entrada: DocumentoIn, ctx: pipeline.Contexto, response: Response) -> DocumentoOut:
    """Valida, asigna folio, firma en línea y encola el envío.

    Todo lo que puede rechazar el documento pasa **antes** de asignar el folio:
    un payload inválido nunca quema uno. La firma va en línea para que la
    respuesta traiga el timbre y el POS pueda imprimir de inmediato; si falla,
    el documento queda PENDIENTE y la reconciliación la reintenta.
    """
    datos = DatosDocumento.model_validate(entrada.model_dump(exclude={"external_id"}))
    try:
        totales = calcular_totales(datos.tipo_dte, datos.items, datos.descuentos_globales)
        # Construir con un folio cualquiera detecta lo que el builder rechaza
        # (datos del emisor incompletos, descuentos imposibles) sin gastar uno.
        construir_dte(Emisor.desde_tenant(tenant), datos, 1)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    try:
        async with tenant_session(tenant.id) as s:
            doc, creado = await emitir_documento(
                s,
                tenant.id,
                DatosEmision(
                    external_id=entrada.external_id,
                    tipo_dte=datos.tipo_dte,
                    fecha_emision=datos.fecha_emision,
                    payload=datos.model_dump(mode="json"),
                    receptor_rut=datos.receptor.rut if datos.receptor else None,
                    receptor_razon_social=datos.receptor.razon_social if datos.receptor else None,
                    monto_neto=totales.neto, monto_exento=totales.exento,
                    monto_iva=totales.iva, monto_total=totales.total,
                ),
            )
    except SinFoliosError as exc:
        raise HTTPException(409, f"Sin folios disponibles para el tipo {datos.tipo_dte}") from exc
    except PayloadDistintoError as exc:
        raise HTTPException(409, f"El external_id {entrada.external_id} ya existe con otro contenido") from exc

    if creado:
        EMITIDOS.labels(str(datos.tipo_dte)).inc()
    estado = doc.estado
    if estado == E.PENDIENTE:
        estado = await pipeline.firmar(ctx, tenant.id, doc.id)
    if estado == E.FIRMADO:
        try:
            await colas.encolar(estado, tenant.id, doc.id)
        except Exception:  # noqa: BLE001 - la reconciliación lo encola igual
            log.exception("No se pudo encolar el envío de %s", doc.id)

    async with tenant_session(tenant.id) as s:
        doc = (await s.execute(select(Document).where(Document.id == doc.id))).scalar_one()
    response.status_code = 201 if creado else 200
    return await _documento_out(tenant.id, doc)


@router.post("/documents", response_model=DocumentoOut, status_code=201)
async def emitir(
    entrada: DocumentoIn,
    tenant: TenantDep,
    response: Response,
    ctx: Annotated[pipeline.Contexto, Depends(contexto)],
) -> DocumentoOut:
    """Facturas, notas de crédito y débito. Las boletas van por `/boletas`."""
    if entrada.tipo_dte in BOLETAS:
        raise HTTPException(422, "Las boletas se emiten por POST /boletas")
    return await _emitir(tenant, entrada, ctx, response)


@router.post("/boletas", response_model=DocumentoOut, status_code=201)
async def emitir_boleta(
    entrada: DocumentoIn,
    tenant: TenantDep,
    response: Response,
    ctx: Annotated[pipeline.Contexto, Depends(contexto)],
) -> DocumentoOut:
    """Boletas (39/41): otro sobre, otro endpoint del SII y el consumo de folios diario."""
    if entrada.tipo_dte not in BOLETAS:
        raise HTTPException(422, "Por /boletas solo se emiten boletas (39 y 41)")
    return await _emitir(tenant, entrada, ctx, response)


@router.get("/documents", response_model=list[DocumentoOut])
async def listar(
    tenant: TenantDep,
    estado: str | None = None,
    tipo_dte: int | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[DocumentoOut]:
    """Documentos del tenant, los más nuevos primero."""
    consulta = select(Document).order_by(Document.created_at.desc()).limit(limit).offset(offset)
    if estado:
        consulta = consulta.where(Document.estado == estado)
    if tipo_dte:
        consulta = consulta.where(Document.tipo_dte == tipo_dte)
    async with tenant_session(tenant.id) as s:
        docs = (await s.execute(consulta)).scalars().all()
    return [await _documento_out(tenant.id, d) for d in docs]


async def _buscar(tenant_id: uuid.UUID, external_id: str) -> Document:
    async with tenant_session(tenant_id) as s:
        doc = (await s.execute(select(Document).where(Document.external_id == external_id))).scalar_one_or_none()
    if doc is None:
        raise HTTPException(404, "Documento no encontrado")
    return doc


@router.get("/documents/{external_id}", response_model=DocumentoOut)
async def ver(external_id: str, tenant: TenantDep) -> DocumentoOut:
    return await _documento_out(tenant.id, await _buscar(tenant.id, external_id))


async def _xml_firmado(tenant_id: uuid.UUID, doc: Document, ctx: pipeline.Contexto, actor: str | None, que: str) -> bytes:
    """Lee el XML de S3 (verificando su hash) y deja constancia de la descarga."""
    if not doc.xml_key:
        raise HTTPException(409, f"El documento está {doc.estado}: todavía no tiene XML firmado")
    xml = await ctx.almacen.leer(doc.xml_key, doc.xml_sha256)
    async with tenant_session(tenant_id) as s:
        s.add(AuditLog(tenant_id=tenant_id, document_id=doc.id, operacion=que, resultado="OK", actor=actor))
    return xml


@router.get("/documents/{external_id}/xml")
async def descargar_xml(
    external_id: str, tenant: TenantDep,
    ctx: Annotated[pipeline.Contexto, Depends(contexto)],
    actor: Actor = None,
) -> Response:
    """El XML firmado, byte a byte como se guardó (y se envió) al SII."""
    doc = await _buscar(tenant.id, external_id)
    xml = await _xml_firmado(tenant.id, doc, ctx, actor, "DESCARGA_XML")
    return Response(
        xml, media_type="application/xml; charset=ISO-8859-1",
        headers={"Content-Disposition": f'inline; filename="DTE_{doc.tipo_dte}_{doc.folio}.xml"'},
    )


@router.get("/documents/{external_id}/pdf")
async def descargar_pdf(
    external_id: str, tenant: TenantDep,
    ctx: Annotated[pipeline.Contexto, Depends(contexto)],
    cedible: bool = False,
    actor: Actor = None,
) -> Response:
    """Representación impresa, generada del XML firmado (nunca del payload)."""
    doc = await _buscar(tenant.id, external_id)
    if tenant.resolucion_fecha is None:
        raise HTTPException(409, "El emisor no tiene fecha de resolución del SII: va impresa bajo el timbre")
    xml = await _xml_firmado(tenant.id, doc, ctx, actor, "DESCARGA_PDF")
    pdf = generar_pdf(
        xml,
        DatosImpresion(
            resolucion_numero=tenant.resolucion_numero,
            resolucion_fecha=tenant.resolucion_fecha,
            oficina_sii=tenant.oficina_sii,
            cedible=cedible,
        ),
    )
    sufijo = "_cedible" if cedible else ""
    return Response(
        pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="DTE_{doc.tipo_dte}_{doc.folio}{sufijo}.pdf"'},
    )

