"""Modelo de datos del servicio.

Un solo esquema con Row Level Security: toda tabla de tenant lleva `tenant_id`
y una política que la filtra por `app.tenant_id` (ver `db.py` y la migración
inicial). Las tablas con RLS heredan de `TenantMixin`; la lista `TABLAS_RLS` es
la que consume la migración para no escribir las políticas a mano.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base declarativa."""


# --------------------------------------------------------------- estados ----


class EstadoDocumento(StrEnum):
    """Estados de `documents`. El flujo completo está en DESIGN.md §3."""

    PENDIENTE = "PENDIENTE"          # folio asignado, sin firmar
    FIRMANDO = "FIRMANDO"            # transitorio
    FIRMADO = "FIRMADO"              # XML en S3, inmutable
    ENVIANDO = "ENVIANDO"            # transitorio
    #: La subida fue ambigua: el pedido salió y no hubo respuesta. Antes de
    #: reenviar hay que preguntarle al SII si recibió el folio.
    VERIFICAR = "VERIFICAR"
    ENVIADO = "ENVIADO"              # con track_id, esperando resultado
    ACEPTADO = "ACEPTADO"
    REPAROS = "REPAROS"              # aceptado con observaciones: es válido
    RECHAZADO = "RECHAZADO"
    ANULADO = "ANULADO"              # folio que nunca se usará
    ERROR = "ERROR"                  # reintentable, en dead_letters
    ERROR_VALIDACION = "ERROR_VALIDACION"
    #: Emitido en Desarrollador: firmado y timbrado, pero nunca va al SII.
    SIMULADO = "SIMULADO"


#: Estados de los que no se sale. `ERROR` no está: es reintentable.
ESTADOS_TERMINALES = frozenset(
    {
        EstadoDocumento.ACEPTADO,
        EstadoDocumento.REPAROS,
        EstadoDocumento.RECHAZADO,
        EstadoDocumento.ANULADO,
        EstadoDocumento.ERROR_VALIDACION,
        EstadoDocumento.SIMULADO,
    }
)


class EstadoCAF(StrEnum):
    """Estados de un CAF."""

    ACTIVO = "ACTIVO"
    AGOTADO = "AGOTADO"
    VENCIDO = "VENCIDO"


class TipoEnvio(StrEnum):
    """Canales de envío al SII. Cada uno con endpoint y XSD propios."""

    DTE = "DTE"        # facturas, notas: EnvioDTE
    BOLETA = "BOLETA"  # 39/41: EnvioBOLETA
    RCOF = "RCOF"      # consumo de folios diario de boletas


class EstadoEnvio(StrEnum):
    """Estados de un envío al SII."""

    ENVIADO = "ENVIADO"
    ACEPTADO = "ACEPTADO"
    REPAROS = "REPAROS"
    RECHAZADO = "RECHAZADO"
    ERROR = "ERROR"


class EstadoSolicitudFolios(StrEnum):
    """Estados de una solicitud de CAF al SII."""

    PENDIENTE = "PENDIENTE"
    EN_CURSO = "EN_CURSO"
    COMPLETADA = "COMPLETADA"
    REVISAR = "REVISAR"  # quedó a medias y no se reintenta sola


class Ambiente(StrEnum):
    """Ambiente del SII contra el que opera un tenant."""

    CERT = "CERT"
    PROD = "PROD"
    #: Desarrollador: se emite con firma y timbre (de un CAF de prueba que genera
    #: el propio servicio), pero no se habla con el SII.
    DEV = "DEV"


# ----------------------------------------------------------------- mixins ----


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


class TenantMixin:
    """Marca una tabla como sujeta a RLS por `tenant_id`."""

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )


# ----------------------------------------------------------------- tablas ----


class Tenant(Base):
    """Empresa emisora.

    Los datos tributarios son una copia sincronizada del `Issuer` que el backend
    Torn ya mantiene: llega por `PUT /tenants/{id}`, una vez por cambio. Sin RLS:
    es la tabla de control y solo la toca el plano administrativo.
    """

    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = _pk()
    rut_emisor: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    razon_social: Mapped[str] = mapped_column(String(200), nullable=False)
    giro: Mapped[str] = mapped_column(String(200), nullable=False)
    acteco: Mapped[str] = mapped_column(String(10), nullable=False)
    direccion: Mapped[str | None] = mapped_column(String(300))
    comuna: Mapped[str | None] = mapped_column(String(100))
    ciudad: Mapped[str | None] = mapped_column(String(100))
    telefono: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(150))

    ambiente: Mapped[str] = mapped_column(String(4), nullable=False, default=Ambiente.CERT)
    resolucion_numero: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    resolucion_fecha: Mapped[date | None] = mapped_column(Date)
    #: Unidad del SII que va bajo el recuadro de la representación impresa
    #: (`S.I.I. - CONCEPCION`). No se deduce de la comuna: varias comunas de
    #: Santiago dependen de unidades con otro nombre.
    oficina_sii: Mapped[str | None] = mapped_column(String(60))

    activo: Mapped[bool] = mapped_column(nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )


