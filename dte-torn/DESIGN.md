# dte-torn - Diseño (revisión previa a la implementación)

Microservicio de emisión de DTE para el SII de Chile. Multi-tenant, consumido
por un backend interno vía API. Firma y envío propios, sin proveedor intermedio.

---

## 1. Multi-tenancy: un solo esquema + RLS

A diferencia del backend Torn (tenant-per-schema), acá va **un esquema con RLS**:
el volumen de tablas es chico y RLS evita el `schema_translate_map` y el
aprovisionamiento por Alembic que ya dio problemas.

- Toda tabla de tenant lleva `tenant_id UUID NOT NULL`.
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
- Política: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`.
- La app conecta con un rol **sin** `BYPASSRLS`; las migraciones con el owner.
- Cada transacción abre con `SET LOCAL app.tenant_id = '<uuid>'`.
  `SET LOCAL` y no `SET`: con pool de conexiones, un `SET` sin `LOCAL` se filtra
  al siguiente tenant que tome esa conexión. Esta es la falla de seguridad más
  probable de todo el servicio; va con test.

---

## 2. Modelo de datos

### `tenants` (sin RLS - tabla de control)

| columna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| rut_emisor | text UNIQUE | `76123456-7` |
| razon_social, giro, acteco, direccion, comuna, ciudad | text | van en `<Emisor>` |
| ambiente | enum CERT / PROD / DEV | endpoints y RUT distintos; DEV (Desarrollador) firma y timbra con un CAF de prueba propio y no habla con el SII |
| resolucion_numero, resolucion_fecha | int / date | van en el CAF y en la carátula del envío |
| oficina_sii | text NULL | unidad del SII bajo el recuadro del PDF (`S.I.I. - CONCEPCION`); migración `0003` |
| activo | bool | |
| created_at, updated_at | timestamptz | |

Los datos del emisor **no se capturan acá**: son una copia sincronizada del
`Issuer` que el backend Torn ya tiene por tenant (`backend/app/models/issuer.py`,
mismos campos). El backend hace `PUT /tenants/{id}` cuando crea o edita su
emisor; es una llamada por cambio, no por documento. Ver §8.4.

### `certificates` - certificado digital de la empresa

| columna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid | |
| pfx_cifrado | bytea | AES-256-GCM |
| password_cifrada | bytea | idem, nonce propio |
| nonce_pfx, nonce_password | bytea | |
| key_version | smallint | rotación de llave maestra |
| subject_rut, fingerprint_sha256 | text | el fingerprint va en la auditoría |
| not_before, not_after | timestamptz | alerta de vencimiento |
| activo | bool | índice único parcial: 1 activo por tenant |
| uploaded_at, uploaded_by | timestamptz / text | |

**Cifrado (envelope):** `DTE_MASTER_KEY` (32 bytes, fuera de la BD, env o KMS) →
`HKDF-SHA256(master, salt=tenant_id, info="dte-cert-v1")` = llave por tenant →
AES-256-GCM con AAD = `f"{tenant_id}:{cert_id}"`. Ningún tenant comparte llave;
el AAD impide mover un blob cifrado de un tenant a otro. `key_version` está
desde el día uno porque rotar sin esa columna es una migración bajo fuego.

### `cafs` - folios autorizados

| columna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenant_id, tipo_dte | uuid, smallint | |
| ambiente | text | el del tenant al cargarlo; cada ambiente tiene sus folios (migración `0004`) |
| folio_desde, folio_hasta | int | |
| ultimo_folio_usado | int | puntero; arranca en `folio_desde - 1` |
| xml_cifrado, nonce, key_version | bytea | el CAF **completo**, byte a byte |
| fecha_autorizacion, fecha_vencimiento | date | |
| estado | enum ACTIVO / AGOTADO / VENCIDO | |

El CAF se cifra entero porque contiene la llave RSA privada que firma el TED.
Se guarda byte a byte y el nodo `<CAF>` se recupera cortando los bytes
originales, sin reserializarlo. Dentro del `<TED>` va aplanado (ver §6).

### `documents` - el agregado central

| columna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid | |
| external_id | text | **clave de idempotencia del llamador** |
| tipo_dte | smallint | 33/34/39/41/52/56/61 |
| folio | int NULL | NULL solo si quedó en `ERROR_VALIDACION` |
| caf_id | uuid | de qué CAF salió el folio |
| estado | enum | ver §3 |
| payload | jsonb | entrada canónica del llamador, congelada |
| payload_hash | text | mismo `external_id` + payload distinto → 409 |
| receptor_rut, receptor_razon_social | text | para listados |
| monto_neto, monto_exento, monto_iva, monto_total | bigint | CLP entero, sin centavos |
| fecha_emision | date | |
| xml_key, xml_sha256, xml_bytes | text / text / int | objeto S3 del XML firmado |
| ted_barcode | text | PDF417 para impresión, derivado del XML |
| envio_id | uuid NULL | último envío |
| estado_sii, glosa_sii | text | respuesta cruda del SII |
| pdf_key | text NULL | |
| intentos | smallint | |
| next_action_at | timestamptz NULL | motor de reintentos y reconciliación |
| last_error | text | |
| created_at, updated_at | timestamptz | |

Índices y constraints:

- `UNIQUE (tenant_id, external_id)` - respaldo duro de la idempotencia.
- `UNIQUE (tenant_id, ambiente, tipo_dte, folio)` - respaldo duro contra folio duplicado. `documents.ambiente`
  es el del tenant al emitir: fija a qué SII va aunque el tenant cambie de ambiente, y `GET /documents` y
  `GET /folios` muestran solo los del ambiente actual.
- `(estado, next_action_at) WHERE estado NOT IN (terminales)` - el barrido del
  scheduler.

### `envios` - envío al SII (EnvioDTE)

El SII entrega **un TrackID por envío, no por documento**. Modelarlo al revés es
el error clásico.

| columna | tipo | nota |
|---|---|---|
| id, tenant_id | uuid | |
| tipo_envio | enum DTE / BOLETA / RCOF | endpoint, XSD y consulta distintos |
| periodo | date NULL | solo RCOF: el día que reporta |
| track_id | text | |
| xml_key, xml_sha256 | text | el envío tal cual se mandó |
| estado | enum ENVIADO / ACEPTADO / REPAROS / RECHAZADO / ERROR | |
| respuesta_raw | text | |
| consultas, next_poll_at | smallint, timestamptz | backoff creciente |
| sent_at | timestamptz | |

`UNIQUE (tenant_id, periodo) WHERE tipo_envio = 'RCOF'`: el Consumo de Folios es
uno por día y por emisor; el índice impide que un reintento mande dos.

`documents.envio_id` → `envios.id`. Un envío puede llevar N documentos desde el
día uno sin tabla intermedia; el lote por defecto es 1. Si un envío se rechaza
por transporte, el documento se re-envía y apunta a un envío nuevo; el anterior
queda como fila histórica.

### `audit_log` - append-only

`tenant_id, document_id, operacion (FIRMA | ACCESO_CERT | CARGA_CAF | ENVIO |
CONSULTA), resultado, cert_fingerprint, detalle jsonb, actor, created_at`.
Sin política de UPDATE ni DELETE: la tabla solo acepta INSERT.

### `dead_letters`

`tenant_id, document_id, cola, error, traceback, intentos, created_at, resolved_at`.

### `folio_requests`

`tenant_id, tipo_dte, cantidad, maximo_autorizado, estado (PENDIENTE | EN_CURSO |
COMPLETADA | REVISAR), paso, respuesta jsonb, caf_id, created_at, updated_at`.

`UNIQUE (tenant_id, tipo_dte) WHERE estado IN ('PENDIENTE','EN_CURSO')` - el SII
no es idempotente pidiendo folios; ver §7.

**Sin tabla de tokens SII**: el token es efímero y se vuelve a pedir; vive solo
en Redis. Perderlo no pierde información.

**Sin tabla de api_keys**: el servicio es interno. Una `INTERNAL_API_KEY` de
servicio + header `X-Tenant-Id`, igual que el backend Torn. (A confirmar.)

---

## 3. Flujo de estados del documento

```
        POST /documents
              │  valida payload (pydantic + reglas de negocio)
              │  ── inválido ──▶ 422, no se persiste, NO se quema folio
              │
              ▼  [tx: asigna folio]  ← §4
         PENDIENTE ──────────────────────────────┐
              │ cola firma                       │
              ▼                                  │
          FIRMANDO ─(timeout)─▶ reencolado       │
              │                                  │
              ▼  XML en S3, inmutable            │
           FIRMADO                               │ ANULADO
              │ cola envio                       │ (folio no usado,
              ▼                                  │  se declara al SII)
          ENVIANDO ─(SII caído / breaker)─▶ espera
              │                                  │
              ▼  track_id                        │
           ENVIADO ◀──────┐                      │
              │ cola estado                      │
              ▼           │ aún en proceso       │
         ┌────┴────┬──────┴──────┐               │
         ▼         ▼             ▼               │
    ACEPTADO   REPAROS      RECHAZADO            │
       ✔          ✔             ✘  (folio quemado;
       │          │           corregir = NC o    │
       │          │           documento nuevo)   │
       └────┬─────┘                              │
            ▼ cola notifica                      │
          PDF + correo                           │

  cualquier paso ── fallo tras N reintentos ──▶ ERROR ──▶ dead_letters
                                                  (reintento manual
                                                   vuelve al estado previo)
