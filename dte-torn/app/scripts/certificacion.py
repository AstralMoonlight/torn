"""Diagnóstico contra el ambiente de certificación del SII (maullin / apicert).

Dos modos:

- `token` (por defecto): pide semilla y token con el certificado real, por los
  dos canales. No emite nada ni toca la base de datos.
- `verificar`: resuelve los documentos cuya subida fue ambigua preguntándole al
  SII por el folio; los reenvía solo si el SII no los tiene.
- `set`: emite el set de pruebas completo en un solo envío (lo que exige la
  declaración de avance) y muestra el N° de envío para declararlo.
- `muestras`: genera los PDF de los documentos del set (y la copia cedible de
  las facturas) para la etapa de muestras impresas. No toca el SII.
- `libro`: arma, firma y sube el libro de ventas o de compras del set
  (`DTE_LIBRO=ventas|compras`) y muestra el N° de envío para declararlo.
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
    DTE_EMISOR_OFICINA_SII    unidad del SII bajo el recuadro del PDF (`S.I.I. - CONCEPCION`)
    DTE_SET                   archivo del set de pruebas del SII (`set`, `revisar-set`, `muestras`)
    DTE_SET_NOMBRE            set a usar del archivo (por defecto `SET BASICO`; p. ej. `SET FACTURA EXENTA`)

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
from sqlalchemy import select, update

from app.core.almacen import Almacen
from app.core.certificados import CertificadoInvalidoError, guardar_certificado, parsear_pfx
from app.core.config import get_settings
from app.db import control_session, get_engine, tenant_session
from app.dte import pipeline
from app.dte.builder import BOLETAS, GUIA_DESPACHO, DatosDocumento, Item, Receptor, Referencia, calcular_totales
from app.dte.caf import guardar_caf, parsear_caf
from app.dte.folios import DatosEmision, emitir_documento
from app.dte.set_pruebas import VENTA
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


def _emisor_como_receptor(tenant: Tenant) -> Receptor:
    """El emisor como receptor: lo exige el SII en la guía de traslado interno."""
    return Receptor(
        rut=tenant.rut_emisor, razon_social=tenant.razon_social, giro=tenant.giro,
        direccion=tenant.direccion, comuna=tenant.comuna, ciudad=tenant.ciudad,
    )


def _leer_set():
    """El set de `DTE_SET_NOMBRE` (básico por defecto) del archivo `DTE_SET`."""
    from app.dte.set_pruebas import parsear_set

    with open(_requerida("DTE_SET"), "rb") as f:
        return parsear_set(f.read().decode("latin-1"), os.environ.get("DTE_SET_NOMBRE") or "SET BASICO")


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

    await _cargar_caf_si_falta(tenant_id, caf_bytes)
    print(f"Emisor: {caf.rut_emisor} ({datos['razon_social']}), CAF tipo {caf.tipo_dte} "
          f"folios {caf.folio_desde}-{caf.folio_hasta}")
    return tenant_id, caf.tipo_dte


async def _cargar_caf_si_falta(tenant_id: uuid.UUID, caf_bytes: bytes) -> None:
    """Carga el CAF salvo que ese mismo rango ya esté cargado."""
    caf = parsear_caf(caf_bytes)
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


#: Qué anula cada tipo de nota de prueba: la nota de crédito anula una factura,
#: la de débito anula una nota de crédito.
_ANULA_A = {61: 33, 56: 61}


async def _documento_a_anular(tenant_id: uuid.UUID, tipo_nota: int) -> Document:
    """El documento aceptado de folio más bajo que ninguna nota anuló todavía."""
    tipo_objetivo = _ANULA_A[tipo_nota]
    async with tenant_session(tenant_id) as s:
        notas = (
            await s.execute(select(Document.payload).where(Document.tipo_dte.in_([56, 61])))
        ).scalars().all()
        ya_anulados = {
            (r["tipo_doc"], r["folio"])
            for payload in notas
            for r in payload.get("referencias", [])
            if r.get("codigo") == 1
        }
        candidatos = (
            await s.execute(
                select(Document)
                .where(Document.tipo_dte == tipo_objetivo, Document.estado == "ACEPTADO")
                .order_by(Document.folio)
            )
        ).scalars().all()
    for doc in candidatos:
        if (str(doc.tipo_dte), str(doc.folio)) not in ya_anulados:
            return doc
    sys.exit(
        f"No hay documentos tipo {tipo_objetivo} aceptados y sin anular para la nota tipo {tipo_nota}. "
        "Primero emite y envía uno."
    )


async def _emitir_prueba(tenant_id: uuid.UUID, tipo_dte: int) -> uuid.UUID:
    """Emite un documento de prueba libre (fuera del set).

    Factura o boleta: una línea de prueba. Nota de crédito o débito: anula el
    documento aceptado más antiguo que no esté anulado, copiando sus líneas para
    que los montos calcen.
    """
    if tipo_dte in _ANULA_A:
        anulado = await _documento_a_anular(tenant_id, tipo_dte)
        base = DatosDocumento.model_validate(anulado.payload)
        datos = DatosDocumento(
            tipo_dte=tipo_dte,
            fecha_emision=date.today(),
            receptor=base.receptor,
            items=base.items,
            descuentos_globales=base.descuentos_globales,
            referencias=[
                Referencia(
                    tipo_doc=str(anulado.tipo_dte),
                    folio=str(anulado.folio),
                    fecha=anulado.fecha_emision,
                    codigo=1,
                    razon="Anula documento de prueba",
                )
            ],
        )
        print(f"Anula: tipo {anulado.tipo_dte}, folio {anulado.folio}")
    else:
        datos = DatosDocumento(
            tipo_dte=tipo_dte,
            fecha_emision=date.today(),
            receptor=None if tipo_dte in BOLETAS else _RECEPTOR_PRUEBA,
            items=[Item(nombre="Prueba de certificacion dte-torn", precio=Decimal("1190" if tipo_dte in BOLETAS else "1000"))],
            ind_traslado=VENTA if tipo_dte == GUIA_DESPACHO else None,
        )
    t = calcular_totales(datos.tipo_dte, datos.items, datos.descuentos_globales)
    async with tenant_session(tenant_id) as s:
        doc, _ = await emitir_documento(
            s,
            tenant_id,
            DatosEmision(
                external_id=f"certificacion-{datetime.now(timezone.utc):%Y%m%d%H%M%S%f}",
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


# --------------------------------------------------------------------- set --


async def _folios_libres(tenant_id: uuid.UUID) -> dict[int, int]:
    """Folios sin usar en los CAF activos y vigentes, por tipo de documento."""
    from app.dte.folios import folios_disponibles

    async with tenant_session(tenant_id) as s:
        cafs = (await s.execute(select(CAF).where(CAF.estado == "ACTIVO"))).scalars().all()
    libres: dict[int, int] = {}
    for c in cafs:
        if c.fecha_vencimiento is None or c.fecha_vencimiento >= date.today():
            libres[c.tipo_dte] = libres.get(c.tipo_dte, 0) + folios_disponibles(c)
    return libres


#: Rondas de consulta por folio al retomar un set con subida ambigua.
_INTENTOS_VERIFICACION_SET = 5


async def modo_set() -> int:
    """Emite el set de pruebas completo en UN solo envío, como exige el SII.

    El formulario "Declarar avance" pide un único número de envío para el set,
    que debe contener solo documentos del set y ninguno con reparos o rechazos.

    Es idempotente: cada caso usa `set-<atención>-<caso>` como clave, así que
    volver a correrlo no emite ni reenvía nada que ya exista. Antes de emitir el
    primer caso comprueba que hay folios para todos: no se gasta ninguno si no
    alcanzan.
    """
    from app.core.almacen import clave_envio
    from app.dte.set_pruebas import armar_documento, folios_necesarios, resolver_lineas
    from app.dte.signer import DocumentoFirmado, firmar_sobre
    from app.models import AuditLog, EstadoEnvio

    pfx, clave, cert = _certificado()
    set_ = _leer_set()
    rutas = [r.strip() for r in _requerida("DTE_CAFS").split(",") if r.strip()]
    cafs = [open(r, "rb").read() for r in rutas]

    s = get_settings()
    almacen = Almacen(s)
    await almacen.asegurar_bucket()
    tenant_id, _ = await _preparar_emisor(cafs[0], pfx, clave, cert.fingerprint_sha256)
    for caf_bytes in cafs[1:]:
        await _cargar_caf_si_falta(tenant_id, caf_bytes)

    claves = {c.id: f"set-{set_.numero_atencion}-{c.id}" for c in set_.casos}
    async with tenant_session(tenant_id) as sesion:
        existentes = {
            d.external_id: d
            for d in (
                await sesion.execute(select(Document).where(Document.external_id.in_(claves.values())))
            ).scalars().all()
        }

    # Folios: solo cuentan los casos que todavía no se emitieron.
    faltan: dict[int, int] = {}
    for caso in set_.casos:
        if claves[caso.id] not in existentes:
            faltan[caso.tipo_dte] = faltan.get(caso.tipo_dte, 0) + 1
    libres = await _folios_libres(tenant_id)
    cortos = {t: (n, libres.get(t, 0)) for t, n in faltan.items() if libres.get(t, 0) < n}
    print(f"Set {set_.numero_atencion}: {len(set_.casos)} casos; necesita {folios_necesarios(set_)}")
    if cortos:
        for t, (n, hay) in sorted(cortos.items()):
            print(f"   Faltan folios del tipo {t}: necesita {n}, hay {hay} libres")
        print("No se emitió nada: carga los CAF que faltan y vuelve a correrlo.")
        return 1

    async with control_session() as sesion:
        tenant = (await sesion.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
    emisor_como_receptor = _emisor_como_receptor(tenant)

    # 1. Emitir y firmar cada caso, en orden (las notas necesitan el folio de su referencia).
    redis = Redis.from_url(s.redis_url)
    resueltos = resolver_lineas(set_)
    folios: dict[str, tuple[int, int]] = {}
    ids: dict[str, uuid.UUID] = {}
    async with crear_http(s.sii_timeout_segundos) as http:
        ctx = pipeline.Contexto(http=http, redis=redis, almacen=almacen, ttl_token=s.sii_token_ttl_segundos)
        for caso in set_.casos:
            doc = existentes.get(claves[caso.id])
            if doc is None:
                lineas, global_pct = resueltos[caso.id]
                datos = armar_documento(
                    set_, caso, lineas, global_pct, _RECEPTOR_PRUEBA, date.today(), folios, emisor_como_receptor
                )
                t = calcular_totales(datos.tipo_dte, datos.items, datos.descuentos_globales)
                async with tenant_session(tenant_id) as sesion:
                    doc, _ = await emitir_documento(
                        sesion,
                        tenant_id,
                        DatosEmision(
                            external_id=claves[caso.id],
                            tipo_dte=datos.tipo_dte,
                            fecha_emision=datos.fecha_emision,
                            payload=datos.model_dump(mode="json"),
                            receptor_rut=datos.receptor.rut,
                            monto_neto=t.neto, monto_exento=t.exento, monto_iva=t.iva, monto_total=t.total,
                        ),
                    )
            folios[caso.id] = (doc.tipo_dte, doc.folio)
            ids[caso.id] = doc.id
            estado = await pipeline.firmar(ctx, tenant_id, doc.id)
            doc = await _mostrar(tenant_id, doc.id)
            print(f"   CASO {caso.id}: tipo {doc.tipo_dte} folio {doc.folio} total ${doc.monto_total} -> {estado}")
            if estado not in ("FIRMADO", "ENVIADO", "ACEPTADO", "VERIFICAR"):
                print(f"   {doc.last_error}")
                print("No se envió nada: un caso no se pudo firmar.")
                return 1

        # Una subida anterior fue ambigua: antes de reenviar, preguntarle al SII
        # por cada folio. Si no tiene ninguno, se reenvía el set completo; si los
        # tiene, se sigue con el track que informa. maullin responde 503 a ratos.
        for intento in range(_INTENTOS_VERIFICACION_SET):
            pendientes = [i for i in ids.values() if (await _mostrar(tenant_id, i)).estado == "VERIFICAR"]
            if not pendientes:
                break
            if intento:
                await asyncio.sleep(_CONSULTA_RAPIDA_SEGUNDOS)
            for doc_id in pendientes:
                estado = await pipeline.verificar(ctx, tenant_id, doc_id)
                doc = await _mostrar(tenant_id, doc_id)
                print(f"   Verificación tipo {doc.tipo_dte} folio {doc.folio} -> {estado}")

        docs = [await _mostrar(tenant_id, ids[c.id]) for c in set_.casos]
        estados = {d.estado for d in docs}
        if estados != {"FIRMADO"}:
            # Tras una verificación cada documento tiene su propia fila Envio,
            # pero todas con el track del único envío que recibió el SII.
            async with tenant_session(tenant_id) as sesion:
                tracks = set(
                    (await sesion.execute(
                        select(Envio.track_id).where(Envio.id.in_([d.envio_id for d in docs if d.envio_id]))
                    )).scalars()
                )
            if estados <= {"ENVIADO", "ACEPTADO"} and len(tracks) == 1:
                print("El set ya se había enviado en un solo envío: solo se consulta su estado.")
            else:
                print(f"Los casos están en estados mezclados {sorted(estados)}: no se reenvía. Revisar a mano.")
                return 1

        if estados == {"FIRMADO"}:
            # 2. Un solo sobre con los 8 documentos, exactamente como quedaron firmados.
            firmados = [
                DocumentoFirmado(
                    xml=await almacen.leer(d.xml_key, d.xml_sha256),
                    ted=(d.ted_barcode or "").encode("latin-1"),
                    sha256=d.xml_sha256, tipo_dte=d.tipo_dte, folio=d.folio,
                )
                for d in docs
            ]
            sobre = firmar_sobre(
                firmados, canal="DTE", rut_emisor=tenant.rut_emisor, rut_envia=cert.rut,
                fecha_resolucion=tenant.resolucion_fecha.isoformat(),
                numero_resolucion=tenant.resolucion_numero, cert=cert,
            )
            envio_id = uuid.uuid4()
            import hashlib
            sha = hashlib.sha256(sobre).hexdigest()
            clave_s3 = clave_envio(tenant_id, envio_id, sha)
            await almacen.guardar(clave_s3, sobre)

            subido = datetime.now(ZONA_CHILE)
            try:
                track = await ctx.sii("CERT").enviar(
                    Canal.DTE, tenant_id, cert, tenant.rut_emisor, sobre, f"set-{set_.numero_atencion}.xml"
                )
            except SiiError as exc:
                print(f"La subida del set falló ({type(exc).__name__}): {exc}")
                if getattr(exc, "ambiguo", False):
                    async with tenant_session(tenant_id) as sesion:
                        await sesion.execute(
                            Document.__table__.update()
                            .where(Document.id.in_(list(ids.values())))
                            .values(estado="VERIFICAR", last_error=f"Subida ambigua del set: {exc}"[:2000])
                        )
                    print("Subida ambigua: los casos quedan en VERIFICAR. Vuelve a correr 'set': "
                          "le pregunta al SII por cada folio antes de reenviar.")
                return 1
            async with tenant_session(tenant_id) as sesion:
                sesion.add(Envio(id=envio_id, tenant_id=tenant_id, tipo_envio="DTE", track_id=track,
                                 xml_key=clave_s3, xml_sha256=sha, estado=EstadoEnvio.ENVIADO))
                await sesion.flush()
                await sesion.execute(
                    Document.__table__.update()
                    .where(Document.id.in_(list(ids.values())))
                    .values(estado="ENVIADO", envio_id=envio_id)
                )
                sesion.add(AuditLog(tenant_id=tenant_id, operacion="ENVIO", resultado="OK",
                                    cert_fingerprint=cert.fingerprint_sha256, actor="diagnostico-set",
                                    detalle={"track_id": track, "set": set_.numero_atencion, "documentos": len(docs)}))
            print(f"Envío del set: track {track}, subido {subido:%H:%M:%S} hora de Chile")
        else:
            async with tenant_session(tenant_id) as sesion:
                envio = (await sesion.execute(select(Envio).where(Envio.id == docs[0].envio_id))).scalar_one()
            track, subido = envio.track_id, envio.sent_at.astimezone(ZONA_CHILE)

        # 3. Esperar el resultado del envío completo.
        resultado = None
        while (datetime.now(ZONA_CHILE) - subido).total_seconds() < _ESPERA_TOTAL_SEGUNDOS:
            await asyncio.sleep(_CONSULTA_RAPIDA_SEGUNDOS)
            try:
                resultado = await ctx.sii("CERT").consultar(Canal.DTE, tenant_id, cert, tenant.rut_emisor, track)
            except SiiError as exc:
                print(f"   {datetime.now(ZONA_CHILE):%H:%M:%S}  ({_transcurrido(subido)})  consulta falló: {exc}")
                continue
            print(f"   {datetime.now(ZONA_CHILE):%H:%M:%S}  ({_transcurrido(subido)})  {resultado.estado}: "
                  f"{resultado.aceptados} aceptados, {resultado.reparos} con reparos, {resultado.rechazados} rechazados")
            if resultado.estado not in ("REC", "SOK", "CRT", "FOK", "PDR", "PRD", "-"):
                break
    await redis.aclose()

    limpio = (
        resultado is not None
        and resultado.estado == "EPR"
        and resultado.aceptados == len(set_.casos)
        and not resultado.reparos
        and not resultado.rechazados
    )
    if limpio:
        async with tenant_session(tenant_id) as sesion:
            await sesion.execute(
                Document.__table__.update().where(Document.id.in_(list(ids.values()))).values(estado="ACEPTADO")
            )
        print(f"El set completo fue aceptado sin reparos. Para declarar el avance en el SII:")
        print(f"   N° de envío: {track}")
        print(f"   Fecha de envío: {subido:%d-%m-%Y}")
    else:
        print("El set NO quedó limpio: no declarar el avance con este envío. Detalle del SII:")
        if resultado is not None:
            print(resultado.crudo)
    await get_engine().dispose()
    return 0 if limpio else 1


# ----------------------------------------------------------------- muestras --


async def modo_muestras() -> int:
    """PDF de los documentos del set, para la etapa de muestras impresas.

    Uno por documento, y además la copia cedible de cada factura. Se generan del
    XML firmado que está en S3, igual que `GET /documents/{id}/pdf`: lo impreso
    es lo que recibió el SII. No toca el SII.
    """
    from pathlib import Path

    from app.dte.pdf import DatosImpresion, es_cedible, generar_pdf

    set_ = _leer_set()
    oficina = _requerida("DTE_EMISOR_OFICINA_SII")
    carpeta = Path(os.environ.get("DTE_MUESTRAS", "/tmp/muestras"))
    carpeta.mkdir(parents=True, exist_ok=True)
    prefijo = f"set-{set_.numero_atencion}-"

    almacen = Almacen(get_settings())
    async with control_session() as sesion:
        tenants = (await sesion.execute(select(Tenant))).scalars().all()
    escritos = 0
    for tenant in tenants:
        async with tenant_session(tenant.id) as sesion:
            docs = (
                await sesion.execute(
                    select(Document)
                    .where(Document.external_id.like(prefijo + "%"))
                    .order_by(Document.tipo_dte, Document.folio)
                )
            ).scalars().all()
        if not docs:
            continue
        # Queda guardada para que la API también la imprima.
        async with control_session() as sesion:
            await sesion.execute(update(Tenant).where(Tenant.id == tenant.id).values(oficina_sii=oficina))
        for doc in docs:
            if doc.estado != "ACEPTADO":
                print(f"   tipo {doc.tipo_dte} folio {doc.folio}: está {doc.estado}, se omite")
                continue
            xml = await almacen.leer(doc.xml_key, doc.xml_sha256)
            cedible_ = es_cedible(doc.tipo_dte, doc.payload.get("ind_traslado"))
            for cedible in (False, True) if cedible_ else (False,):
                pdf = generar_pdf(xml, DatosImpresion(tenant.resolucion_numero, tenant.resolucion_fecha, oficina, cedible))
                nombre = f"{doc.external_id.removeprefix(prefijo)}_DTE{doc.tipo_dte}_F{doc.folio}{'_cedible' if cedible else ''}.pdf"
                (carpeta / nombre).write_bytes(pdf)
                print(f"   {nombre}")
                escritos += 1
    await get_engine().dispose()
    if not escritos:
        print(f"No hay documentos del set {set_.numero_atencion}: primero corre el modo 'set'.")
        return 1
    print(f"{escritos} PDF en {carpeta}")
    return 0


# -------------------------------------------------------------------- libro --

#: Folio de notificación de cada libro en certificación (inst_set_pruebas.pdf).
_FOLIO_NOTIFICACION = {"ventas": 1, "compras": 2}


async def _documentos_del_set_basico(claves: list[str]) -> tuple[Tenant, list[Document]]:
    """El emisor que emitió el set básico y sus documentos, en el orden de los casos."""
    async with control_session() as sesion:
        tenants = (await sesion.execute(select(Tenant))).scalars().all()
    for tenant in tenants:
        async with tenant_session(tenant.id) as sesion:
            docs = {
                d.external_id: d
                for d in (
                    await sesion.execute(select(Document).where(Document.external_id.in_(claves)))
                ).scalars()
            }
        if docs:
            faltan = [c for c in claves if c not in docs or docs[c].estado != "ACEPTADO"]
            if faltan:
                sys.exit(f"El set básico no está completo y aceptado; faltan: {', '.join(faltan)}")
            return tenant, [docs[c] for c in claves]
    sys.exit("No hay documentos del set básico: primero corre el modo 'set'.")


def _detalle_venta(doc: Document):
    from app.dte.libros import DetalleCV

    referencia = next((r for r in doc.payload.get("referencias", []) if r["tipo_doc"] != "SET"), None)
    return DetalleCV(
        tipo_doc=doc.tipo_dte, folio=doc.folio, fecha=doc.fecha_emision, rut=doc.receptor_rut,
        razon_social=(doc.payload.get("receptor") or {}).get("razon_social"),
        exento=doc.monto_exento, neto=doc.monto_neto, iva=doc.monto_iva, total=doc.monto_total,
        tasa_iva=Decimal(19) if doc.monto_neto else None,
        tipo_doc_ref=int(referencia["tipo_doc"]) if referencia else None,
        folio_ref=int(referencia["folio"]) if referencia else None,
    )


async def modo_libro() -> int:
    """Arma, firma y sube el libro de ventas o de compras del set (`DTE_LIBRO`).

    El de ventas sale de los documentos del set básico ya aceptados; el de
    compras, de la tabla del set de libro de compras. Los dos van al período de
    los documentos del set básico. Guarda una copia del XML en `DTE_MUESTRAS`.

    Cada corrida es un envío nuevo al SII: no correrlo dos veces sin necesidad.
    """
    from pathlib import Path

    from app.dte.libros import COMPRA, Caratula, construir_libro_cv, firmar_libro
    from app.dte.libros import VENTA as OPERACION_VENTA
    from app.dte.set_pruebas import detalles_libro_compras, parsear_libro_compras, parsear_set

    libro = os.environ.get("DTE_LIBRO", "").strip().lower()
    if libro not in _FOLIO_NOTIFICACION:
        sys.exit("DTE_LIBRO debe ser 'ventas' o 'compras'.")
    _, _, cert = _certificado()
    with open(_requerida("DTE_SET"), "rb") as f:
        texto = f.read().decode("latin-1")
    basico = parsear_set(texto, "SET BASICO")
    tenant, docs = await _documentos_del_set_basico([f"set-{basico.numero_atencion}-{c.id}" for c in basico.casos])

    caratula = Caratula(
        rut_emisor=tenant.rut_emisor, rut_envia=cert.rut, periodo=docs[0].fecha_emision.strftime("%Y-%m"),
        fecha_resolucion=tenant.resolucion_fecha, numero_resolucion=tenant.resolucion_numero,
        folio_notificacion=_FOLIO_NOTIFICACION[libro],
    )
    if libro == "ventas":
        arbol = construir_libro_cv(caratula, OPERACION_VENTA, [_detalle_venta(d) for d in docs])
    else:
        compras = parsear_libro_compras(texto)
        arbol = construir_libro_cv(
            caratula, COMPRA, detalles_libro_compras(compras, docs[0].fecha_emision), compras.factor_proporcionalidad
        )
    xml = firmar_libro(arbol, cert)
    carpeta = Path(os.environ.get("DTE_MUESTRAS", "/tmp/muestras"))
    carpeta.mkdir(parents=True, exist_ok=True)
    (carpeta / f"libro_{libro}.xml").write_bytes(xml)
    print(f"Libro de {libro}, período {caratula.periodo}: guardado en {carpeta / f'libro_{libro}.xml'}")

    s = get_settings()
    redis = Redis.from_url(s.redis_url)
    resultado = None
    async with crear_http(s.sii_timeout_segundos) as http:
        sii = ClienteSii(http, redis, ambiente="CERT", ttl_token=s.sii_token_ttl_segundos)
        track = await sii.enviar(Canal.DTE, tenant.id, cert, tenant.rut_emisor, xml, f"libro-{libro}.xml")
        subido = datetime.now(ZONA_CHILE)
        print(f"Envío del libro: track {track}, subido {subido:%H:%M:%S} hora de Chile")
        while (datetime.now(ZONA_CHILE) - subido).total_seconds() < _ESPERA_TOTAL_SEGUNDOS:
            await asyncio.sleep(_CONSULTA_RAPIDA_SEGUNDOS)
            try:
                resultado = await sii.consultar(Canal.DTE, tenant.id, cert, tenant.rut_emisor, track)
            except SiiError as exc:
                print(f"   ({_transcurrido(subido)})  consulta falló: {exc}")
                continue
            print(f"   ({_transcurrido(subido)})  {resultado.estado}: {resultado.glosa or ''}")
            if resultado.estado not in ("REC", "SOK", "CRT", "FOK", "PDR", "PRD", "-"):
                break
    await redis.aclose()
    await get_engine().dispose()

    if resultado is None:
        print(f"El SII todavía no responde. Consultar el track {track} más tarde.")
        return 1
    # ponytail: los estados finales de un libro (LOK, LTC, LRH...) no están en los
    # documentos que revisamos; se trata como rechazo lo que empieza con "LR" y
    # se muestra la respuesta completa para decidir a mano.
    print(resultado.crudo)
    rechazado = resultado.estado.startswith("LR") or resultado.estado.startswith("R")
    if not rechazado:
        print(f"Para declarar el avance: N° de envío {track}, fecha {subido:%d-%m-%Y}")
    return 1 if rechazado else 0


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
                    select(Document.id, Document.tipo_dte, Document.folio).where(
                        Document.estado == "VERIFICAR",
                        # Reenvía de a uno: el set tiene que ir entero en un solo envío.
                        Document.external_id.not_like("set-%"),
                    )
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
    from app.dte.set_pruebas import armar_documento, folios_necesarios, resolver_lineas

    set_ = _leer_set()
    resueltos = resolver_lineas(set_)
    nombres = {33: "Factura", 34: "Factura exenta", 52: "Guía de despacho", 56: "Nota de débito", 61: "Nota de crédito"}
    traslados = {1: "venta", 5: "traslado interno (receptor = emisor)"}
    despachos = {1: "por cuenta del cliente", 2: "del emisor al local del cliente", 3: "del emisor a otras instalaciones"}
    codigos = {1: "anula", 2: "corrige texto", 3: "corrige montos"}

    print(f"Set número de atención {set_.numero_atencion}: {len(set_.casos)} casos\n")
    folios: dict[str, tuple[int, int]] = {}
    for caso in set_.casos:
        lineas, global_pct = resueltos[caso.id]
        # Solo se muestran montos: el receptor real del traslado interno lo pone `set`.
        datos = armar_documento(
            set_, caso, lineas, global_pct, _RECEPTOR_PRUEBA, date.today(), folios, _RECEPTOR_PRUEBA
        )
        folios[caso.id] = (caso.tipo_dte, 0)
        print(f"CASO {caso.id} - {nombres[caso.tipo_dte]}")
        if caso.ind_traslado:
            print(f"  traslado: {traslados.get(caso.ind_traslado, caso.ind_traslado)}"
                  + (f", despacho {despachos[caso.tipo_despacho]}" if caso.tipo_despacho else ""))
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
    modos = {"token": modo_token, "enviar": modo_enviar, "verificar": modo_verificar, "set": modo_set,
             "muestras": modo_muestras, "libro": modo_libro}
    if modo not in modos:
        sys.exit(f"Modo desconocido: {modo!r}. Usar 'token', 'enviar', 'verificar', 'set', 'muestras', 'libro' o 'revisar-set'.")
    sys.exit(asyncio.run(modos[modo]()))
