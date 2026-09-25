# claude.md - Torn

Documento de contexto para asistentes de IA y desarrolladores que trabajen en este repositorio.
Todo lo aquí descrito proviene de la inspección directa de los archivos locales.

---

## 1. Descripción General

**Torn** es un SaaS chileno de **facturación electrónica (DTE / SII) con motor de Punto de Venta (POS)**.

Según la lógica encontrada en `backend/app/`, el sistema cubre:

- **Emisión de DTEs**: delegada al microservicio **`dte-torn/`** (folios, CAF, certificado, XML, firma, envío
  y consulta al SII; ver `dte-torn/DESIGN.md`). El backend lo llama con `backend/app/services/dte_client.py`
  (`TORN_DTE_URL`, `TORN_DTE_API_KEY`) y solo guarda `Sale.tipo_dte`/`Sale.folio` como caché de impresión.
  `backend/app/routers/folios.py` es un proxy hacia dte-torn para CAF, stock de folios y certificado.
  Los tipos de documento manejados en el modelo son 33 (Factura), 34 (Exenta), 39 (Boleta), 41, 56 (ND), 61 (NC).
- **Punto de Venta**: flujo transaccional de venta que valida caja abierta y stock, descuenta inventario,
  registra kardex, registra pagos y emite el DTE en dte-torn dentro de la misma transacción
  (`backend/app/routers/sales.py`). Si dte-torn rechaza o no responde, la venta se revierte.
- **Inventario y catálogo**: productos, marcas, listas de precios, proveedores y compras
  (`backend/app/models/product.py`, `brand.py`, `price_list.py`, `provider.py`, `purchase.py`).
- **Caja**: sesiones de caja con arqueo ciego (`backend/app/models/cash.py`, `backend/app/routers/cash.py`).
- **Clientes y crédito interno**: cuentas corrientes con `current_balance` y medio de pago `CREDITO_INTERNO`.
- **Devoluciones / logística inversa**: reingreso de stock y Nota de Crédito referenciando la venta original.
- **Multi-tenancy SaaS**: arquitectura **tenant-per-schema** de PostgreSQL. El esquema `public` aloja
  `saas_plans`, `tenants`, `saas_users` y `tenant_users` (`backend/app/models/saas.py`), y la sesión de base de datos
  se enruta dinámicamente al esquema del tenant vía cabecera `X-Tenant-Id` (`backend/app/dependencies/tenant.py`).
- **Autenticación y permisos**: JWT (python-jose) con hashing de contraseñas, usuarios globales del SaaS,
  usuarios por tenant y roles/permisos (`backend/app/routers/auth.py`, `users.py`, `roles.py`, `backend/app/utils/security.py`).

---

## 2. Stack Tecnológico

Detectado exclusivamente a partir de los archivos de dependencias y configuración presentes en el repo.

### Backend - `backend/requirements.txt` (sin versiones), `backend/app/`

| Tecnología | Evidencia |
|---|---|
| Python 3.10 | `Dockerfile.backend` (`FROM python:3.10-slim`) |
| FastAPI | `fastapi` en `backend/requirements.txt`, `backend/app/main.py` |
| Uvicorn | `uvicorn`, `httptools`, `watchfiles`, `websockets`, `h11` |
| Starlette | `starlette` |
| SQLAlchemy | `SQLAlchemy`, `greenlet`, `backend/app/database.py` |
| Alembic | `alembic`, `Mako`, `backend/alembic.ini`, `backend/alembic/versions/` |
| PostgreSQL | `psycopg2-binary`, `postgres:18-alpine` en `docker-compose.yml` |
| Pydantic | `pydantic`, `pydantic_core`, `annotated-types`, `backend/app/schemas.py` |
| Jinja2 | `Jinja2`, `MarkupSafe`, `backend/app/templates/` |
| JWT / python-jose | `python-jose`, `ecdsa`, `rsa`, `pyasn1` |
| passlib / bcrypt | `passlib`, `bcrypt` |
| cryptography | `cryptography`, `cffi`, `pycparser` |
| python-dotenv | `python-dotenv`, `load_dotenv()` en `backend/app/database.py` |
| python-multipart | `python-multipart` (formularios OAuth2) |
| PyYAML, anyio, click, idna, six, tomli, tzdata, typing_extensions, typing-inspection, exceptiongroup | `backend/requirements.txt` (dependencias transitivas) |
| Pytest + httpx | `backend/requirements-dev.txt`, `backend/tests/` |

