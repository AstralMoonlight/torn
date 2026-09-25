# dte-torn

Microservicio de emisión de Documentos Tributarios Electrónicos para el SII de
Chile. Multi-tenant, sin proveedor intermediario: la firma y el envío son
propios.

El diseño completo -modelo de datos, flujo de estados, decisiones y por qué-
está en [DESIGN.md](DESIGN.md). Este README es solo la puesta en marcha.

## Estado

Construido y verificado (250 tests en verde dentro del contenedor):

- Esquema completo con Row Level Security por tenant (migración `0001`),
  incluyendo el rol `dte_app` sin `BYPASSRLS` y `audit_log` append-only.
- Asignación atómica de folios e idempotencia de emisión (`app/dte/folios.py`).
- Cifrado de secretos por tenant (`app/core/crypto.py`) y carga del certificado
  digital con auditoría de cada acceso (`app/core/certificados.py`) - issue #15.
- Canario de la llave maestra: el servicio no arranca si la llave configurada
  no es la que cifró los datos existentes.
- Carga de CAF (`app/dte/caf.py`) - issue #22: parseo, validación contra el
  RUT del tenant, rechazo de rangos solapados y guardado cifrado byte a byte.
- Construcción del XML del DTE (`app/dte/builder.py`) - issue #14: facturas,
  exentas, notas de crédito/débito y boletas, validadas contra los XSD oficiales
  del SII versionados en `app/dte/xsd/`. El esquema de boletas del SII trae un
  defecto que libxml2 no compila; el test lo corrige en una copia (ver
  `tests/test_builder_xsd.py`) y avisa si el SII lo cambia.
- Timbre (TED) y firma XMLDSig del DTE (`app/dte/signer.py`) - issue #20: con
  los algoritmos que fija el SII, verificado dentro del sobre `<EnvioDTE>` y
  validado contra el XSD con timbre y firma reales.
- Cliente del SII (`app/dte/sii_client.py`) y sobre firmado (`firmar_sobre`) -
  issue #21: semilla, token cacheado en Redis, envío y consulta, para facturas
  (SOAP) y boletas (REST). Endpoints y formatos de respuesta verificados contra
  el SII real; los sobres validan contra `EnvioDTE_v10.xsd` y
  `EnvioBOLETA_v11.xsd`.
- **Verificado contra el SII de certificación (2026-09-23):** con un certificado
  real, maullin y apicert aceptaron la firma y entregaron token por los dos
  canales (`app/scripts/certificacion.py`).
- **Primer documento real aceptado por el SII de certificación (2026-09-23):**
  una factura emitida de punta a punta por este servicio (`certificacion
  enviar`), track ID 0260003916, estado `EPR` con 1 aceptado.
- Pipeline de vida del documento (`app/dte/pipeline.py`): firmar, enviar y
  consultar como pasos idempotentes, con reintentos y revisión manual basados en
  Postgres, XML y sobres write-once en S3, y la fila de `audit_log` por cada
  firma. Es lo que ejecutarán los workers.
- **Set de pruebas básico aceptado por el SII de certificación (2026-09-23):**
  los 8 casos en un solo envío (`certificacion set`), track 0260023678, `EPR`
  con 8 aceptados y sin reparos. Avance declarado; en revisión del SII.