class Certificate(TenantMixin, Base):
    """Certificado digital de la empresa (.pfx), cifrado.

    El sobre es AES-256-GCM con llave derivada por tenant (`core/crypto.py`).
    Ni el .pfx ni su clave se guardan ni se registran en claro en ningún lado;
    cada lectura deja fila en `audit_log`.
    """

    __tablename__ = "certificates"

    id: Mapped[uuid.UUID] = _pk()
    pfx_cifrado: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    nonce_pfx: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    password_cifrada: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    nonce_password: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)

    subject_rut: Mapped[str | None] = mapped_column(String(12))
    fingerprint_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    not_before: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    not_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    activo: Mapped[bool] = mapped_column(nullable=False, default=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    uploaded_by: Mapped[str | None] = mapped_column(String(150))

    __table_args__ = (
        Index(
            "ix_certificates_activo_por_tenant",
            "tenant_id",
            unique=True,
            postgresql_where=text("activo"),
        ),
    )


class CAF(TenantMixin, Base):
    """Rango de folios autorizado por el SII.

    `xml_cifrado` guarda el CAF **completo y byte a byte**: contiene la llave RSA
    privada que firma el TED, y el nodo `<CAF>` se inserta literal dentro del
    timbre. Reserializarlo invalida la firma.
    """

    __tablename__ = "cafs"

    id: Mapped[uuid.UUID] = _pk()
    tipo_dte: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: Ambiente cuyos documentos timbra. Cada ambiente tiene sus propios folios.
    ambiente: Mapped[str] = mapped_column(String(4), nullable=False, default=Ambiente.CERT)
    folio_desde: Mapped[int] = mapped_column(Integer, nullable=False)
    folio_hasta: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Puntero. Arranca en `folio_desde - 1`, no en 0: un CAF de 1000-1100 debe
    #: emitir 1000 como primer folio.
    ultimo_folio_usado: Mapped[int] = mapped_column(Integer, nullable=False)

    xml_cifrado: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    key_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)

    fecha_autorizacion: Mapped[date | None] = mapped_column(Date)
    fecha_vencimiento: Mapped[date | None] = mapped_column(Date)
    estado: Mapped[str] = mapped_column(String(10), nullable=False, default=EstadoCAF.ACTIVO)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint("folio_hasta >= folio_desde", name="ck_cafs_rango"),
        CheckConstraint(
            "ultimo_folio_usado >= folio_desde - 1 AND ultimo_folio_usado <= folio_hasta",
            name="ck_cafs_puntero_en_rango",
        ),
        # El SELECT ... FOR UPDATE de la asignación entra por acá.
        Index("ix_cafs_disponibles", "tenant_id", "ambiente", "tipo_dte", "estado", "folio_desde"),
    )


class Envio(TenantMixin, Base):
    """Envío al SII. El TrackID es del envío, no del documento."""

    __tablename__ = "envios"

    id: Mapped[uuid.UUID] = _pk()
    tipo_envio: Mapped[str] = mapped_column(String(6), nullable=False, default=TipoEnvio.DTE)
    #: Solo RCOF: el día que reporta.
    periodo: Mapped[date | None] = mapped_column(Date)
    track_id: Mapped[str | None] = mapped_column(String(50))

    xml_key: Mapped[str | None] = mapped_column(Text)
    xml_sha256: Mapped[str | None] = mapped_column(String(64))

    estado: Mapped[str] = mapped_column(String(12), nullable=False, default=EstadoEnvio.ENVIADO)
    respuesta_raw: Mapped[str | None] = mapped_column(Text)
    consultas: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    next_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # El consumo de folios es uno por día y emisor; que un reintento no
        # mande dos.
        Index(
            "ix_envios_rcof_periodo",
            "tenant_id",
            "periodo",
            unique=True,
            postgresql_where=text("tipo_envio = 'RCOF'"),
        ),
        Index("ix_envios_pendientes", "estado", "next_poll_at"),
    )