### Frontend - `frontend/package.json`

| Tecnología | Evidencia |
|---|---|
| Next.js 16 | `next`, `eslint-config-next`, `next.config.ts` |
| React 19 | `react`, `react-dom` |
| TypeScript 5 | `typescript`, `tsconfig.json`, `@types/*` |
| Tailwind CSS 4 | `tailwindcss`, `@tailwindcss/postcss`, `tailwind.config.js`, `postcss.config.mjs` |
| Radix UI | ~24 paquetes `@radix-ui/react-*` |
| shadcn/ui | `frontend/components.json` (`$schema: ui.shadcn.com`), `frontend/components/ui/` |
| lucide-react | iconografía |
| Axios | `frontend/services/api.ts` |
| Zustand | `frontend/lib/store` |
| React Hook Form + Zod | `react-hook-form`, `@hookform/resolvers`, `zod` |
| Recharts | gráficos |
| next-themes | tema claro/oscuro |
| class-variance-authority, clsx, tailwind-merge, tailwindcss-animate, aria-hidden, react-remove-scroll | utilidades de estilo |
| ESLint 9 | `eslint`, `eslint.config.mjs` |

### Infraestructura - Dockerfiles y `docker-compose.yml`

| Tecnología | Evidencia |
|---|---|
| Docker / Docker Compose | `Dockerfile.backend`, `Dockerfile.frontend`, `docker-compose.yml` |
| PostgreSQL 18 (alpine) | servicio `db` |
| Node 20 (alpine) | `Dockerfile.frontend` |

> Nota: la firma y el XML del DTE viven en `dte-torn/`, con sus propias dependencias (`dte-torn/requirements.txt`,
> versiones fijas). El backend solo agrega `httpx` para hablar con él.
> no están instaladas ni declaradas en `backend/requirements.txt`, por lo que **no forman parte del stack actual**.

---

## 3. Arquitectura y Modificaciones

### 3.1 Estructura real del repositorio

Reorganizado en 2026-09-17: `backend/` y `frontend/` son ahora hermanos al nivel
de la raíz (antes el backend vivía suelto como `app/`, `alembic/`, `tests/`,
etc. directamente en la raíz, sin envoltorio). La organización efectiva es:

```
Torn/
├── backend/          # Backend FastAPI
│   ├── app/
│   │   ├── main.py           # Entrypoint, CORS, registro de routers
│   │   ├── database.py       # Engine/Session SQLAlchemy, get_db()
│   │   ├── dependencies/     # tenant.py -> resolución de tenant y auth global
│   │   ├── models/           # ORM (saas, user, sale, product, dte, cash, ...)
│   │   ├── routers/          # ~20 routers HTTP (sales, folios, saas, auth, ...)
│   │   ├── schemas.py        # Pydantic por tenant
│   │   ├── schemas_saas.py   # Pydantic del plano SaaS/public
│   │   ├── services/         # dte_client.py (cliente de dte-torn), tenant_service.py
│   │   ├── templates/        # HTML de impresión (ticket 80/57mm y carta)
│   │   └── utils/            # security, validators (RUT), dates, formatters
│   ├── alembic/          # Migraciones (6 revisiones)
│   ├── alembic.ini
│   ├── scripts/          # Mantenimiento/seed (seed_*, setup_*, migrate_*, sync_*, create_admin)
│   │   └── legacy/           # Scripts manuales previos al multi-inquilino (ver su README)
│   ├── tests/            # Pytest de integración (inventory, pos, sales, world_class)
│   ├── pytest.ini
│   └── requirements.txt / requirements-dev.txt
├── frontend/         # App Next.js independiente (node_modules propio)
│   ├── app/              # App Router: pos, caja, inventario, clientes, compras,
│   │                     #   configuracion, dashboard, historial, listas-precios,
│   │                     #   marcas, personal, proveedores, reporte-diario,
│   │                     #   saas-admin/tenants, login, select-tenant, access-denied
│   ├── components/       # layout, pos, inventory, customers, providers, users,
│   │                     #   dashboard, ui (shadcn)
│   ├── services/         # capa Axios por dominio (api.ts + 15 módulos)
│   └── lib/              # utils.ts, rut.ts, store (Zustand)
├── database/         # Datos auxiliares para poblar la BD (actecos_sii.json) - ignorado por git
├── info/             # Documentación estable (DEVELOPER_GUIDE.md, INFORME_TECNICO.md)
├── tasks/            # Trabajo en curso: planes y listas de tareas (plan.md, todo.md, ui_pendientes.md)
├── Dockerfile.backend / Dockerfile.frontend / docker-compose.yml   # en la raíz: orquestan ambos servicios
└── README.md / CLAUDE.md / package.json (shim raíz)
```

Los `Dockerfile.*` y `docker-compose.yml` se quedaron en la raíz a propósito
(el `build.context` sigue siendo `.`): son archivos de orquestación que tocan
ambos servicios, no código de uno solo. `Dockerfile.backend` hace
`COPY backend/ .`; `Dockerfile.frontend` ya copiaba `COPY frontend/ .` desde
antes de esta reorganización, así que no cambió.

Para correr el backend localmente (fuera de Docker) hay que pararse en
`backend/`: `cd backend && uvicorn app.main:app --reload`. Alembic también:
`cd backend && alembic upgrade head` (o `alembic -c backend/alembic.ini ...`
desde la raíz). `backend/app/services/tenant_service.py` invoca Alembic
programáticamente con una ruta absoluta a `backend/alembic.ini` derivada de
`__file__`, así que el aprovisionamiento de tenants no depende del cwd del
proceso (uvicorn, pytest, Docker, etc.).

### 3.2 Cómo interactúan

- **frontend → backend**: el frontend es headless y consume la API por HTTP. `frontend/services/api.ts`
  usa Axios contra `NEXT_PUBLIC_API_URL` (`http://localhost:8000` en `frontend/.env.local` y en
  `docker-compose.yml`). El backend configura CORS con `TORN_CORS_ORIGINS` y, si no está definida, cae a los
  `localhost:3000/3001/3002` de desarrollo (`backend/app/main.py`).
- **Aislamiento por tenant**: el cliente envía el JWT (`Authorization: Bearer`) y la cabecera `X-Tenant-Id`.
  `backend/app/dependencies/tenant.py` valida el token contra `public.saas_users`, resuelve el `schema_name` del
  tenant y entrega una sesión SQLAlchemy apuntando a ese esquema.
- **backend → PostgreSQL**: `backend/app/database.py` construye la URL desde `TORN_DB_USER/PASSWORD/HOST/PORT/NAME`.
  El esquema se versiona con Alembic. En Docker, `backend/scripts/migrar_al_arrancar.py` corre
  `alembic upgrade head` antes de uvicorn (base vacía: `create_all` + `stamp head`); si falla, el
  contenedor no arranca. Las migraciones de tablas de empresa recorren cada esquema con SQL calificado
  (ver `c9d0e1f2a3b4`), porque `op.add_column` con `schema_translate_map` cae en `public`.
  `main.py` hace además `create_all()` al arrancar, salvo que `TORN_AUTO_CREATE_TABLES=0`.
- **Reinicios**: todos los servicios de ambos compose tienen `restart` (`always` en Torn,
  `unless-stopped` en dte-torn), así que vuelven solos tras una caída o un reinicio de Docker.