```

Terminales: `ACEPTADO`, `REPAROS`, `RECHAZADO`, `ANULADO`, `ERROR_VALIDACION`, `SIMULADO`.

**`SIMULADO`**: un documento de Desarrollador termina acá al firmarse, con XML, timbre y PDF (que lleva
cruzado "DOCUMENTO DE PRUEBA - SIN VALIDEZ TRIBUTARIA"). Nunca se encola para envío. Sus folios salen de un
CAF de prueba que el servicio genera solo (`asegurar_caf_prueba`), de 100.000 folios.

**`VERIFICAR`** (agregado tras un caso real en certificación): la subida salió y
el SII no respondió, así que pudo haber recibido el sobre. No se reenvía: el paso
`verificar` le pregunta al SII por el folio (`getEstDte`). Si no lo tiene, vuelve
a `FIRMADO` y se reenvía; si lo tiene, pasa a `ENVIADO` con el track ID que
informa el SII (`NUM_ATENCION`); si lo tiene con otros datos, `ERROR`. Si no se
puede concluir, sigue en `VERIFICAR` con espera y, tras varios intentos, va a
revisión manual.
`ERROR` **no** es terminal: es reintentable.

Reglas:

- El folio se asigna **después** de validar y **antes** de firmar. Un payload
  inválido nunca quema un folio.
- Una vez asignado, el folio queda amarrado al documento para siempre. Un
  reintento de firma reusa el mismo folio; por eso nunca hay saltos.
- `RECHAZADO` no libera el folio: el documento existe y fue emitido. Se corrige
  con Nota de Crédito o con un documento nuevo, según el caso.
- `ANULADO` es para folios que nunca se usarán; el SII exige declararlos.
- Cada transición es un `UPDATE ... WHERE id = :id AND estado = :esperado`. Si
  afecta 0 filas, otro worker ya hizo el trabajo → la tarea termina sin hacer
  nada. Ahí está la idempotencia, no en Redis.

---

## 4. Asignación atómica de folios

```sql
BEGIN;
SET LOCAL app.tenant_id = :tenant;