class Document(TenantMixin, Base):
    """Documento tributario. El agregado central del servicio."""

    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = _pk()
    #: Clave de idempotencia que entrega el llamador (id de venta, típicamente).
    external_id: Mapped[str] = mapped_column(String(100), nullable=False)
    tipo_dte: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: Ambiente del tenant al emitirlo. Fija a qué SII va (o si no va) aunque el
    #: tenant cambie de ambiente después.
    ambiente: Mapped[str] = mapped_column(String(4), nullable=False, default=Ambiente.CERT)
    folio: Mapped[int | None] = mapped_column(Integer)
    caf_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("cafs.id"))

    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, default=EstadoDocumento.PENDIENTE
    )

    #: Entrada del llamador, congelada. El XML se construye de acá una sola vez.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    #: Mismo `external_id` con payload distinto es un error del llamador, no un
    #: reintento.
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    receptor_rut: Mapped[str | None] = mapped_column(String(12))
    receptor_razon_social: Mapped[str | None] = mapped_column(String(200))
    #: CLP no tiene centavos: enteros. Igual que `quantize_money` en el backend.
    monto_neto: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    monto_exento: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    monto_iva: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    monto_total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    fecha_emision: Mapped[date] = mapped_column(Date, nullable=False)

    #: S3, write-once. El XML firmado nunca se regenera.
    xml_key: Mapped[str | None] = mapped_column(Text)
    xml_sha256: Mapped[str | None] = mapped_column(String(64))
    xml_bytes: Mapped[int | None] = mapped_column(Integer)
    #: Contenido del PDF417 del timbre, derivado del XML firmado.
    ted_barcode: Mapped[str | None] = mapped_column(Text)

    envio_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("envios.id"))
    estado_sii: Mapped[str | None] = mapped_column(String(20))
    glosa_sii: Mapped[str | None] = mapped_column(Text)
    pdf_key: Mapped[str | None] = mapped_column(Text)

    intentos: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    #: Motor de reintentos y de reconciliación tras perder Redis.
    next_action_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )

    __table_args__ = (
        # Respaldo duro de la idempotencia.
        UniqueConstraint("tenant_id", "external_id", name="uq_documents_external_id"),
        # Respaldo duro contra folio duplicado: si la lógica falla, falla la BD
        # antes de que salga un documento repetido.
        UniqueConstraint("tenant_id", "ambiente", "tipo_dte", "folio", name="uq_documents_folio"),
        Index(
            "ix_documents_pendientes",
            "estado",
            "next_action_at",
            postgresql_where=text(
                "estado NOT IN ('ACEPTADO','REPAROS','RECHAZADO','ANULADO','ERROR_VALIDACION','SIMULADO')"
            ),
        ),
    )


class FolioRequest(TenantMixin, Base):
    """Solicitud de CAF al SII.

    El SII no es idempotente pidiendo folios: pedir dos veces entrega dos CAF.
    El índice único parcial es lo que impide que un doble clic o un reintento
    abran dos solicitudes del mismo tipo.
    """

    __tablename__ = "folio_requests"

    id: Mapped[uuid.UUID] = _pk()
    tipo_dte: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    cantidad: Mapped[int] = mapped_column(Integer, nullable=False)
    maximo_autorizado: Mapped[int | None] = mapped_column(Integer)
    estado: Mapped[str] = mapped_column(
        String(12), nullable=False, default=EstadoSolicitudFolios.PENDIENTE
    )
    #: Último paso completado del flujo de `palena` (ver DESIGN.md §7). Permite
    #: retomar en vez de reempezar, que en el SII significa pedir folios de más.
    paso: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    respuesta: Mapped[dict | None] = mapped_column(JSONB)
    caf_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("cafs.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )

    __table_args__ = (
        Index(
            "ix_folio_requests_en_vuelo",
            "tenant_id",
            "tipo_dte",
            unique=True,
            postgresql_where=text("estado IN ('PENDIENTE','EN_CURSO')"),
        ),
    )


class AuditLog(TenantMixin, Base):
    """Bitácora append-only.

    La migración no crea políticas de UPDATE ni DELETE sobre esta tabla, así que
    el rol de la aplicación solo puede insertar. Un registro de auditoría que se
    puede editar no es un registro de auditoría.
    """

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = _pk()
    document_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("documents.id"))
    operacion: Mapped[str] = mapped_column(String(20), nullable=False)
    resultado: Mapped[str] = mapped_column(String(10), nullable=False)
    cert_fingerprint: Mapped[str | None] = mapped_column(String(64))
    actor: Mapped[str | None] = mapped_column(String(150))
    detalle: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_audit_log_doc", "tenant_id", "document_id", "created_at"),)


class DeadLetter(TenantMixin, Base):
    """Tarea que agotó sus reintentos y espera revisión manual."""

    __tablename__ = "dead_letters"

    id: Mapped[uuid.UUID] = _pk()
    document_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("documents.id"))
    cola: Mapped[str] = mapped_column(String(20), nullable=False)
    error: Mapped[str] = mapped_column(Text, nullable=False)
    traceback: Mapped[str | None] = mapped_column(Text)
    intentos: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CryptoCanary(Base):
    """Texto conocido cifrado con la llave maestra vigente.

    Sin RLS y sin `tenant_id`: no es dato de nadie, es la prueba de que la llave
    configurada es la misma que cifró todo lo demás. Ver
    `core/crypto.verificar_llave_maestra`.
    """

    __tablename__ = "crypto_canary"

    key_version: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    cifrado: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


#: Tablas con RLS. La migración inicial recorre esta lista para crear las
#: políticas, así que agregar una tabla de tenant no se puede olvidar acá.
TABLAS_RLS: tuple[str, ...] = tuple(
    cls.__tablename__
    for cls in (Certificate, CAF, Envio, Document, FolioRequest, AuditLog, DeadLetter)
)

#: `audit_log` solo acepta INSERT y SELECT.
TABLAS_SOLO_INSERT: frozenset[str] = frozenset({AuditLog.__tablename__})