- **docker (raíz) → ambos**: `docker-compose.yml` levanta `db` (postgres:18-alpine con healthcheck),
  `backend` (build desde `Dockerfile.backend`, `env_file: .env`, override `TORN_DB_HOST: db`, puerto 8000,
  `depends_on: db healthy`) y `frontend` (build desde `Dockerfile.frontend` con contexto raíz, puerto 3000,
  `depends_on: backend`). El volumen `postgres_data` persiste la base.

### 3.3 Modificaciones locales previas a esta sesión

Estado del working tree al iniciar (`git status`), sobre el commit `afebc00`:

| Cambio | Archivo(s) | Descripción |
|---|---|---|
| Nuevo | `Dockerfile.backend` | Imagen `python:3.10-slim`, instala `backend/requirements.txt` y fuerza `bcrypt==4.0.1` aparte, expone 8000 y arranca uvicorn. |
| Nuevo | `Dockerfile.frontend` | Imagen `node:20-alpine`, copia `frontend/`, `npm install`, expone 3000 y ejecuta `npm run dev`. |
| Nuevo | `docker-compose.yml` | Orquestación de los tres servicios (`db`, `backend`, `frontend`) descrita arriba. |
| Nuevo | `backend/scripts/create_admin.py` | Script de bootstrap que crea/resetea el usuario `admin@torn.cl` con `is_superuser=True`. |
| Modificado | `backend/requirements.txt` | Reemplazado el listado corto y pineado (`fastapi>=0.115.0`, `uvicorn[standard]>=0.32.0`, …) por el listado completo del entorno (38 paquetes, incluyendo transitivos), ya sin versiones. |
| Modificado | `frontend/package-lock.json` | Actualización de versiones resueltas del árbol npm (~233 inserciones / 193 borrados): bumps de `@babel/*`, `caniuse-lite`, `electron-to-chromium`, etc. `package.json` no cambió. |
| Eliminado | `.env.example` | Se borró la plantilla de variables (`TORN_DB_USER/PASSWORD/HOST/PORT/NAME`). `.env` real existe y está en `.gitignore`. |

Los commits inmediatamente anteriores (`85d4823`..`afebc00`) fueron trabajo sobre DTEs en el POS: corrección
del campo `available` en el estado de folios y varios renombres del selector de tipo de documento.

---

## 4. Estado Actual

### Implementado

- API FastAPI con ~21 routers registrados en `backend/app/main.py` (auth, users, roles, customers, products, brands,
  price_lists, providers, purchases, inventory, sales, cash, reports, stats, config, issuer, folios, saas, health).
- Multi-tenancy tenant-per-schema con usuarios globales, `TenantUser`, planes y límite de usuarios
  (`max_users`, `max_users_override`).
- Modelo de datos completo (21 modelos ORM) + 6 migraciones Alembic + `modelo_base_datos.sql`.
- Motor de ventas transaccional, caja con arqueo ciego, kardex, crédito interno y devoluciones con NC.
- Emisión de DTE a través de dte-torn; carga de CAF y certificado desde Configuración → Folios; datos del SII
  por empresa (`public.tenants.sii_*`, solo superusuario) copiados a dte-torn al guardar el emisor.
- Plantillas de impresión HTML (ticket 80mm/57mm y carta), formato configurable por tipo de documento.
- Frontend Next.js 16 / React 19 con 18 rutas, capa de servicios Axios por dominio, estado con Zustand,
  formularios con React Hook Form + Zod y componentes shadcn/ui sobre Radix.
- Catálogo ACTECO del SII en BD con endpoint de búsqueda (`backend/scripts/seed_actecos.py`, `database/actecos_sii.json`).
- Suite Pytest de integración: **101 passed** corriendo `pytest -q` parado en `backend/` (verificado 2026-09-25).
  dte-torn se sustituye por un fake (`FakeDte` en `backend/tests/conftest.py`).
- Contenerización completa (backend + frontend + PostgreSQL) vía Docker Compose.

