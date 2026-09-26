# Torn - Facturador electrónico (SII Chile)

SaaS de facturación electrónica con punto de venta. Tres servicios, hermanos en la raíz:

| Carpeta | Qué es |
|---|---|
| `backend/` | API FastAPI multi-empresa (un esquema de PostgreSQL por empresa): POS, inventario, caja, clientes, compras |
| `frontend/` | App Next.js; proyecto independiente con su propio `node_modules` |
| `dte-torn/` | Microservicio que firma y envía los DTE al SII (folios, CAF, certificado). Tiene su propio compose: ver [dte-torn/README.md](dte-torn/README.md) |

El backend no emite documentos por su cuenta: cada venta llama a dte-torn, y si dte-torn la rechaza o no
responde, la venta se revierte.

**Estado (2026-09-25):** certificación de factura (33, 34, 52, 56, 61) aprobada por el SII para
DISTRIBUIDORA JCB SPA. Falta la declaración de cumplimiento y la certificación de boletas.

## Puesta en marcha con Docker

```bash
cp .env.example .env
# completar SECRET_KEY y TORN_DTE_API_KEY (= DTE_INTERNAL_API_KEY de dte-torn/.env)

cd dte-torn && docker compose up -d --build && cd ..   # primero dte-torn, en el puerto 8001
docker compose up -d --build                            # db, backend (8000) y frontend (3000)
docker compose exec backend python scripts/create_admin.py
```

El backend aplica las migraciones de Alembic al arrancar (`scripts/migrar_al_arrancar.py`); si fallan,
el contenedor no arranca. `create_admin.py` toma la clave de `TORN_ADMIN_PASSWORD` o la pide.

## Desarrollo sin Docker

Necesita un PostgreSQL accesible con las `TORN_DB_*` del `.env`.

### Backend

El venv vive en la raíz del repo, pero los comandos se ejecutan parado en `backend/`:

```bash
python3 -m venv .venv
source .venv/bin/activate   # en Windows: .venv\Scripts\activate
cd backend
pip install -r requirements.txt
python scripts/migrar_al_arrancar.py   # sirve también con la base vacía
uvicorn app.main:app --reload --port 8000
```

Catálogo ACTECO del SII (una vez, lo usa el formulario de empresas):

```bash
python scripts/seed_actecos.py
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Abre http://localhost:3000. Sin el backend en el puerto 8000 las pantallas muestran
*"No se pudo conectar al servidor"*.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest -q
```

Corren sobre SQLite en memoria, con dte-torn sustituido por un fake (`tests/conftest.py`). Los de
dte-torn corren en su contenedor: ver su README.

## Documentación

- [claude.md](claude.md): arquitectura, estado y reglas del repo (léelo antes de cambiar algo).
- [dte-torn/DESIGN.md](dte-torn/DESIGN.md): diseño del microservicio de DTE.
- [info/](info/): guía de desarrollo e informe técnico.
- [tasks/](tasks/): planes y tareas en curso.