-- 1. idempotencia: ¿ya existe?
SELECT id, folio, estado, payload_hash FROM documents
 WHERE tenant_id = :tenant AND external_id = :ext;
--   existe y payload_hash coincide → 200 con el mismo folio
--   existe y payload_hash difiere  → 409

-- 2. CAF activo, fila bloqueada
SELECT * FROM cafs
 WHERE tenant_id = :tenant AND tipo_dte = :tipo
   AND estado = 'ACTIVO' AND fecha_vencimiento >= current_date
 ORDER BY folio_desde
 LIMIT 1
 FOR UPDATE;              -- serializa por (tenant, tipo_dte)
--   sin fila → 409 SIN_FOLIOS

-- 3. folio = ultimo_folio_usado + 1, acotado al rango
UPDATE cafs
   SET ultimo_folio_usado = :folio,
       estado = CASE WHEN :folio >= folio_hasta THEN 'AGOTADO' ELSE 'ACTIVO' END
 WHERE id = :caf_id;

INSERT INTO documents (...) VALUES (..., :folio, 'PENDIENTE');
COMMIT;
```

`SELECT ... FOR UPDATE` sobre la fila del CAF, no advisory lock: el grano que
hay que serializar es exactamente `(tenant, tipo_dte)`, que es la fila, y el
lock lo suelta el COMMIT solo, sin riesgo de fuga. Sin `SKIP LOCKED`: saltarse
la fila bloqueada significaría saltar al CAF siguiente y dejar un hueco.

El `UNIQUE (tenant_id, tipo_dte, folio)` es el cinturón además de los tirantes:
si alguna vez la lógica falla, la BD lo rechaza en vez de emitir un duplicado.

La aritmética del puntero es la misma que `backend/app/utils/folios.py` ya
resolvió (un CAF sin estrenar debe partir en `folio_desde`, no en 1).

---

## 5. Colas y workers

| cola | worker | qué hace | control |
|---|---|---|---|
| `firma` | worker-firma | XML ISO-8859-1 + TED + XMLDSig | `ProcessPoolExecutor`, CPU |
| `envio` | worker-envio | POST al SII | semáforo Redis por RUT emisor |
| `estado` | worker-estado | consulta TrackID | backoff 30s→1m→5m→15m→1h, tope 24h |
| `folios` | worker-estado | pide CAF al bajar del umbral | 1 por tenant/tipo/día |
| `notifica` | worker-estado | PDF + correo | prioridad baja |

`dte/` son funciones puras: reciben datos, devuelven bytes. `tasks/` solo carga
de la BD, llama a `dte/`, persiste y encola la siguiente. Cambiar Taskiq por
otra cosa toca solo `tasks/`.

**Reconciliación (scheduler, cada 60s)** - esto es lo que hace que Redis sea
desechable:

```sql
SELECT id, estado FROM documents
 WHERE estado NOT IN ('ACEPTADO','REPAROS','RECHAZADO','ANULADO','ERROR_VALIDACION','SIMULADO')
   AND next_action_at <= now()
 LIMIT 500;
