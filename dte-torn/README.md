# dte-torn

Microservicio de emisión de Documentos Tributarios Electrónicos para el SII de
Chile. Multi-tenant, sin proveedor intermediario: la firma y el envío son
propios.

El diseño completo —modelo de datos, flujo de estados, decisiones y por qué—
está en [DESIGN.md](DESIGN.md). Este README es solo la puesta en marcha.

## Estado

Construido y verificado (35 tests en verde dentro del contenedor):

- Esquema completo con Row Level Security por tenant (migración `0001`),
  incluyendo el rol `dte_app` sin `BYPASSRLS` y `audit_log` append-only.
- Asignación atómica de folios e idempotencia de emisión (`app/dte/folios.py`).
- Cifrado de secretos por tenant (`app/core/crypto.py`) y carga del certificado
  digital con auditoría de cada acceso (`app/core/certificados.py`) — issue #15.
- Canario de la llave maestra: el servicio no arranca si la llave configurada
  no es la que cifró los datos existentes.
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
| `DTE_FOLIO_UMBRAL_ALERTA` | no (`100`) | Folios restantes bajo los cuales se pide un CAF nuevo. |
| `DTE_SII_CONCURRENCIA_POR_RUT` | no (`2`) | Envíos simultáneos al SII por RUT emisor. |

## La llave maestra

`DTE_MASTER_KEY` cifra, indirectamente, todo lo que este servicio guarda como
secreto: los certificados digitales de cada empresa y los CAF. **No existe
recuperación.** Si la llave desaparece, cada cliente tiene que volver a subir su
.pfx —molesto pero resoluble— y los CAF quedan ilegibles, que es lo grave: los
folios ya emitidos no se pueden volver a timbrar.

Por eso:

- La llave va en un gestor de secretos con respaldo (no en un `.env` suelto en
  un servidor, que es lo que se termina haciendo si nadie lo escribe antes).
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
   versión (`certificates` y `cafs`).

No hay comando de re-cifrado masivo todavía: mientras la llave anterior siga
cargada no hace falta, y escribirlo antes de necesitarlo es escribirlo sin saber
qué necesita.

## Dos cosas que no hay que tocar sin leer primero

**`SET LOCAL` en `app/db.py`.** El aislamiento entre tenants depende de que
`app.tenant_id` muera con la transacción. Un `SET` sin `LOCAL` sobrevive en la
conexión, vuelve al pool y el siguiente tenant que la tome hereda el filtro del
anterior. Por eso no existe forma de obtener una sesión sin declarar el tenant.

**`--no-binary lxml,xmlsec` en el Dockerfile.** Los wheels de ambos traen su
propia copia estática de libxml2; con las dos cargadas en el mismo proceso,
firmar un árbol de lxml con xmlsec termina en segfault, no en excepción.