### Pendiente / lo que parece faltar

- **Impresión**: carta = PDF de dte-torn; 57/80 mm = `dte_ticket.html` armado en el backend desde el XML
  firmado (`backend/app/services/dte_impreso.py`, timbre PDF417 verificado con zxing-cpp). Las ventas que
  dte-torn no tiene usan las plantillas antiguas sin timbre. El ancho de módulo del timbre en térmica
  (`COLUMNAS_TIMBRE`) está calibrado a ojo: falta validarlo leyendo un ticket impreso.
- **Retiro de tablas locales**: `backend/scripts/migrate_retiro_dte_local.py` borra `dtes`, `cafs` y
  `folio_request_logs` de cada esquema. Hay que volver a cargar en dte-torn los CAF con folios libres antes de
  correrlo con `--aplicar`.
- **Totales replicados en tres lugares**: `calcular_totales` (dte-torn), `totales_dte`
  (`backend/app/utils/taxes.py`) y `totalesDte` (`frontend/lib/taxes.ts`). Si cambia uno, cambian los tres.
- **`backend/requirements.txt` sin versiones**: por decisión explícita del proyecto; implica builds no reproducibles.
- **`bcrypt` pineado fuera de `backend/requirements.txt`**: `Dockerfile.backend` instala `bcrypt==4.0.1` aparte, lo que
  duplica la gestión de dependencias.
- **Frontend en modo dev dentro de Docker**: `Dockerfile.frontend` ejecuta `npm run dev`, no `build` + `start`.
- **Credenciales por defecto en el repo**: `docker-compose.yml` trae `POSTGRES_PASSWORD: password123`. Aceptable
  en local, no en despliegue.
- **Credenciales de admin de desarrollo**: `TORN_ADMIN_EMAIL`/`TORN_ADMIN_PASSWORD` están fijadas en el `.env`
  local (no versionado) para que `backend/scripts/create_admin.py` no pida la contraseña de forma interactiva. Son
  **solo para desarrollo local**; deben eliminarse del `.env` antes de cualquier despliegue a producción.
- **Deuda menor**: uso de `Query.get()` legacy de SQLAlchemy 1.x en `backend/app/routers/sales.py` (warnings en pytest)
  y `create_all()` conviviendo con Alembic.

---

## 4.bis Revisión del 2026-09-16

Auditoría completa del repositorio. Lo corregido en esa sesión:

### Causa raíz del frontend roto

`.gitignore` heredaba `lib/` y `lib64/` de la plantilla de Python. Sin barra
inicial esos patrones no se anclan a la raíz y también capturaban
`frontend/lib/`. Resultado: `frontend/lib/format.ts` y `frontend/lib/hooks/`
nunca entraron al repositorio y se perdieron al clonar; `rut.ts` y
`store/uiStore.ts` sobrevivían sólo en local. `tsc` reportaba 20 errores y
`npm run build` no pasaba. Se anclaron los patrones, se versionaron los archivos
supervivientes y se **reconstruyeron** `format.ts` y `useBarcodeScanner.ts` a
partir de sus llamadas (ambos lo indican en su docstring; conviene revisarlos).

### Defectos con impacto tributario

| Defecto | Efecto |
|---|---|
| Folio calculado como `ultimo_folio_usado + 1` | Un CAF de 1000-1100 emitía su primer documento con folio 1, fuera del rango autorizado |
| `available = folio_hasta - ultimo_folio_usado` | `/folios/status` informaba 1100 folios donde había 101 |
| `iva = total_neto * Decimal("0.19")` fijo | Factura/Boleta Exenta (34/41) salían con IVA; el `Tax` del producto se ignoraba |
| NC creada sin `user_id`/`seller_id` | Toda devolución fallaba contra el NOT NULL de `sales.user_id` |
| Venta sin CAF inventaba un correlativo | Se emitían documentos con folios no autorizados en silencio; ahora devuelve 409 |

