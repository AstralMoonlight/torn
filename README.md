# Torn – Facturador electrónico (SII Chile)

Monorepo: backend (FastAPI) + frontend (Next.js). El frontend es un proyecto **independiente** (sus deps van en `frontend/node_modules`).

## Instalación

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Abre http://localhost:3000. No hace falta instalar nada desde la raíz para el frontend.

**Importante:** Para que Clientes, Marcas, Inventario, POS, etc. carguen datos, el **backend tiene que estar en marcha** en el puerto 8000. Si no, verás un aviso tipo: *"No se pudo conectar al servidor. ¿Está el backend en marcha? (puerto 8000)"*.

### Backend

En la raíz del repo, usa un **entorno virtual** (en Ubuntu no instales uvicorn con `apt`; usa el del proyecto):

```bash
cd /ruta/a/torn

# Crear y activar el venv (solo la primera vez)
python3 -m venv .venv
source .venv/bin/activate   # en Windows: .venv\Scripts\activate

# Instalar dependencias (solo la primera vez)
pip install -r requirements.txt

# Levantar el servidor
uvicorn app.main:app --reload --port 8000
```

El backend quedará en http://localhost:8000. Déjalo corriendo en una terminal y usa el frontend en otra.
