"""Folios: aritmética del CAF y asignación atómica de correlativos.

Sin dependencias de Taskiq ni de FastAPI: recibe una `AsyncSession` y opera.
La regla que sostiene todo el servicio es que un reintento jamás produzca un
folio duplicado ni uno saltado, y se consigue con dos cosas:

1. El documento se crea **antes** de pedir folio, con `ON CONFLICT DO NOTHING`
   sobre `(tenant_id, external_id)`. Solo quien gana esa inserción pide folio,
   así que dos llamadas simultáneas con el mismo `external_id` no queman dos.
2. El CAF se bloquea con `SELECT ... FOR UPDATE`, que serializa por
   `(tenant, tipo_dte)` y suelta el lock en el COMMIT.

Todo ocurre en una sola transacción: o hay documento con folio, o no hay nada.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import and_, literal_column, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.dte.signer import hoy_chile
from app.models import CAF, Ambiente, Document, EstadoCAF, EstadoDocumento

#: Reintentos del SELECT ... FOR UPDATE cuando el CAF elegido se agota entre el
#: snapshot y el lock. Ver `asignar_folio`.
_MAX_REINTENTOS_LOCK = 3


class SinFoliosError(Exception):
    """No hay CAF vigente con folios disponibles para ese tipo de documento."""

    def __init__(self, tipo_dte: int) -> None:
        super().__init__(f"Sin folios disponibles para DTE tipo {tipo_dte}")
        self.tipo_dte = tipo_dte


class PayloadDistintoError(Exception):
    """El `external_id` ya existe pero con otro contenido.

    Es un error del llamador, no un reintento: reusar la clave de idempotencia
    para un documento distinto significaría devolver el folio equivocado.
    """

    def __init__(self, external_id: str) -> None:
        super().__init__(f"external_id '{external_id}' ya existe con otro payload")
        self.external_id = external_id


class NoReemplazableError(Exception):
    """El documento a reemplazar no existe, no está rechazado o ya se reemplazó."""


#: Tipos cuyos folios vencen a los 6 meses de autorizados (factura, NC y ND).
TIPOS_CON_VIGENCIA_6_MESES = frozenset({33, 34, 56, 61})


# --------------------------------------------------------------- aritmética --


def siguiente_folio(caf: CAF) -> int:
    """Retorna el próximo folio del CAF, siempre dentro del rango autorizado."""
    return max(caf.ultimo_folio_usado + 1, caf.folio_desde)


def folios_disponibles(caf: CAF) -> int:
    """Cantidad de folios que le quedan al CAF (nunca negativa)."""
    return max(caf.folio_hasta - max(caf.ultimo_folio_usado, caf.folio_desde - 1), 0)


def folio_vigente(caf: CAF, hoy: date) -> bool:
    """Si un folio de este CAF todavía se puede usar hoy.

    Además de la fecha de vencimiento que se le haya puesto al cargarlo, los
    folios de factura, nota de crédito y nota de débito vencen a los 6 meses de
    autorizados: el SII rechaza el documento que use uno más viejo.
    """
    if caf.estado == EstadoCAF.VENCIDO or (caf.fecha_vencimiento and caf.fecha_vencimiento < hoy):
        return False
    fa = caf.fecha_autorizacion
    if caf.tipo_dte in TIPOS_CON_VIGENCIA_6_MESES and fa is not None:
        meses = (hoy.year - fa.year) * 12 + hoy.month - fa.month
        return meses < 6 or (meses == 6 and hoy.day <= fa.day)
    return True


def caf_vigente_sql(hoy: date):
    """`folio_vigente` como condición SQL, sin mirar el estado.

    Postgres suma el intervalo recortando al fin de mes (31-mar + 6 meses =
    30-sep), que es lo mismo que cuenta `folio_vigente`.
    """
    return and_(
        or_(CAF.fecha_vencimiento.is_(None), CAF.fecha_vencimiento >= hoy),
        or_(
            CAF.tipo_dte.not_in(TIPOS_CON_VIGENCIA_6_MESES),
            CAF.fecha_autorizacion.is_(None),
            CAF.fecha_autorizacion + literal_column("interval '6 months'") >= hoy,
        ),
    )


def hash_payload(payload: dict) -> str:
    """Hash estable del payload, para distinguir un reintento de un error."""
    canonico = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- asignación --


async def asignar_folio(
    session: AsyncSession, tenant_id: uuid.UUID, tipo_dte: int, ambiente: str = Ambiente.CERT
) -> tuple[uuid.UUID, int]:
    """Toma el siguiente folio disponible, bloqueando el CAF.

    Debe correr dentro de una transacción ya abierta: el lock se libera en el
    COMMIT del llamador, no antes.

    Args:
        session: Sesión con `app.tenant_id` ya fijado.
        tenant_id: Tenant dueño del CAF (redundante con RLS, a propósito).
        tipo_dte: Código del documento (33, 39, 61...).
        ambiente: Solo se usan los CAF de este ambiente.

    Returns:
        `(caf_id, folio)`.

    Raises:
        SinFoliosError: No hay CAF vigente con folios.
    """
    hoy = hoy_chile()

    for _ in range(_MAX_REINTENTOS_LOCK):
        stmt = (
            select(CAF)
            .where(
                CAF.tenant_id == tenant_id,
                CAF.tipo_dte == tipo_dte,
                CAF.ambiente == ambiente,
                CAF.estado == EstadoCAF.ACTIVO,
                caf_vigente_sql(hoy),
            )
            .order_by(CAF.folio_desde)
            .limit(1)
            # Sin SKIP LOCKED: saltarse la fila bloqueada sería saltar al CAF
            # siguiente y dejar un hueco de folios en el actual.
            .with_for_update()
            # Obligatorio: sin esto, si el CAF ya estaba en el identity map de
            # la sesión, el ORM devuelve la copia en memoria y se pierde el
            # `ultimo_folio_usado` que acaba de leer con el lock - que es
            # justamente el dato por el que se bloqueó.
            .execution_options(populate_existing=True)
        )
        caf = (await session.execute(stmt)).scalar_one_or_none()

        if caf is None:
            # Puede ser que de verdad no haya CAF, o que el que había se
            # agotara mientras esperábamos el lock: Postgres re-evalúa el WHERE
            # después de soltarlo y, si la fila dejó de calzar, devuelve vacío
            # en vez de pasar a la siguiente. El reintento toma un snapshot
            # nuevo y encuentra el CAF que sigue.
            if await _queda_algun_caf(session, tenant_id, tipo_dte, ambiente, hoy):
                continue
            raise SinFoliosError(tipo_dte)

        folio = siguiente_folio(caf)
        if folio > caf.folio_hasta:  # defensa: el puntero no debería llegar acá
            caf.estado = EstadoCAF.AGOTADO
            await session.flush()
            continue

        caf.ultimo_folio_usado = folio
        if folio == caf.folio_hasta:
            caf.estado = EstadoCAF.AGOTADO
        await session.flush()
        return caf.id, folio

    raise SinFoliosError(tipo_dte)


async def _queda_algun_caf(
    session: AsyncSession, tenant_id: uuid.UUID, tipo_dte: int, ambiente: str, hoy: date
) -> bool:
    """Indica si hay algún CAF activo, sin bloquearlo."""
    stmt = (
        select(CAF.id)
        .where(
            CAF.tenant_id == tenant_id,
            CAF.tipo_dte == tipo_dte,
            CAF.ambiente == ambiente,
            CAF.estado == EstadoCAF.ACTIVO,
            caf_vigente_sql(hoy),
        )
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none() is not None


# ----------------------------------------------------------------- emisión ---


@dataclass(slots=True)
class DatosEmision:
    """Lo mínimo que `documents` necesita para nacer."""

    external_id: str
    tipo_dte: int
    fecha_emision: date
    payload: dict
    receptor_rut: str | None = None
    receptor_razon_social: str | None = None
    monto_neto: int = 0
    monto_exento: int = 0
    monto_iva: int = 0
    monto_total: int = 0
    #: El del tenant al emitir. Elige los CAF y queda grabado en el documento.
    ambiente: str = Ambiente.CERT


async def emitir_documento(
    session: AsyncSession, tenant_id: uuid.UUID, datos: DatosEmision, reemplaza_a: str | None = None
) -> tuple[Document, bool]:
    """Crea el documento y le asigna folio, de forma atómica e idempotente.

    Llamarla dos veces con el mismo `external_id` devuelve el mismo documento
    con el mismo folio; nunca dos.

    Args:
        session: Sesión con `app.tenant_id` fijado y transacción abierta.
        tenant_id: Tenant emisor.
        datos: Datos del documento.
        reemplaza_a: `external_id` de un documento RECHAZADO que este reemplaza.
            Se reutiliza su folio si el CAF sigue vigente; si no, sale con uno
            nuevo y el rechazado queda con su folio por anular en el SII.

    Returns:
        `(documento, creado)`. `creado` es False si ya existía.

    Raises:
        PayloadDistintoError: El `external_id` existe con otro contenido.
        SinFoliosError: No hay folios para ese tipo de documento.
        NoReemplazableError: `reemplaza_a` no es un rechazado sin reemplazo.
    """
    payload_hash = hash_payload(datos.payload)

    # 1. Reclamar el external_id. Quien gana esta inserción es el único que
    #    pedirá folio; el resto son reintentos y devuelven lo que ya hay.
    reclamo = (
        pg_insert(Document)
        .values(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            external_id=datos.external_id,
            tipo_dte=datos.tipo_dte,
            ambiente=datos.ambiente,
            estado=EstadoDocumento.PENDIENTE,
            payload=datos.payload,
            payload_hash=payload_hash,
            receptor_rut=datos.receptor_rut,
            receptor_razon_social=datos.receptor_razon_social,
            monto_neto=datos.monto_neto,
            monto_exento=datos.monto_exento,
            monto_iva=datos.monto_iva,
            monto_total=datos.monto_total,
            fecha_emision=datos.fecha_emision,
            intentos=0,
        )
        .on_conflict_do_nothing(constraint="uq_documents_external_id")
        .returning(Document.id)
    )
    nuevo_id = (await session.execute(reclamo)).scalar_one_or_none()

    if nuevo_id is None:
        existente = (
            await session.execute(
                select(Document).where(
                    Document.tenant_id == tenant_id,
                    Document.external_id == datos.external_id,
                )
            )
        ).scalar_one()
        if existente.payload_hash != payload_hash:
            raise PayloadDistintoError(datos.external_id)
        return existente, False

    # 2. Folio. Si esto levanta, el rollback se lleva también el documento.
    reusado = await _folio_del_rechazado(session, tenant_id, datos, reemplaza_a, nuevo_id) if reemplaza_a else None
    caf_id, folio = reusado or await asignar_folio(session, tenant_id, datos.tipo_dte, datos.ambiente)

    await session.execute(
        update(Document)
        .where(Document.id == nuevo_id)
        .values(folio=folio, caf_id=caf_id, next_action_at=None)
    )
    documento = (
        await session.execute(select(Document).where(Document.id == nuevo_id))
    ).scalar_one()
    return documento, True


async def _folio_del_rechazado(
    session: AsyncSession, tenant_id: uuid.UUID, datos: DatosEmision, reemplaza_a: str, nuevo_id: uuid.UUID
) -> tuple[uuid.UUID, int] | None:
    """Marca el rechazado como reemplazado por `nuevo_id` y devuelve su folio si
    se puede reutilizar: el SII da por no emitido un rechazado, y reutilizar el
    folio evita tener que anularlo (FAQ 001.003.2167). None si su CAF venció.

    El lock sobre el rechazado serializa dos reemisiones simultáneas: la segunda
    ve `reemplazado_por` ya puesto y falla.
    """
    viejo = (
        await session.execute(
            select(Document)
            .where(Document.tenant_id == tenant_id, Document.external_id == reemplaza_a)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if viejo is None or viejo.estado != EstadoDocumento.RECHAZADO:
        raise NoReemplazableError(f"El documento {reemplaza_a} no está rechazado por el SII")
    if viejo.tipo_dte != datos.tipo_dte or viejo.ambiente != datos.ambiente:
        raise NoReemplazableError(f"El documento {reemplaza_a} es de otro tipo o de otro ambiente")
    if viejo.reemplazado_por is not None:
        raise NoReemplazableError(f"El documento {reemplaza_a} ya se volvió a emitir")
    viejo.reemplazado_por = nuevo_id

    caf = await session.get(CAF, viejo.caf_id) if viejo.caf_id else None
    if caf is None or viejo.folio is None or not folio_vigente(caf, hoy_chile()):
        await session.flush()
        return None
    await session.flush()
    return caf.id, viejo.folio