La aritmética de folios vivía en `backend/app/utils/folios.py` (hoy en dte-torn) y las tasas en
`backend/app/utils/taxes.py`; `frontend/lib/store/cartStore.ts` replica `EXEMPT_DTES`
para que el total del POS coincida con el que cobra el backend.

### Seguridad y despliegue

- `SECRET_KEY` caía a una constante pública si no estaba definida, lo que
  permitía firmar un JWT para cualquier usuario. Ahora es obligatoria si
  `TORN_ENV` es staging o production.
- `tenant_service.py` invocaba `psql` con usuario, host, puerto y contraseña
  fijos en el código; pasa a leer las `TORN_DB_*`.
- `tenant_service.py` ya no invoca `psql` (el esquema sale de `create_all`), así que
  `Dockerfile.backend` no necesita `postgresql-client`.
- CORS configurable con `TORN_CORS_ORIGINS`; `on_event` reemplazado por lifespan.

### Tests

La suite no podía ejecutarse (8 errores de conexión): `conftest` sobreescribía
`get_db`, que los routers dejaron de usar al migrar a tenant-per-schema. Ahora
corre sobre SQLite en memoria con las dependencias de tenant sustituidas.
**15 tests en verde**, incluyendo `backend/tests/test_folios_impuestos.py`, que cubre
las regresiones anteriores. Se añadió CI en `.github/workflows/ci.yml`.

Dos bugs que la suite destapó: `CashSessionCreate.user_id` era obligatorio pero
el endpoint lo ignora (abrir caja daba 422), y el índice único de
`users.is_system_user` sólo declaraba `postgresql_where`, degradando a UNIQUE
total fuera de PostgreSQL.

---

## 5. Reglas de Desarrollo

> **Regla estricta para futuras interacciones:**
> **No inventar ni asumir nombres de componentes de UI o detalles específicos del proyecto. Basarse estrictamente
> en la estructura de los archivos locales y dejar que las herramientas de desarrollo local manejen las opciones
> estructurales.**

En la práctica esto significa:

1. Antes de referenciar un componente, ruta, endpoint, modelo o variable, **verificarlo leyendo el archivo real**
   del repositorio. Si no existe en el árbol local, no se nombra.
2. Los componentes de UI se limitan a los que existen en `frontend/components/`; para agregar uno nuevo de
   shadcn/ui se usa la herramienta local correspondiente (`components.json` ya está configurado), no se escribe
   a mano ni se inventa su API.
3. Las dependencias se leen de `backend/requirements.txt`, `frontend/package.json` y los Dockerfiles. No se asume que
   una librería está disponible porque "sería lo normal".
4. `backend/requirements.txt` se mantiene **sin números de versión**.
5. Los cambios de esquema de base de datos pasan por Alembic (`backend/alembic/versions/`), no por edición manual.
6. Los mensajes de commit siguen Conventional Commits y describen solo cambios reales verificados en el diff.
7. Nunca se versionan secretos: `.env` está en `.gitignore` y debe seguir así.
8. No se usan `<select>` nativos: su lista la dibuja el navegador y no respeta estilos (ni el puntero de
   mano en las opciones). Se usa `SelectOpciones` (`frontend/components/ui/select-opciones.tsx`) o el
   `Select` de shadcn.
9. No se usa el guion largo (U+2014) en ningún archivo versionado (código, textos de la UI, plantillas,
   documentación, commits): se usa "-" o se reescribe la frase. CI falla si `git grep` lo encuentra. La
   única excepción es `texto_sii` en `dte-torn/app/dte/builder.py`, que lo escribe como escape `\u2014`.
10. No se usan toasts. Un error de diálogo o formulario va en `AlertaError`
    (`frontend/components/ui/alerta-error.tsx`) dentro del diálogo; uno de página, con `avisar()` de
    `uiStore`, que lo muestra como `Alert` arriba del contenido (`components/layout/Aviso.tsx`). Los
    éxitos que ya se ven en pantalla no llevan mensaje.
