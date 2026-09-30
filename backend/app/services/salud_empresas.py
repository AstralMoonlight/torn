"""Empresas con problemas: lo que el panel muestra en "Requiere atención".

`problemas()` es pura (recibe lo ya consultado) para poder probarla sin base ni
dte-torn; `revisar_empresas()` junta los datos y la llama por cada empresa.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import bindparam, func, text
from sqlalchemy.orm import Session

from app.database import engine
from app.models.saas import SaaSAjustes, Tenant, TenantUser
from app.services import dte_client
from app.services import suscripciones as sus
from app.utils.dates import CHILE_TZ
from app.utils.schemas import safe_schema_name

logger = logging.getLogger(__name__)

CRITICO, AVISO, INFO = "critico", "aviso", "info"

NOMBRES_DTE = {33: "Factura", 34: "Factura exenta", 39: "Boleta", 41: "Boleta exenta",
               52: "Guía de despacho", 56: "Nota de débito", 61: "Nota de crédito"}

#: Estados de dte-torn en que un documento sigue esperando al SII.
ESTADOS_SIN_RESPUESTA = ("PENDIENTE", "FIRMADO", "ENVIADO", "VERIFICAR", "ERROR")


@dataclass
class DatosEmpresa:
    """Lo consultado de una empresa. `None` = no se pudo consultar."""
    ultima_venta: datetime | None = None
    rechazados: int = 0
    sin_respuesta: int = 0
    usuarios_activos: int = 0
    #: `GET /certificates/actual` de dte-torn; `{}` = no tiene certificado.
    certificado: dict | None = None
    #: `GET /folios` de dte-torn.
    folios: list[dict] | None = None
    por_anular: int = 0
    dte_error: str | None = None


@dataclass
class Problema:
    tenant_id: int
    empresa: str
    nivel: str
    tipo: str
    mensaje: str


@dataclass
class _Lista:
    t: Tenant
    items: list = field(default_factory=list)

    def add(self, nivel, tipo, mensaje):
        self.items.append(Problema(self.t.id, self.t.name, nivel, tipo, mensaje))


def problemas(t: Tenant, estado: str, d: DatosEmpresa, ahora: datetime) -> list[Problema]:
    p = _Lista(t)
    hoy = ahora.astimezone(CHILE_TZ).date()

    # Suscripción
    vence = t.suscripcion_vence
    if estado == sus.SUSPENDIDA:
        p.add(CRITICO, "suscripcion", f"Suspendida por no pago desde el {vence:%d-%m-%Y}: solo puede consultar")
    elif estado == sus.PRORROGA:
        p.add(AVISO, "suscripcion", f"Suspendida, funcionando con prórroga hasta el {t.prorroga_hasta.astimezone(CHILE_TZ):%d-%m %H:%M}")
    elif estado == sus.EN_GRACIA:
        p.add(AVISO, "suscripcion", f"Vencida el {vence:%d-%m-%Y}, en días de gracia")
    elif estado == sus.POR_VENCER:
        p.add(INFO, "suscripcion", f"Vence el {vence:%d-%m-%Y}")
    elif estado == sus.SIN_PAGO:
        p.add(AVISO, "suscripcion", "Sin plan ni primer pago registrado")

    emite_de_verdad = t.sii_ambiente != "DEV"

    # Certificado digital: sin él no se firma nada.
    if emite_de_verdad and d.certificado is not None:
        dias = d.certificado.get("dias_restantes")
        if not d.certificado:
            p.add(CRITICO, "certificado", "Sin certificado digital: no puede emitir")
        elif dias is not None and dias < 0:
            p.add(CRITICO, "certificado", f"Certificado vencido hace {-dias} días: no está emitiendo")
        elif dias is not None and dias <= 30:
            p.add(AVISO, "certificado", f"El certificado digital vence en {dias} días")

    # Folios
    if emite_de_verdad and d.folios is not None:
        if not any(f.get("cafs") for f in d.folios):
            p.add(CRITICO, "folios", "No tiene folios (CAF) cargados: no puede emitir")
        for f in d.folios:
            activos = [c for c in f.get("cafs", []) if c.get("estado") == "ACTIVO"]
            if not activos:
                continue
            nombre = NOMBRES_DTE.get(f["tipo_dte"], f"tipo {f['tipo_dte']}")
            if f["disponibles"] == 0:
                p.add(CRITICO, "folios", f"Sin folios de {nombre}")
            elif f["disponibles"] < f.get("umbral_alerta", 0):
                p.add(AVISO, "folios", f"Quedan {f['disponibles']} folios de {nombre}")
            en_uso = next((c for c in activos if c.get("disponibles", 0) > 0), None)
            vence_caf = en_uso and en_uso.get("fecha_vencimiento")
            if vence_caf:
                dias = (date.fromisoformat(str(vence_caf)[:10]) - hoy).days
                if dias < 0:
                    p.add(CRITICO, "folios", f"Los folios de {nombre} vencieron: hay que pedir otros al SII")
                elif dias <= 15:
                    p.add(AVISO, "folios", f"Los folios de {nombre} vencen en {dias} días")
    if d.por_anular:
        p.add(INFO, "folios", f"{d.por_anular} folios por anular en el SII")
    if d.dte_error:
        p.add(AVISO, "facturacion", f"No se pudo revisar la facturación electrónica: {d.dte_error}")

    # Documentos
    if d.rechazados:
        p.add(AVISO, "documentos", f"{d.rechazados} documentos rechazados por el SII")
    if d.sin_respuesta:
        p.add(AVISO, "documentos", f"{d.sin_respuesta} documentos sin respuesta del SII hace más de 2 días")

    # Uso
    if d.usuarios_activos == 0:
        p.add(INFO, "uso", "No tiene usuarios activos")
    if t.sii_ambiente == "PROD":
        if d.ultima_venta is None:
            p.add(INFO, "uso", "En producción y todavía sin ventas")
        else:
            ultima = d.ultima_venta if d.ultima_venta.tzinfo else d.ultima_venta.replace(tzinfo=CHILE_TZ)
            dias = (hoy - ultima.astimezone(CHILE_TZ).date()).days
            if dias >= 7:
                p.add(INFO, "uso", f"Sin ventas hace {dias} días")
    elif t.created_at is not None:
        creada = t.created_at if t.created_at.tzinfo else t.created_at.replace(tzinfo=CHILE_TZ)
        dias = (hoy - creada.astimezone(CHILE_TZ).date()).days
        if dias > 30:
            nombre = "certificación" if t.sii_ambiente == "CERT" else "modo desarrollador"
            p.add(INFO, "sii", f"Sigue en {nombre} hace {dias} días")

    return p.items


def _datos_locales(t: Tenant, ahora: datetime) -> DatosEmpresa:
    d = DatosEmpresa()
    esquema = safe_schema_name(t.schema_name)
    try:
        with engine.connect() as conn:
            fila = conn.execute(text(f"""
                SELECT
                    (SELECT max(fecha_emision) FROM "{esquema}".sales WHERE modo = :modo),
                    (SELECT count(*) FROM "{esquema}".sales WHERE modo = :modo AND dte_estado = 'RECHAZADO'),
                    (SELECT count(*) FROM "{esquema}".sales WHERE modo = :modo
                        AND dte_estado IN :sin_respuesta AND fecha_emision < :limite)
            """).bindparams(bindparam("sin_respuesta", expanding=True)), {
                "modo": t.sii_ambiente, "limite": ahora - timedelta(days=2),
                "sin_respuesta": ESTADOS_SIN_RESPUESTA,
            }).one()
            d.ultima_venta, d.rechazados, d.sin_respuesta = fila
    except Exception:
        logger.warning("No se pudieron leer las ventas de %s", esquema, exc_info=True)
    return d


def _datos_dte(t: Tenant, d: DatosEmpresa) -> None:
    try:
        try:
            d.certificado = dte_client.request("GET", "/certificates/actual", t).json()
        except dte_client.DteError as exc:
            if exc.status_code != 404:
                raise
            d.certificado = {}
        d.folios = dte_client.request("GET", "/folios", t).json()
        d.por_anular = len(dte_client.request("GET", "/folios/por-anular", t).json())
    except dte_client.DteError as exc:
        d.dte_error = exc.detail


def datos_empresa(t: Tenant, usuarios_activos: int, ahora: datetime) -> DatosEmpresa:
    d = _datos_locales(t, ahora)
    d.usuarios_activos = usuarios_activos
    if t.sii_ambiente != "DEV":
        _datos_dte(t, d)
    return d


def revisar_empresas(db: Session, tenants: list[Tenant], ahora: datetime) -> list[Problema]:
    """Problemas de las empresas activas, los críticos primero.

    ponytail: consulta a dte-torn 3 veces por empresa en cada carga (8 en paralelo);
    si pasan de ~100 empresas, guardar el resultado unos minutos.
    """
    reglas: SaaSAjustes = sus.ajustes(db)
    usuarios = dict(db.query(TenantUser.tenant_id, func.count(TenantUser.id))
                    .filter(TenantUser.is_active.is_(True)).group_by(TenantUser.tenant_id).all())
    activas = [t for t in tenants if t.is_active]
    with ThreadPoolExecutor(max_workers=8) as pool:
        datos = list(pool.map(lambda t: datos_empresa(t, usuarios.get(t.id, 0), ahora), activas))
    todos = [p for t, d in zip(activas, datos) for p in problemas(t, sus.estado(t, reglas, ahora), d, ahora)]
    orden = {CRITICO: 0, AVISO: 1, INFO: 2}
    return sorted(todos, key=lambda p: (orden[p.nivel], p.empresa))
