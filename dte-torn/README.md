# dte-torn

Microservicio de emisión de Documentos Tributarios Electrónicos para el SII de
Chile. Multi-tenant, sin proveedor intermediario: la firma y el envío son
propios.

El diseño completo —modelo de datos, flujo de estados, decisiones y por qué—
está en [DESIGN.md](DESIGN.md). Este README es solo la puesta en marcha.

## Estado

Construido y verificado (29 tests en verde dentro del contenedor):

- Esquema completo con Row Level Security por tenant (migración `0001`),
  incluyendo el rol `dte_app` sin `BYPASSRLS` y `audit_log` append-only.
- Asignación atómica de folios e idempotencia de emisión (`app/dte/folios.py`).
- Cifrado de secretos por tenant (`app/core/crypto.py`) y carga del certificado
  digital con auditoría de cada acceso (`app/core/certificados.py`) — issue #15.
- Imagen multi-stage con `lxml` y `xmlsec` compilados contra la misma libxml2,
  comprobado firmando y verificando un XMLDSig de verdad.

Pendiente: carga de CAF (#22), `builder.py` (#14), `signer.py` (#20),
`sii_client.py` (#21), la capa `tasks/` con sus colas, la API y el PDF.

## Puesta en marcha

```bash
cp .env.example .env
python -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
# pegar el resultado en DTE_MASTER_KEY y poner algo en DTE_INTERNAL_API_KEY
docker compose up -d --build
```

El primer build compila `lxml` y `xmlsec` desde fuente y tarda varios minutos;
es a propósito (ver el comentario en `requirements.txt`).

La API queda en `http://127.0.0.1:8001` — solo loopback. El servicio **no se
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
(`docker compose --profile test build tests`).

## Variables de entorno

Todas llevan prefijo `DTE_`. La plantilla completa está en `.env.example`.

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DTE_MASTER_KEY` | sí | 32 bytes en base64. De acá se derivan por HKDF las llaves que cifran cada certificado y cada CAF. **Si se pierde, todo lo cifrado con ella es irrecuperable.** Nunca en la base de datos ni en el repositorio. |
| `DTE_INTERNAL_API_KEY` | sí | Clave compartida con el backend que consume el servicio. |
| `DTE_DATABASE_URL` | sí | Conexión del rol de aplicación (`dte_app`), **sin** `BYPASSRLS`. |
| `DTE_DATABASE_OWNER_URL` | sí | Conexión del rol dueño. Solo la usa Alembic. |
| `DTE_APP_DB_PASSWORD` | sí | Clave con la que la migración inicial crea `dte_app`. |
| `DTE_REDIS_URL` | sí | Broker de Taskiq y caché del token del SII. |
| `DTE_S3_ENDPOINT_URL` / `_ACCESS_KEY` / `_SECRET_KEY` / `_BUCKET` | sí | MinIO o cualquier S3: ahí viven los XML firmados y los PDF. |
| `DTE_ENV` | no (`dev`) | `dev` / `staging` / `prod`. |
| `DTE_SENTRY_DSN` | no | Si está, se inicializa Sentry. |
| `DTE_FOLIO_UMBRAL_ALERTA` | no (`100`) | Folios restantes bajo los cuales se pide un CAF nuevo. |
| `DTE_SII_CONCURRENCIA_POR_RUT` | no (`2`) | Envíos simultáneos al SII por RUT emisor. |

## Dos cosas que no hay que tocar sin leer primero

**`SET LOCAL` en `app/db.py`.** El aislamiento entre tenants depende de que
`app.tenant_id` muera con la transacción. Un `SET` sin `LOCAL` sobrevive en la
conexión, vuelve al pool y el siguiente tenant que la tome hereda el filtro del
anterior. Por eso no existe forma de obtener una sesión sin declarar el tenant.

**`--no-binary lxml,xmlsec` en el Dockerfile.** Los wheels de ambos traen su
propia copia estática de libxml2; con las dos cargadas en el mismo proceso,
firmar un árbol de lxml con xmlsec termina en segfault, no en excepción.
