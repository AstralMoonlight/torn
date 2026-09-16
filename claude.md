# claude.md — Torn

Documento de contexto para asistentes de IA y desarrolladores que trabajen en este repositorio.
Todo lo aquí descrito proviene de la inspección directa de los archivos locales.

---

## 1. Descripción General

**Torn** es un SaaS chileno de **facturación electrónica (DTE / SII) con motor de Punto de Venta (POS)**.

Según la lógica encontrada en `app/`, el sistema cubre:

- **Emisión de DTEs**: generación de XML a partir de plantillas Jinja2 (`app/services/xml_generator.py`,
  `app/templates/xml/factura_template.xml`) y gestión de folios autorizados por el SII mediante CAF
  (`app/models/dte.py`: `DTE`, `CAF`, `FolioRequestLog`; router `app/routers/folios.py`).
  Los tipos de documento manejados en el modelo son 33 (Factura), 34 (Exenta), 39 (Boleta), 41, 56 (ND), 61 (NC).
- **Punto de Venta**: flujo transaccional de venta que valida caja abierta y stock, descuenta inventario,
  registra kardex, registra pagos y asigna folio/DTE de forma atómica (`app/routers/sales.py`).
- **Inventario y catálogo**: productos, marcas, listas de precios, proveedores y compras
  (`app/models/product.py`, `brand.py`, `price_list.py`, `provider.py`, `purchase.py`).
- **Caja**: sesiones de caja con arqueo ciego (`app/models/cash.py`, `app/routers/cash.py`).
- **Clientes y crédito interno**: cuentas corrientes con `current_balance` y medio de pago `CREDITO_INTERNO`.
- **Devoluciones / logística inversa**: reingreso de stock y Nota de Crédito referenciando la venta original.
- **Multi-tenancy SaaS**: arquitectura **tenant-per-schema** de PostgreSQL. El esquema `public` aloja
  `saas_plans`, `tenants`, `saas_users` y `tenant_users` (`app/models/saas.py`), y la sesión de base de datos
  se enruta dinámicamente al esquema del tenant vía cabecera `X-Tenant-Id` (`app/dependencies/tenant.py`).
- **Autenticación y permisos**: JWT (python-jose) con hashing de contraseñas, usuarios globales del SaaS,
  usuarios por tenant y roles/permisos (`app/routers/auth.py`, `users.py`, `roles.py`, `app/utils/security.py`).

---

## 2. Stack Tecnológico

Detectado exclusivamente a partir de los archivos de dependencias y configuración presentes en el repo.

### Backend — `requirements.txt` (sin versiones), `app/`

| Tecnología | Evidencia |
|---|---|
| Python 3.10 | `Dockerfile.backend` (`FROM python:3.10-slim`) |
| FastAPI | `fastapi` en `requirements.txt`, `app/main.py` |
| Uvicorn | `uvicorn`, `httptools`, `watchfiles`, `websockets`, `h11` |
| Starlette | `starlette` |
| SQLAlchemy | `SQLAlchemy`, `greenlet`, `app/database.py` |
| Alembic | `alembic`, `Mako`, `alembic.ini`, `alembic/versions/` |
| PostgreSQL | `psycopg2-binary`, `postgres:18-alpine` en `docker-compose.yml` |
| Pydantic | `pydantic`, `pydantic_core`, `annotated-types`, `app/schemas.py` |
| Jinja2 | `Jinja2`, `MarkupSafe`, `app/templates/` |
| JWT / python-jose | `python-jose`, `ecdsa`, `rsa`, `pyasn1` |
| passlib / bcrypt | `passlib`, `bcrypt` |
| cryptography | `cryptography`, `cffi`, `pycparser` |
| python-dotenv | `python-dotenv`, `load_dotenv()` en `app/database.py` |
| python-multipart | `python-multipart` (formularios OAuth2) |
| PyYAML, anyio, click, idna, six, tomli, tzdata, typing_extensions, typing-inspection, exceptiongroup | `requirements.txt` (dependencias transitivas) |
| Pytest | `tests/` + `pytest_output.txt`, `pytest_output_final.txt` (no está listado en `requirements.txt`) |

### Frontend — `frontend/package.json`

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
| Sonner | notificaciones |
| next-themes | tema claro/oscuro |
| class-variance-authority, clsx, tailwind-merge, tailwindcss-animate, aria-hidden, react-remove-scroll | utilidades de estilo |
| ESLint 9 | `eslint`, `eslint.config.mjs` |

### Infraestructura — Dockerfiles y `docker-compose.yml`

| Tecnología | Evidencia |
|---|---|
| Docker / Docker Compose | `Dockerfile.backend`, `Dockerfile.frontend`, `docker-compose.yml` |
| PostgreSQL 18 (alpine) | servicio `db` |
| Node 20 (alpine) | `Dockerfile.frontend` |