```

y se reencola según el estado. Si Redis se borra entero, en 60 segundos todo lo
pendiente está de vuelta en las colas. Lo mismo cubre los estados transitorios
colgados (`FIRMANDO` / `ENVIANDO` sin avanzar).

Otros jobs del scheduler: stock de folios por tenant/tipo (alerta + cola
`folios`), CAF vencidos → `VENCIDO`, certificados por vencer.

**Circuit breaker**: contador en Redis por `(ambiente, endpoint)` - el SII es
infraestructura compartida, no por tenant. Abierto → las tareas de `envio`
reprograman `next_action_at` en vez de golpear.

**Cómo quedó implementado (2026-09-23)** - `app/tasks/colas.py` y
`app/tasks/scheduler.py`:

- Tres colas con worker propio: `firma`, `envio` (que también resuelve
  `VERIFICAR`) y `estado`. `folios` y `notifica` no existen todavía porque no
  tienen trabajo: la solicitud automática espera a `caf_request.py` (hoy el
  scheduler alerta por métrica y log) y no hay proveedor de correo definido.
- La API firma **en línea** al emitir, para devolver el timbre en la respuesta
  (§8.6); la cola `firma` queda para reintentos.
- La reconciliación recorre los tenants uno por uno con su propia sesión RLS,
  en vez de una consulta que cruce tenants: no hace falta ninguna función con
  `BYPASSRLS`. Al encolar deja un *lease* de 5 min en `next_action_at`, así un
  documento no se encola en cada ciclo mientras su tarea espera en la cola.
- Un `ENVIANDO` colgado va a `VERIFICAR` (la subida pudo llegar), nunca de
  vuelta a `FIRMADO`. Un `FIRMANDO` colgado vuelve a `PENDIENTE`.

---

## 6. Detalles SII que condicionan el diseño

- El XML se construye y se firma en **ISO-8859-1**. Todo se maneja como `bytes`,
  nunca `str`, desde el primer `lxml.etree.tostring(..., encoding="ISO-8859-1")`.
  Un round-trip por `str` es la forma más fácil de invalidar una firma.
- **Dos firmas distintas**: el `<TED>` se firma con la llave RSA que viene dentro
  del CAF; el `<Documento>` y el `<EnvioDTE>` con el certificado de la empresa.
- El `<DD>` del timbre se arma una sola vez como bytes, **aplanado** (sin
  espacio entre etiquetas, CAF incluido), y esos mismos bytes son los que se
  firman y los que quedan escritos en el documento. `firmar_dte` relee el XML
  final y comprueba que el timbre esté tal cual se firmó. Aplanar también el
  CAF es la lectura más segura de la especificación. **Confirmado** con una
  boleta real de producción de otro proveedor (2026-09-23): su `<DD>` está
  aplanado con el CAF incluido y el timbre verifica sobre esos bytes.
- Documentos **recibidos** (para #12): en una boleta y una factura reales del
  mismo proveedor, la firma del sobre verifica pero la del DTE no, en ningún
  contexto de namespaces (el proveedor re-indenta el DTE después de firmarlo).
  El SII igual se los acepta en producción. No hay
  que exigir la firma del DTE de terceros como condición dura al recibir, o se
  rechazarían documentos que el SII acepta. La emisión propia sigue estricta.
- Algoritmos fijados por el esquema de firma del SII (`xmldsignature_v10.xsd`):
  C14N **inclusivo**, `rsa-sha1` y digest `sha1`. No se eligen.
- El `<DTE>` declara `xmlns:xsi` aunque no lo use. El C14N inclusivo arrastra
  los namespaces de los ancestros, y el `<EnvioDTE>` declara `xsi`: sin esa
  declaración, la forma canónica del `<Documento>` cambia al entrar al sobre y
  la firma deja de verificar. `tests/test_signer.py` tiene el control negativo
  que lo demuestra.
- El `<CAF>` del timbre se pega como texto dentro del `<DTE>` y así hereda el
  namespace del SII. Reconstruido nodo por nodo quedaría con `xmlns=""` y el
  esquema lo rechazaría.
- Orden de elementos y canonicalización según esquema; los XSD del SII se
  versionan en el repo y los tests validan contra ellos.
- Token: semilla → firma de la semilla → token. Cache en Redis por empresa con
  TTL bajo el real, y un reintento único ante 401.
- El XML firmado se guarda en S3 **write-once** y nunca se regenera. El PDF sí se
  regenera, pero **a partir del XML almacenado**, jamás del payload.
- **Boletas (39/41) son otro camino**: `EnvioBOLETA` en vez de `EnvioDTE`, XSD
  propio, consulta de estado propia, y además el RCOF diario. Mismo token, mismo
  certificado, misma máquina de estados; lo que cambia es `sii_client` y un job
  del scheduler. Por eso `envios.tipo_envio` existe desde la primera migración.

---

## 7. Solicitud automática de folios

El flujo "máquina a máquina" del SII no es una API: son CGIs de `palena` que se
autentican con la misma cookie `TOKEN` del envío. Cuatro pasos:

1. token (semilla → firma → token), igual que para enviar;
2. `of_solicita_folios` - devuelve el **máximo autorizado** para ese tipo de DTE;
3. `of_genera_folios` - con la cantidad pedida, acotada a ese máximo;
4. `of_confirma_folios` - devuelve el XML del CAF.

Tres cosas que hay que hacer bien, porque el SII **no es idempotente acá**: pedir
dos veces entrega dos CAF, y los folios del que sobra hay que declararlos como no
usados.

- `UNIQUE (tenant_id, tipo_dte) WHERE estado IN ('PENDIENTE','EN_CURSO')` sobre
  `folio_requests`: doble clic, doble encolado o reintento no pueden abrir dos
  solicitudes del mismo tipo.
- El paso que se alcanzó se persiste en la fila (`estado`, `respuesta` cruda de
  cada paso). Si el proceso muere entre el 3 y el 4, el reintento **retoma**; no
  vuelve al paso 2. Si no puede retomar, la fila queda `REVISAR` y no reintenta
  sola.
- El paso 4 y el `INSERT` en `cafs` van en la misma transacción. Un CAF recibido
  y no guardado es un rango quemado.

Todo esto vive aislado en `dte/caf_request.py`: es la única parte del servicio
que depende de HTML/CGI que el SII puede cambiar sin avisar. Se prueba contra
certificación con capturas reales como golden files, y `POST /cafs` (carga
manual del XML) queda siempre disponible como salida de emergencia.

La cola `folios` dispara la solicitud sola cuando el stock baja del umbral;
`POST /folios/solicitar` es el mismo código para el botón.

---

## 8. Decisiones resueltas

1. **Boletas 39/41: dentro del alcance**, por `EnvioBOLETA` + RCOF diario.
   `envios.tipo_envio` desde la primera migración; el resto del pipeline es el
   mismo. Ver §6.
2. **Auth: `INTERNAL_API_KEY` + `X-Tenant-Id`**, comparada con
   `secrets.compare_digest`, y el contenedor **sin `ports:`** en compose (solo
   `expose`): no es alcanzable fuera de la red de Docker. mTLS es trabajo real
   para cero ganancia dentro de una red privada. Se sube a mTLS o key por tenant
   el día que el servicio tenga hostname propio o ingress público, no antes.
3. **Solicitud de CAF: automatizada**, con el diseño de §7.
4. **Emisor: copia sincronizada desde el backend.** El backend Torn hace
   `PUT /tenants/{id}` (upsert idempotente) cuando guarda su `Issuer`. Una
   llamada por cambio, no por documento: la carga extra es cero. Mandarlo en cada
   documento significaría repetir 8 campos en cada payload y no tener un solo
   lugar donde corregir un dato malo; leerlo directo de la BD del backend
   acoplaría los dos servicios al esquema del otro.
5. **Entrega: `GET /documents/{id}/xml` y `/pdf` desde este servicio**, no URL
   firmada de MinIO. La URL firmada expira, expone la topología del storage,
   exige que MinIO sea alcanzable desde donde se consuma la URL y **se salta el
   chequeo de tenant y el `audit_log`**. El proxy son diez líneas que hacen
   stream desde S3. El frontend ya tiene el patrón de blob autenticado
   (`fetchBlobUrl()`), así que la cadena es frontend → backend Torn → dte-torn →
   MinIO.
6. **Sin webhook de vuelta al backend** (no estaba en la lista, pero se decide
   sola con la 5). El POS necesita folio y TED para imprimir, y los tiene en la
   respuesta del `POST`. El estado final del SII llega minutos después y solo
   importa cuando alguien mira el documento: `GET /documents/{external_id}` en
   ese momento. Un webhook agrega reintentos, firma de payload y un endpoint
   público en el backend para no ganar nada.

---

## 9. Qué pasa con las tablas de DTE del monolito

El backend Torn todavía tiene `backend/app/models/dte.py` con `DTE`, `CAF` y
`FolioRequestLog`, más un `dte_signer.py` vacío. Cuando este servicio esté en
producción, eso queda duplicado. La decisión:

**El monolito deja de ser dueño de los datos tributarios.** Se borran `DTE`,
`CAF` y `FolioRequestLog`, y el router de folios pasa a ser un proxy hacia acá.

El motivo no es el orden, es la corrección. Dos tablas `cafs` con dos punteros
`ultimo_folio_usado` son dos fuentes de verdad para el mismo correlativo, que es
exactamente la clase de error que este servicio existe para evitar. Lo mismo con
el XML: si vive en dos partes, tarde o temprano una de las dos copia la que no
se firmó.

**Con una excepción deliberada:** `Sale` guarda `tipo_dte` y `folio` como copia
de solo lectura, escrita una vez cuando se emite. No es una fuente de verdad, es
una caché de impresión: la boleta se imprime en el mostrador y no puede depender
de que este servicio responda. Todo lo demás -estado del SII, XML, PDF, track
id- se consulta acá, que es donde está el dato y los índices.

Para `#12` (Centro de Facturación) eso significa que la pantalla lee de
`GET /documents`, no de una tabla local. El backend es un proxy autenticado, no
un espejo.

Esto se ejecuta **después** de que el servicio emita de verdad contra
certificación. Hasta entonces las tablas del monolito se quedan donde están:
borrarlas antes sería apostar a que esto funciona.

---

## 10. Pedidos para la capa de API

- **Vigencia del certificado en el dashboard** (pedido del usuario, 2026-09-23):
  `GET /certificates/actual` con titular, `not_before`, `not_after` y días
  restantes, sin material sensible. **Hecho**; falta consumirlo desde el backend. El backend lo consulta y lo muestra en el
  dashboard de la app. Los datos ya están en `certificates`; la alerta de
  vencimiento del scheduler usa los mismos.
