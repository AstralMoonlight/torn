# Torn – Facturador electrónico (SII Chile)

Monorepo: backend (FastAPI) + frontend (Next.js).

## Instalación

**Importante:** instala dependencias desde la **raíz del proyecto** para que el frontend resuelva bien los módulos en dev:

```bash
cd /ruta/a/torn
npm install
```

Luego:

- **Frontend:** `cd frontend && npm run dev` (en `http://localhost:3000`)
- **Backend:** desde la raíz, `uvicorn app.main:app --reload --port 8000` (o con el venv que uses)

Si al entrar en una ruta del frontend la pantalla se va a blanco, suele ser que `node_modules` de la raíz no existía al levantar el frontend. Vuelve a ejecutar `npm install` en la raíz y después `npm run dev` en `frontend/`.
