"""Diagnóstico contra el ambiente de certificación del SII (maullin / apicert).

Dos modos:

- `token` (por defecto): pide semilla y token con el certificado real, por los
  dos canales. No emite nada ni toca la base de datos.
- `verificar`: resuelve los documentos cuya subida fue ambigua preguntándole al
  SII por el folio; los reenvía solo si el SII no los tiene.
- `revisar-set`: lee el set de pruebas del SII y muestra, caso por caso, qué se
  va a emitir y con qué montos. No toca el SII ni la base de datos.
- `enviar`: emite **un documento de prueba real** al SII de certificación y
  espera su resultado. Recorre el mismo pipeline que los workers (folio,
  firma, S3, sobre, subida, consulta), así que lo que se prueba es lo que
  corre en producción. Usa un folio del CAF de certificación y deja el
  documento registrado en el SII de pruebas.

Siempre contra certificación: el emisor se crea o actualiza con ambiente CERT.

Variables (en `.env`; la clave nunca en el comando ni en un chat):

    DTE_CERT_PASSWORD         clave del .pfx
    DTE_FCH_RESOL             fecha de la resolución de certificación (AAAA-MM-DD)
    DTE_EMISOR_GIRO           giro, tal como está en el SII
    DTE_EMISOR_ACTECO         código de actividad económica
    DTE_EMISOR_DIRECCION      dirección de casa matriz
    DTE_EMISOR_COMUNA         comuna
    DTE_EMISOR_CIUDAD         ciudad (opcional)

Uso:

    docker compose run --rm \\
        -v "./<certificado>.pfx:/tmp/cert.pfx:ro" -e DTE_CERT_PFX=/tmp/cert.pfx \\
        -v "./<caf>.xml:/tmp/caf.xml:ro" -e DTE_CAF=/tmp/caf.xml \\
        api python -m app.scripts.certificacion enviar
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from redis.asyncio import Redis
from sqlalchemy import select

from app.core.almacen import Almacen
from app.core.certificados import CertificadoInvalidoError, guardar_certificado, parsear_pfx
from app.core.config import get_settings
from app.db import control_session, get_engine, tenant_session
from app.dte import pipeline
from app.dte.builder import BOLETAS, DatosDocumento, Item, Receptor, calcular_totales
from app.dte.caf import guardar_caf, parsear_caf
from app.dte.folios import DatosEmision, emitir_documento
from app.dte.signer import ZONA_CHILE
from app.dte.sii_client import Canal, ClienteSii, SiiError, crear_http
from app.models import CAF, Certificate, Document, Envio, Tenant

#: Tenant ficticio del modo token: su clave en Redis queda aislada de las reales.
_TENANT_DIAGNOSTICO = uuid.UUID("00000000-0000-0000-0000-00000000d1a6")

#: Receptor del documento de prueba: el propio SII. Se puede cambiar si el SII
#: lo objeta, pero es un receptor con RUT válido que siempre existe.
_RECEPTOR_PRUEBA = Receptor(
    rut="60803000-K",
    razon_social="Servicio de Impuestos Internos",
    giro="Gobierno",
    direccion="Teatinos 120",
    comuna="Santiago",
    ciudad="Santiago",
)

#: Cuánto esperar el resultado del SII antes de devolver el control.
_ESPERA_TOTAL_SEGUNDOS = 600
#: Consultas seguidas al principio, para medir con precisión cuánto tarda el SII
#: en responder; después, más espaciadas.
_CONSULTA_RAPIDA_SEGUNDOS = 5
_TRAMO_RAPIDO_SEGUNDOS = 120
_CONSULTA_LENTA_SEGUNDOS = 15


async def _esperar_resultado(ctx, tenant_id: uuid.UUID, doc_id: uuid.UUID, subido: datetime) -> str:
    """Consulta el estado hasta que el SII dé un resultado final o se acabe el plazo."""
    estado = "ENVIADO"
    anterior = "+0:00"
    while (datetime.now(ZONA_CHILE) - subido).total_seconds() < _ESPERA_TOTAL_SEGUNDOS:
        rapido = (datetime.now(ZONA_CHILE) - subido).total_seconds() < _TRAMO_RAPIDO_SEGUNDOS
        await asyncio.sleep(_CONSULTA_RAPIDA_SEGUNDOS if rapido else _CONSULTA_LENTA_SEGUNDOS)
        estado = await pipeline.consultar(ctx, tenant_id, doc_id)
        doc = await _mostrar(tenant_id, doc_id)
        ahora = _transcurrido(subido)
        print(f"   {datetime.now(ZONA_CHILE):%H:%M:%S}  ({ahora})  estado SII: {doc.estado_sii or '-'}  ->  {estado}")
        if estado != "ENVIADO":
            # Solo se sabe que respondió entre una consulta y la siguiente:
            # esa es la precisión de la medición.
            print(f"   El SII dio el resultado final entre {anterior} y {ahora} después de la subida")
            break
        anterior = ahora
    return estado


def _transcurrido(desde: datetime) -> str:
    segundos = int((datetime.now(ZONA_CHILE) - desde).total_seconds())
    return f"+{segundos // 60}:{segundos % 60:02d}"


def _certificado():
    ruta, clave = os.environ.get("DTE_CERT_PFX"), os.environ.get("DTE_CERT_PASSWORD")
    if not ruta or not clave:
        sys.exit("Faltan DTE_CERT_PFX (ruta al .pfx) y/o DTE_CERT_PASSWORD (en .env).")
    try:
        with open(ruta, "rb") as f:
            pfx = f.read()
        cert = parsear_pfx(pfx, clave)
    except (OSError, CertificadoInvalidoError) as exc:
        sys.exit(f"No se pudo abrir el certificado: {exc}")
    vigente = cert.not_after is None or cert.not_after > datetime.now(timezone.utc)
    print(
        f"Certificado: titular {cert.rut or '(sin RUT)'}, vence {cert.not_after:%Y-%m-%d}"
        f"{'' if vigente else '  <-- VENCIDO'}"
    )
    return pfx, clave, cert


# ------------------------------------------------------------------- token --


async def modo_token() -> int:
    _, _, cert = _certificado()
    print(f"Huella: {cert.fingerprint_sha256[:16]}...\n")

    s = get_settings()
    redis = Redis.from_url(s.redis_url)
    fallos = 0
    async with crear_http(s.sii_timeout_segundos) as http:
        cliente = ClienteSii(http, redis, ambiente="CERT", ttl_token=60)
        for canal in (Canal.DTE, Canal.BOLETA):
            try:
                token = await cliente.obtener_token(canal, _TENANT_DIAGNOSTICO, cert, forzar=True)
                # El token abre una sesión a nombre del titular: no se imprime entero.
                print(f"[{canal}] OK: el SII aceptó la firma y entregó token ({token[:4]}..., {len(token)} caracteres)")
            except SiiError as exc:
                fallos += 1
                print(f"[{canal}] FALLÓ ({type(exc).__name__}): {exc}")
                if exc.respuesta:
                    print(f"         respuesta del SII: {exc.respuesta[:300]}")
    await redis.aclose()
    return 1 if fallos else 0


# ------------------------------------------------------------------ enviar --


def _requerida(nombre: str) -> str:
    valor = os.environ.get(nombre, "").strip()
    if not valor:
        sys.exit(f"Falta {nombre} en .env (ver la ayuda al inicio de este archivo).")
    return valor


async def _preparar_emisor(caf_bytes: bytes, pfx: bytes, clave: str, huella: str) -> tuple[uuid.UUID, int]:
    """Deja el emisor, su certificado y su CAF cargados, como lo haría la API."""
    caf = parsear_caf(caf_bytes)
    datos = {
        "razon_social": caf.razon_social or _requerida("DTE_EMISOR_RAZON_SOCIAL"),
        "giro": _requerida("DTE_EMISOR_GIRO"),
        "acteco": _requerida("DTE_EMISOR_ACTECO"),
        "direccion": _requerida("DTE_EMISOR_DIRECCION"),
        "comuna": _requerida("DTE_EMISOR_COMUNA"),
        "ciudad": os.environ.get("DTE_EMISOR_CIUDAD") or None,
        "resolucion_fecha": date.fromisoformat(_requerida("DTE_FCH_RESOL")),
        "resolucion_numero": 0,
        "ambiente": "CERT",
    }

    async with control_session() as s:
        tenant = (
            await s.execute(select(Tenant).where(Tenant.rut_emisor == caf.rut_emisor))
        ).scalar_one_or_none()
        if tenant is None:
            tenant = Tenant(id=uuid.uuid4(), rut_emisor=caf.rut_emisor, **datos)
            s.add(tenant)
        else:
            for campo, valor in datos.items():
                setattr(tenant, campo, valor)
        tenant_id = tenant.id

    async with tenant_session(tenant_id) as s:
        activo = (
            await s.execute(select(Certificate.fingerprint_sha256).where(Certificate.activo.is_(True)))
        ).scalar_one_or_none()
    if activo != huella:
        async with tenant_session(tenant_id) as s:
            await guardar_certificado(s, tenant_id, pfx, clave, subido_por="diagnostico-certificacion")

    async with tenant_session(tenant_id) as s:
        cargado = (
            await s.execute(
                select(CAF.id).where(
                    CAF.tipo_dte == caf.tipo_dte,
                    CAF.folio_desde == caf.folio_desde,
                    CAF.folio_hasta == caf.folio_hasta,
                )
            )
        ).scalar_one_or_none()
    if cargado is None:
        async with tenant_session(tenant_id) as s:
            await guardar_caf(s, tenant_id, caf_bytes, subido_por="diagnostico-certificacion")

    print(f"Emisor: {caf.rut_emisor} ({datos['razon_social']}), CAF tipo {caf.tipo_dte} "
          f"folios {caf.folio_desde}-{caf.folio_hasta}")
    return tenant_id, caf.tipo_dte


async def _emitir_prueba(tenant_id: uuid.UUID, tipo_dte: int) -> uuid.UUID:
    datos = DatosDocumento(
        tipo_dte=tipo_dte,
        fecha_emision=date.today(),
        receptor=None if tipo_dte in BOLETAS else _RECEPTOR_PRUEBA,
        items=[Item(nombre="Prueba de certificacion dte-torn", precio=Decimal("1190" if tipo_dte in BOLETAS else "1000"))],
    )
    t = calcular_totales(datos.tipo_dte, datos.items)
    async with tenant_session(tenant_id) as s:
        doc, _ = await emitir_documento(
            s,
            tenant_id,
            DatosEmision(
                external_id=f"certificacion-{datetime.now(timezone.utc):%Y%m%d%H%M%S}",
                tipo_dte=tipo_dte,
                fecha_emision=datos.fecha_emision,
                payload=datos.model_dump(mode="json"),
                receptor_rut=datos.receptor.rut if datos.receptor else None,
                monto_neto=t.neto, monto_exento=t.exento, monto_iva=t.iva, monto_total=t.total,
            ),
        )
        print(f"Documento: tipo {tipo_dte}, folio {doc.folio}, total ${t.total}")
        return doc.id


async def _mostrar(tenant_id: uuid.UUID, doc_id: uuid.UUID) -> Document:
    async with tenant_session(tenant_id) as s:
        return (await s.execute(select(Document).where(Document.id == doc_id))).scalar_one()


async def modo_enviar() -> int:
    pfx, clave, cert = _certificado()
    ruta_caf = _requerida("DTE_CAF")
    try:
        with open(ruta_caf, "rb") as f:
            caf_bytes = f.read()
    except OSError as exc:
        sys.exit(f"No se pudo leer el CAF: {exc}")

    s = get_settings()
    almacen = Almacen(s)
    await almacen.asegurar_bucket()
    tenant_id, tipo_dte = await _preparar_emisor(caf_bytes, pfx, clave, cert.fingerprint_sha256)
    doc_id = await _emitir_prueba(tenant_id, tipo_dte)

    redis = Redis.from_url(s.redis_url)
    async with crear_http(s.sii_timeout_segundos) as http:
        ctx = pipeline.Contexto(http=http, redis=redis, almacen=almacen, ttl_token=s.sii_token_ttl_segundos)

        estado = await pipeline.firmar(ctx, tenant_id, doc_id)
        print(f"\n1. Firma: {estado}")
        if estado != "FIRMADO":
            print(f"   {(await _mostrar(tenant_id, doc_id)).last_error}")
            return 1

        inicio_subida = datetime.now(ZONA_CHILE)
        estado = await pipeline.enviar(ctx, tenant_id, doc_id)
        subido = datetime.now(ZONA_CHILE)
        doc = await _mostrar(tenant_id, doc_id)
        print(f"2. Envío: {estado}")
        print(
            f"   Subida al SII: {subido:%H:%M:%S} hora de Chile "
            f"(la subida tardó {(subido - inicio_subida).total_seconds():.1f} s)"
        )
        if estado != "ENVIADO":
            print(f"   {doc.last_error}")
            return 1
        async with tenant_session(tenant_id) as sesion:
            envio = (await sesion.execute(select(Envio).where(Envio.id == doc.envio_id))).scalar_one()
        print(f"   Track ID: {envio.track_id}")
        print(f"   Sobre guardado en S3: {envio.xml_key}")

        print(f"3. Esperando resultado del SII (hasta {_ESPERA_TOTAL_SEGUNDOS // 60} min)...")
        await _esperar_resultado(ctx, tenant_id, doc_id, subido)

    await redis.aclose()
    await get_engine().dispose()

    doc = await _mostrar(tenant_id, doc_id)
    print(f"\nResultado: {doc.estado}")
    if doc.glosa_sii:
        print(f"Glosa del SII: {doc.glosa_sii}")
    if doc.estado == "ENVIADO":
        print("El SII todavía no termina de procesarlo. El track ID sirve para consultarlo después.")
    return 0 if doc.estado in ("ACEPTADO", "REPAROS", "ENVIADO") else 1


# ---------------------------------------------------------------- verificar --


async def modo_verificar() -> int:
    """Resuelve los documentos cuya subida fue ambigua (estado VERIFICAR).

    Le pregunta al SII por cada folio: si no lo tiene, lo reenvía; si lo tiene,
    retoma la consulta con el track ID que informa el SII.
    """
    s = get_settings()
    async with control_session() as sesion:
        tenants = (await sesion.execute(select(Tenant.id, Tenant.rut_emisor))).all()
    pendientes = []
    for tenant_id, rut in tenants:
        async with tenant_session(tenant_id) as sesion:
            docs = (
                await sesion.execute(
                    select(Document.id, Document.tipo_dte, Document.folio).where(Document.estado == "VERIFICAR")
                )
            ).all()
        pendientes += [(tenant_id, rut, *d) for d in docs]

    if not pendientes:
        print("No hay documentos por verificar.")
        return 0

    redis = Redis.from_url(s.redis_url)
    fallos = 0
    async with crear_http(s.sii_timeout_segundos) as http:
        ctx = pipeline.Contexto(http=http, redis=redis, almacen=Almacen(s), ttl_token=s.sii_token_ttl_segundos)
        for tenant_id, rut, doc_id, tipo, folio in pendientes:
            print(f"Emisor {rut}, tipo {tipo}, folio {folio}:")
            estado = await pipeline.verificar(ctx, tenant_id, doc_id)
            doc = await _mostrar(tenant_id, doc_id)
            if estado == "FIRMADO":
                print("   El SII NO lo tiene: se reenvía (no hay riesgo de duplicado).")
                subido = datetime.now(ZONA_CHILE)
                estado = await pipeline.enviar(ctx, tenant_id, doc_id)
                if estado == "ENVIADO":
                    estado = await _esperar_resultado(ctx, tenant_id, doc_id, subido)
            elif estado == "ENVIADO":
                async with tenant_session(tenant_id) as sesion:
                    envio = (await sesion.execute(select(Envio).where(Envio.id == doc.envio_id))).scalar_one()
                print(f"   El SII YA lo tiene (llegó en el envío {envio.track_id}): no se reenvía.")
                estado = await _esperar_resultado(ctx, tenant_id, doc_id, datetime.now(ZONA_CHILE))
            else:
                print(f"   {estado}: {doc.last_error}")
            doc = await _mostrar(tenant_id, doc_id)
            print(f"   Resultado: {doc.estado}" + (f" ({doc.glosa_sii})" if doc.glosa_sii else ""))
            if doc.estado not in ("ACEPTADO", "REPAROS"):
                fallos += 1
    await redis.aclose()
    await get_engine().dispose()
    return 1 if fallos else 0


# -------------------------------------------------------------- revisar-set --


def _pesos(n: int) -> str:
    """Separador de miles con punto, como lo pide el SII en las representaciones."""
    return f"${n:,}".replace(",", ".")


def modo_revisar_set() -> int:
    from app.dte.builder import calcular_totales, descuento_linea, monto_linea
    from app.dte.set_pruebas import armar_documento, folios_necesarios, parsear_set, resolver_lineas

    ruta = _requerida("DTE_SET")
    with open(ruta, "rb") as f:
        set_ = parsear_set(f.read().decode("latin-1"))
    resueltos = resolver_lineas(set_)
    nombres = {33: "Factura", 34: "Factura exenta", 56: "Nota de débito", 61: "Nota de crédito"}
    codigos = {1: "anula", 2: "corrige texto", 3: "corrige montos"}

    print(f"Set número de atención {set_.numero_atencion}: {len(set_.casos)} casos\n")
    folios: dict[str, tuple[int, int]] = {}
    for caso in set_.casos:
        lineas, global_pct = resueltos[caso.id]
        datos = armar_documento(set_, caso, lineas, global_pct, _RECEPTOR_PRUEBA, date.today(), folios)
        folios[caso.id] = (caso.tipo_dte, 0)
        print(f"CASO {caso.id} - {nombres[caso.tipo_dte]}")
        if caso.referencia:
            print(f"  referencia: caso {caso.referencia}, {codigos[caso.codigo_referencia]} ({caso.razon})")
        for item in datos.items:
            desc = f" - {item.descuento_pct}% ({_pesos(descuento_linea(item))})" if item.descuento_pct else ""
            exe = " [exento]" if item.exento else ""
            print(f"  {item.nombre:28} {item.cantidad:>5} x {_pesos(int(item.precio)):>9}{desc} = {_pesos(monto_linea(item))}{exe}")
        for d in datos.descuentos_globales:
            print(f"  descuento global {d.valor}% sobre afectos")
        t = calcular_totales(datos.tipo_dte, datos.items, datos.descuentos_globales)
        partes = [f"neto {_pesos(t.neto)}"] + ([f"exento {_pesos(t.exento)}"] if t.exento else []) + [f"IVA {_pesos(t.iva)}", f"TOTAL {_pesos(t.total)}"]
        print("  " + " | ".join(partes) + "\n")

    pedir = folios_necesarios(set_)
    print("Folios necesarios: " + ", ".join(f"{n} de {nombres[t].lower()} (tipo {t})" for t, n in sorted(pedir.items())))
    return 0


if __name__ == "__main__":
    modo = sys.argv[1] if len(sys.argv) > 1 else "token"
    if modo == "revisar-set":
        sys.exit(modo_revisar_set())
    modos = {"token": modo_token, "enviar": modo_enviar, "verificar": modo_verificar}
    if modo not in modos:
        sys.exit(f"Modo desconocido: {modo!r}. Usar 'token', 'enviar', 'verificar' o 'revisar-set'.")
    sys.exit(asyncio.run(modos[modo]()))