> Nota: `app/services/dte_signer.py` menciona `lxml` y `signxml` como **dependencias futuras** en un comentario;
> no están instaladas ni declaradas en `requirements.txt`, por lo que **no forman parte del stack actual**.

---

## 3. Arquitectura y Modificaciones

### 3.1 Estructura real del repositorio

El repo **no** tiene carpetas `backend/` ni `docker/`. La organización efectiva es:

```
Torn/
├── app/              # Backend FastAPI (equivale al "backend")
│   ├── main.py           # Entrypoint, CORS, registro de routers
│   ├── database.py       # Engine/Session SQLAlchemy, get_db()
│   ├── dependencies/     # tenant.py -> resolución de tenant y auth global
│   ├── models/           # ORM (saas, user, sale, product, dte, cash, ...)
│   ├── routers/          # ~20 routers HTTP (sales, folios, saas, auth, ...)
│   ├── schemas.py        # Pydantic por tenant
│   ├── schemas_saas.py   # Pydantic del plano SaaS/public
│   ├── services/         # xml_generator.py, dte_signer.py, tenant_service.py
│   ├── templates/        # XML del DTE + HTML de impresión (80mm / carta)
│   └── utils/            # security, validators (RUT), dates, formatters
├── frontend/         # App Next.js independiente (node_modules propio)
│   ├── app/              # App Router: pos, caja, inventario, clientes, compras,
│   │                     #   configuracion, dashboard, historial, listas-precios,
│   │                     #   marcas, personal, proveedores, reporte-diario,
│   │                     #   saas-admin/tenants, login, select-tenant, access-denied
│   ├── components/       # layout, pos, inventory, customers, providers, users,
│   │                     #   dashboard, ui (shadcn)
│   ├── services/         # capa Axios por dominio (api.ts + 15 módulos)
│   └── lib/              # utils.ts, rut.ts, store (Zustand)
├── alembic/          # Migraciones (6 revisiones)
├── scripts/          # Mantenimiento/seed (seed_actecos, sync_*, migrate_brands, ...)
├── tests/            # Pytest de integración (inventory, pos, sales, world_class)
├── data/             # Datos auxiliares (actecos_sii.json) — ignorado por git
├── Dockerfile.backend / Dockerfile.frontend / docker-compose.yml
└── requirements.txt / package.json (shim raíz) / modelo_base_datos.sql
```

### 3.2 Cómo interactúan

- **frontend → backend**: el frontend es headless y consume la API por HTTP. `frontend/services/api.ts`
  usa Axios contra `NEXT_PUBLIC_API_URL` (`http://localhost:8000` en `frontend/.env.local` y en
  `docker-compose.yml`). El backend habilita CORS explícito para `localhost:3000/3001/3002` en `app/main.py`.
- **Aislamiento por tenant**: el cliente envía el JWT (`Authorization: Bearer`) y la cabecera `X-Tenant-Id`.
  `app/dependencies/tenant.py` valida el token contra `public.saas_users`, resuelve el `schema_name` del
  tenant y entrega una sesión SQLAlchemy apuntando a ese esquema.
- **backend → PostgreSQL**: `app/database.py` construye la URL desde `TORN_DB_USER/PASSWORD/HOST/PORT/NAME`.
  El esquema se versiona con Alembic; además `main.py` hace `Base.metadata.create_all()` en el startup.
- **docker (raíz) → ambos**: `docker-compose.yml` levanta `db` (postgres:18-alpine con healthcheck),
  `backend` (build desde `Dockerfile.backend`, `env_file: .env`, override `TORN_DB_HOST: db`, puerto 8000,
  `depends_on: db healthy`) y `frontend` (build desde `Dockerfile.frontend` con contexto raíz, puerto 3000,
  `depends_on: backend`). El volumen `postgres_data` persiste la base.

### 3.3 Modificaciones locales previas a esta sesión

Estado del working tree al iniciar (`git status`), sobre el commit `afebc00`:

| Cambio | Archivo(s) | Descripción |
|---|---|---|
| Nuevo | `Dockerfile.backend` | Imagen `python:3.10-slim`, instala `requirements.txt` y fuerza `bcrypt==4.0.1` aparte, expone 8000 y arranca uvicorn. |
| Nuevo | `Dockerfile.frontend` | Imagen `node:20-alpine`, copia `frontend/`, `npm install`, expone 3000 y ejecuta `npm run dev`. |
| Nuevo | `docker-compose.yml` | Orquestación de los tres servicios (`db`, `backend`, `frontend`) descrita arriba. |
| Nuevo | `create_admin.py` | Script de bootstrap que crea/resetea el usuario `admin@torn.cl` con `is_superuser=True`. |
| Modificado | `requirements.txt` | Reemplazado el listado corto y pineado (`fastapi>=0.115.0`, `uvicorn[standard]>=0.32.0`, …) por el listado completo del entorno (38 paquetes, incluyendo transitivos), ya sin versiones. |
| Modificado | `frontend/package-lock.json` | Actualización de versiones resueltas del árbol npm (~233 inserciones / 193 borrados): bumps de `@babel/*`, `caniuse-lite`, `electron-to-chromium`, etc. `package.json` no cambió. |
| Eliminado | `.env.example` | Se borró la plantilla de variables (`TORN_DB_USER/PASSWORD/HOST/PORT/NAME`). `.env` real existe y está en `.gitignore`. |