- API HTTP (`app/api.py`): emisor, certificado (#15), CAF (#22), emisión de
  documentos y boletas, consulta, XML y PDF. Ver [API](#api).
- Capa de colas (`app/tasks/`): workers Taskiq de firma, envío y estado, con
  circuit breaker hacia el SII y semáforo por RUT, y un scheduler que reconcilia
  contra Postgres y vigila folios, CAF vencidos y certificados. Ver
  [Workers](#workers-y-scheduler).
- Representación impresa (`app/dte/pdf.py`): PDF carta generado del XML
  firmado, con el timbre en PDF417 (verificado leyéndolo de vuelta con un lector
  real) y copia cedible de facturas.
- Imagen multi-stage con `lxml` y `xmlsec` compilados contra la misma libxml2,
  comprobado firmando y verificando un XMLDSig de verdad.

Pendiente: `caf_request.py` (pedir folios al SII sin intervención; hoy el
scheduler solo alerta cuando quedan pocos), el RCOF diario de boletas, la
verificación por folio de boletas tras una subida ambigua (hoy va a revisión
manual), el formato 80 mm para impresora térmica y el envío del PDF por correo.

## Puesta en marcha

```bash
cp .env.example .env
python -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
# pegar el resultado en DTE_MASTER_KEY y poner algo en DTE_INTERNAL_API_KEY
docker compose up -d --build
```

El primer build compila `lxml` y `xmlsec` desde fuente y tarda varios minutos;
es a propósito (ver el comentario en `requirements.txt`).

La API queda en `http://127.0.0.1:8001` - solo loopback. El servicio **no se
expone**: quien lo consume es el backend, por la red interna de Docker. En
despliegue hay que borrar el bloque `ports:` del servicio `api`.

Las migraciones las aplica el propio contenedor al arrancar
(`alembic upgrade head`), incluyendo la creación del rol `dte_app` y las
políticas RLS.

## Tests

Corren dentro del contenedor, contra el PostgreSQL del compose: lo que se prueba
es `SELECT ... FOR UPDATE`, `ON CONFLICT` y RLS, que en SQLite no existen.

```bash
docker compose --profile test run --rm tests
```

El servicio `tests` no monta el código: después de editar hay que reconstruirlo
(`docker compose --profile test build tests`), o montarlo para iterar:

```bash
docker compose --profile test run --rm -v ./app:/srv/app -v ./tests:/srv/tests tests pytest -q
```

(En Git Bash de Windows, anteponer `MSYS_NO_PATHCONV=1` o las rutas del
contenedor se convierten a rutas de Windows.)

## Variables de entorno

Todas llevan prefijo `DTE_`. La plantilla completa está en `.env.example`.

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DTE_MASTER_KEY` | sí | 32 bytes en base64. De acá se derivan por HKDF las llaves que cifran cada certificado y cada CAF. **Si se pierde, todo lo cifrado con ella es irrecuperable.** Nunca en la base de datos ni en el repositorio. Ver la sección siguiente. |
| `DTE_MASTER_KEY_VERSION` | no (`1`) | Versión con la que se cifra lo nuevo. Sube al rotar. |
| `DTE_MASTER_KEYS_ANTERIORES` | no (`{}`) | JSON `{"1": "<base64>"}` con las llaves previas, para seguir leyendo lo cifrado antes de una rotación. |
| `DTE_INTERNAL_API_KEY` | sí | Clave compartida con el backend que consume el servicio. |
| `DTE_DATABASE_URL` | sí | Conexión del rol de aplicación (`dte_app`), **sin** `BYPASSRLS`. |
| `DTE_DATABASE_OWNER_URL` | sí | Conexión del rol dueño. Solo la usa Alembic. |
| `DTE_APP_DB_PASSWORD` | sí | Clave con la que la migración inicial crea `dte_app`. |
| `DTE_REDIS_URL` | sí | Broker de Taskiq y caché del token del SII. |
| `DTE_S3_ENDPOINT_URL` / `_ACCESS_KEY` / `_SECRET_KEY` / `_BUCKET` | sí | MinIO o cualquier S3: ahí viven los XML firmados y los PDF. |
| `DTE_ENV` | no (`dev`) | `dev` / `staging` / `prod`. |
| `DTE_SENTRY_DSN` | no | Si está, se inicializa Sentry. |
| `DTE_FOLIO_UMBRAL_ALERTA` | no (`100`) | Folios restantes bajo los cuales el scheduler alerta. |
| `DTE_SII_CONCURRENCIA_POR_RUT` | no (`2`) | Envíos simultáneos al SII por RUT emisor. |
| `DTE_PROCESOS_FIRMA` | no (`2`) | Procesos del pool de firma del worker de firma. |
| `DTE_METRICAS_PUERTO` | no | Puerto de métricas Prometheus de un worker o del scheduler (el compose usa `9000`). La API las sirve en `/metrics`. |

## API

Solo la consume el backend Torn. Todo pide `X-Internal-Api-Key`; lo que es de
una empresa pide además `X-Tenant-Id`, que fija el RLS: un documento de otra
empresa responde 404. `X-Actor` (opcional) es el usuario del backend que hizo
la acción, para la auditoría.

| Método y ruta | Qué hace |
|---|---|
| `PUT /tenants/{id}` | Alta o actualización del emisor, copia del `Issuer` del backend (idempotente). Incluye `resolucion_numero`/`_fecha` y `oficina_sii`. |
| `POST /certificates` | Sube el `.pfx` (multipart `archivo` + `password`); queda cifrado y activo. |
| `GET /certificates/actual` | Titular y vigencia del certificado, sin material sensible (para el dashboard). |
| `POST /cafs` | Carga manual de un CAF (multipart `archivo`). |
| `GET /folios` | Folios disponibles por tipo de documento. |
| `POST /documents` | Emite factura, exenta o nota. Idempotente por `external_id`: el mismo pedido devuelve el mismo folio (200); otro contenido con el mismo `external_id` es 409. Firma en línea: la respuesta trae el folio y el `ted` para imprimir. |
| `POST /boletas` | Igual, para boletas 39/41. |
| `GET /documents` | Listado (`estado`, `tipo_dte`, `limit`, `offset`). |
| `GET /documents/{external_id}` | Estado del documento, track ID y respuesta del SII. |
| `GET /documents/{external_id}/xml` | El XML firmado, tal como se envió. |
| `GET /documents/{external_id}/pdf` | Representación impresa; `?cedible=true` para la copia cedible de facturas. |

Todo lo que puede rechazar un documento se valida **antes** de asignar el folio:
un 422 nunca quema uno. Sin folios disponibles: 409.

## Workers y scheduler

`docker compose up -d` levanta, además de la API, un worker por cola y el
scheduler (ver `app/tasks/colas.py` y `app/tasks/scheduler.py`):

| Servicio | Qué hace |
|---|---|
| `worker-firma` | Firma lo que quedó `PENDIENTE` (si la firma en línea de la API falló). |
| `worker-envio` | Sube al SII y resuelve subidas ambiguas. Semáforo por RUT y circuit breaker por ambiente y canal: si el SII deja de responder, pausa las subidas en vez de insistir. |
| `worker-estado` | Consulta el resultado del SII. |
| `scheduler` | Cada 15 s encola lo que tiene un paso vencido (con un lease de 5 min) y rescata pasos colgados; un `ENVIANDO` huérfano va a `VERIFICAR`, nunca a reenviarse. Cada 10 min: folios, CAF vencidos, vigencia del certificado y documentos en error. |

Redis es desechable: si se borra, el scheduler vuelve a encolar todo lo
pendiente desde Postgres. Métricas de cada uno en el puerto 9000 de la red
interna (`dte_tareas_total`, `dte_folios_disponibles`,
`dte_certificado_dias_restantes`, `dte_documentos_en_error`); las alertas se
arman sobre esas métricas.

## La llave maestra

`DTE_MASTER_KEY` cifra, indirectamente, los dos secretos que guarda este
servicio: los certificados digitales de cada empresa y los CAF. **No existe
recuperación**: si la llave desaparece, no hay forma de volver a abrirlos.

El alcance exacto de esa pérdida, que conviene tener claro para no
sobredimensionarlo ni subestimarlo:

| Qué | Qué pasa si se pierde la llave |
|---|---|
| Documentos ya emitidos y firmados | **Intactos.** El XML firmado vive en S3 sin cifrar con esta llave; es un registro tributario, no un secreto |
| Certificados `.pfx` | Cada empresa vuelve a subir el suyo. Fricción, no pérdida |
| CAF | Se pierden los folios **no usados** de cada rango. Hay que pedir CAF nuevos y declarar al SII los del rango viejo como no utilizados |

Es decir: un mal día con trámite tributario, no una catástrofe. Suficiente para
justificar respaldo serio, no suficiente para justificar un HSM.

Por eso:

- Tres copias de la llave, una de ellas fuera de línea, en el mismo lugar donde
  se guarda la clave del certificado del SII.
- No en un `.env` suelto en un servidor, que es lo que termina pasando si nadie
  lo escribe antes.
- Quien pueda restaurarla no puede ser una sola persona.

### El canario

El accidente probable no es que roben la llave: es un despliegue con la
variable vacía, renombrada o apuntando a otro secreto. Sin protección el
servicio arrancaría, cifraría lo nuevo con la llave equivocada y dejaría
ilegible lo anterior, y el síntoma aparecería recién en la primera venta que
necesita firmar.

La tabla `crypto_canary` guarda un texto conocido cifrado con la llave vigente,
y el arranque lo vuelve a abrir. Si no calza, **el proceso no parte**. Es
deliberado: un contenedor que no levanta se nota en el despliegue; uno cifrando
con la llave equivocada se nota cuando ya es tarde.

### Rotar la llave

1. Generar la llave nueva y dejar la vieja en `DTE_MASTER_KEYS_ANTERIORES`
   bajo su número de versión.
2. Subir `DTE_MASTER_KEY_VERSION`.
3. Desplegar. Lo nuevo se cifra con la llave nueva; lo viejo se sigue leyendo
   con la anterior, porque cada fila guarda su `key_version`.
4. La llave vieja se puede sacar recién cuando no quede ninguna fila con esa
   versión en `certificates` ni `cafs`, y entonces se borra también su fila de
   `crypto_canary`.

`crypto_canary` tiene una fila por versión que alguna vez se usó, y el arranque
las comprueba **todas**. Si se rota y la llave anterior se cae del entorno, el
servicio no parte, en vez de arrancar y fallar recién en la primera firma.

No hay comando de re-cifrado masivo todavía: mientras la llave anterior siga
cargada no hace falta, y escribirlo antes de necesitarlo es escribirlo sin saber
qué necesita.

## Diagnóstico contra el SII de certificación

Antes de emitir nada, conviene confirmar que el SII acepta nuestra firma con el
certificado real. El script pide semilla y token por los dos canales; si el SII
entrega el token, la firma XMLDSig funciona contra el SII de verdad. No emite
documentos ni toca la base de datos.

1. Poner la clave del .pfx en `.env` como `DTE_CERT_PASSWORD` (nunca en el
   comando, nunca en un chat).
2. Correr, cambiando el nombre del archivo:

```bash
docker compose run --rm -v "./certificado.pfx:/tmp/cert.pfx:ro" -e DTE_CERT_PFX=/tmp/cert.pfx api python -m app.scripts.certificacion
```

Si falla con `SiiAutenticacionError`, casi siempre es que el titular del
certificado no está autorizado en el SII para operar la facturación electrónica
de la empresa; eso se configura en el portal del SII.

### Enviar un documento de prueba

`enviar` emite **un documento real** al SII de certificación y espera su
resultado, recorriendo el mismo pipeline que los workers. Gasta un folio del CAF
de certificación y el documento queda registrado en el SII de pruebas. Siempre
contra certificación: nunca toca producción.

Necesita, además de lo anterior, completar en `.env` `DTE_FCH_RESOL` y los
`DTE_EMISOR_*`, y un CAF de certificación (el tipo de documento sale del CAF):

```bash
docker compose run --rm -v "./certificado.pfx:/tmp/cert.pfx:ro" -e DTE_CERT_PFX=/tmp/cert.pfx -v "./caf.xml:/tmp/caf.xml:ro" -e DTE_CAF=/tmp/caf.xml api python -m app.scripts.certificacion enviar
```

### Set de pruebas y muestras impresas

`set` emite los casos del set de pruebas en **un solo envío**, como exige la
declaración de avance, y muestra el N° de envío a declarar. `muestras` genera
los PDF de esos documentos (y la copia cedible de las facturas) para la etapa
de muestras impresas, sin tocar el SII:

```bash
docker compose run --rm -v "../setDePruebas/SIISetDePruebas<N>.txt:/tmp/set.txt:ro" -e DTE_SET=/tmp/set.txt -v "../setDePruebas/muestras:/tmp/muestras" api python -m app.scripts.certificacion muestras
```

Necesita `DTE_EMISOR_OFICINA_SII` en `.env` (la unidad del SII que va bajo el
recuadro rojo).

## Tres cosas que no hay que tocar sin leer primero

**`SET LOCAL` en `app/db.py`.** El aislamiento entre tenants depende de que
`app.tenant_id` muera con la transacción. Un `SET` sin `LOCAL` sobrevive en la
conexión, vuelve al pool y el siguiente tenant que la tome hereda el filtro del
anterior. Por eso no existe forma de obtener una sesión sin declarar el tenant.

**`--no-binary lxml,xmlsec` en el Dockerfile.** Los wheels de ambos traen su
propia copia estática de libxml2; con las dos cargadas en el mismo proceso,
firmar un árbol de lxml con xmlsec termina en segfault, no en excepción.

**`import lxml.etree` en `app/__init__.py`.** Si `xmlsec` se importa antes que
`lxml`, después del primer parseo libxml2 deja de poder abrir archivos por ruta
(`etree.parse("x.xsd")` falla sin detalle; parsear bytes sigue funcionando).
Ese import garantiza el orden para toda la aplicación.