Los commits inmediatamente anteriores (`85d4823`..`afebc00`) fueron trabajo sobre DTEs en el POS: corrección
del campo `available` en el estado de folios y varios renombres del selector de tipo de documento.

---

## 4. Estado Actual

### Implementado

- API FastAPI con ~21 routers registrados en `app/main.py` (auth, users, roles, customers, products, brands,
  price_lists, providers, purchases, inventory, sales, cash, reports, stats, config, issuer, folios, saas, health).
- Multi-tenancy tenant-per-schema con usuarios globales, `TenantUser`, planes y límite de usuarios
  (`max_users`, `max_users_override`).
- Modelo de datos completo (21 modelos ORM) + 6 migraciones Alembic + `modelo_base_datos.sql`.
- Motor de ventas transaccional, caja con arqueo ciego, kardex, crédito interno y devoluciones con NC.
- Gestión de folios/CAF con rangos, `ultimo_folio_usado` y `fecha_vencimiento`, más log de solicitudes.
- Generación de XML DTE por plantilla Jinja2 y plantillas de impresión HTML (80mm y carta).
- Frontend Next.js 16 / React 19 con 18 rutas, capa de servicios Axios por dominio, estado con Zustand,
  formularios con React Hook Form + Zod y componentes shadcn/ui sobre Radix.
- Catálogo ACTECO del SII en BD con endpoint de búsqueda (`scripts/seed_actecos.py`, `data/actecos_sii.json`).
- Suite Pytest de integración: el último registro guardado (`pytest_output_final.txt`) marca **8 passed**.
- Contenerización completa (backend + frontend + PostgreSQL) vía Docker Compose.

### Pendiente / lo que parece faltar

- **Firma digital del DTE**: `app/services/dte_signer.py` está vacío salvo TODOs (carga de certificado `.pfx`,
  firma XML según esquema SII, Timbre Electrónico TED). Sin esto los DTEs no son válidos ante el SII.
- **Envío al SII**: `DTE.track_id` y `DTE.estado_sii` existen en el modelo, pero no se detecta cliente ni
  servicio que haga el envío/consulta de estado.
- **`.env.example` eliminado**: no queda plantilla de variables de entorno versionada para nuevos entornos.
- **Dependencias de desarrollo sin declarar**: `pytest` (y el cliente HTTP de pruebas, si aplica) no figuran en
  `requirements.txt`; no hay `requirements-dev.txt`.
- **`requirements.txt` sin versiones**: por decisión explícita del proyecto; implica builds no reproducibles.
- **`bcrypt` pineado fuera de `requirements.txt`**: `Dockerfile.backend` instala `bcrypt==4.0.1` aparte, lo que
  duplica la gestión de dependencias.
- **Frontend en modo dev dentro de Docker**: `Dockerfile.frontend` ejecuta `npm run dev`, no `build` + `start`.
- **Credenciales por defecto en el repo**: `docker-compose.yml` trae `POSTGRES_PASSWORD: password123` y
  `create_admin.py` crea `admin@torn.cl / admin123`. Aceptable en local, no en despliegue.
- **Deuda menor**: uso de `Query.get()` legacy de SQLAlchemy 1.x en `app/routers/sales.py` (warnings en pytest),
  `@app.on_event("startup")` deprecado en FastAPI, y `create_all()` conviviendo con Alembic.
- **Archivos residuales versionados**: `witch mainq` (volcado accidental de un comando git), `test.db`,
  `pytest_output*.txt` y varios scripts `migrate_*.py` / `test_*.py` sueltos en la raíz.

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
3. Las dependencias se leen de `requirements.txt`, `frontend/package.json` y los Dockerfiles. No se asume que
   una librería está disponible porque "sería lo normal".
4. `requirements.txt` se mantiene **sin números de versión**.
5. Los cambios de esquema de base de datos pasan por Alembic (`alembic/versions/`), no por edición manual.
6. Los mensajes de commit siguen Conventional Commits y describen solo cambios reales verificados en el diff.
7. Nunca se versionan secretos: `.env` está en `.gitignore` y debe seguir así.
