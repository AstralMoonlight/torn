# Autocompletar por RUT (empresas, clientes y proveedores)

Escribir un RUT y que se llenen solos los datos que ya se conocen, en los **tres** formularios que piden
un RUT de empresa:

| Formulario | Archivo | Qué se llena |
|---|---|---|
| Empresa nueva (superusuario) | `frontend/app/saas-admin/tenants/page.tsx` | Nombre, giro y actividades económicas (`economic_activities`, hoy se buscan a mano una por una) |
| Cliente | `frontend/components/customers/CustomerForm.tsx` | Razón social, giro y, si ya es proveedor, el resto |
| Proveedor | `frontend/components/providers/ProviderDialog.tsx` | Razón social, giro y, si ya es cliente, el resto |

> **Prioridad (2026-09-25):** va después de las prioridades P2 y P3 de
> [`alineacion_backend_frontend.md`](alineacion_backend_frontend.md).

## Decisión (2026-09-25)

Fuente: las **nóminas públicas del SII**
([sii.cl/sobre_el_sii/nominapersonasjuridicas.html](https://www.sii.cl/sobre_el_sii/nominapersonasjuridicas.html)),
cargadas en una tabla propia. Se usan dos:

- **Razón social de personas jurídicas**: RUT, razón social, inicio de
  actividades, término de giro.
- **Actividades económicas de personas jurídicas**: RUT y sus actividades
  vigentes (de ahí sale el giro).

La de direcciones no se usa.

Límites conocidos, aceptados:

- Solo personas jurídicas. Las personas naturales con giro no están: se llenan a mano.
- El SII las actualiza pocas veces al año (la última, agosto de 2026). Una
  empresa creada después no aparece hasta la siguiente publicación: se llena a mano.

### Fuentes descartadas

| Fuente | Por qué no |
|---|---|
| SII STC (https://www2.sii.cl/stc/noauthz) | reCAPTCHA Enterprise v3 + queue-it; un scraper oculto saca puntaje bajo y vuelve `captchaInvalido`. Saltarse el captcha no es opción |
| [Webempresario](https://api-sii-chile.webempresario.com/), [API Gateway](https://www.apigateway.cl/products/sii/contribuyentes) | De pago, y usan los mismos datos públicos del SII |
| [BaseAPI](https://baseapi.cl/servicios/contribuyente) | Pide la clave SII y deja de aceptar registros nuevos el 11-12-2026 |
| [ruts.info](https://www.ruts.info/docs) (`GET /api/company-info?rut=...`) | Sirve las mismas nóminas ("datos hasta agosto 2026": actividades con `iva_affects`, direcciones históricas). Pide `x-api-key` (se obtiene donando en Buy Me a Coffee), máximo 100 consultas al día por key para todos los tenants juntos, y su `robots.txt` excluye `/api/`. Mismos datos que la copia propia, con más dependencia |

## Diseño

### Datos

- Tablas en el esquema `public` (compartidas por todos los tenants), con
  migración Alembic:
  - `contribuyentes_sii`: `rut` (PK, sin puntos, con DV), `razon_social`, `giro`
    (actividad principal) y las actividades vigentes (código y glosa, columna
    `sa.JSON`, nunca `JSONB`, para que la suite en SQLite siga corriendo).
  - `nominas_sii`: una fila por archivo con `url`, `etag`, `last_modified`,
    `sha256`, `filas`, `revisado_en`, `cargado_en`. Sirve para saber si hubo
    cambios y para ver desde la BD cuándo se actualizó por última vez.
- Solo se cargan empresas **vigentes** (sin término de giro), para no guardar
  millones de filas que nunca se van a consultar.

### Revisión diaria

Un script (`backend/scripts/sync_nominas_sii.py`) que, para cada nómina:

1. Pide solo las cabeceras (`HEAD`) y compara `ETag`/`Last-Modified` con lo
   guardado en `nominas_sii`. Si son iguales, anota `revisado_en` y termina.
2. Si cambiaron (o el servidor no las manda), descarga el ZIP y compara su
   `sha256`. Si es el mismo, igual termina sin tocar nada.
3. Si el contenido es nuevo: carga todo en una tabla temporal y la reemplaza
   en **una sola transacción**, para que una búsqueda nunca vea la tabla a
   medio cargar. Si algo falla, queda la versión anterior intacta.
4. Deja en el log qué revisó, si cambió y cuántas filas cargó.

Se puede correr a mano (`cd backend && python scripts/sync_nominas_sii.py`),
y la primera vez es así como se llena la tabla.

**Programación:** todos los días a las **04:00 hora de Chile**
(`America/Santiago`, ya en `backend/app/utils/dates.py`), la hora de menos
uso del POS. En el repo no hay ningún planificador (ni cron, ni APScheduler,
ni Celery), así que para no agregar dependencias: un servicio nuevo en
`docker-compose.yml` que usa la misma imagen del backend y corre el script en
modo `--diario` (espera hasta las 04:00, sincroniza, vuelve a esperar), con
`restart: always` como el resto. No corre dentro del proceso de uvicorn para
que una carga pesada no frene las ventas.

### Búsqueda en cascada (decidido 2026-09-25)

Una sola búsqueda, que prueba las fuentes en orden y se queda con la primera que responde:

1. **Datos propios de la empresa** (solo en Clientes y Proveedores): si el RUT ya está registrado como
   cliente o como proveedor de esta misma empresa, se copian todos sus datos (dirección, comuna, ciudad,
   email, teléfono). Un proveedor que también compra, o al revés, se escribe una sola vez.
2. **Nómina del SII** (`contribuyentes_sii`): razón social, giro y actividades vigentes.
3. Nada: se sigue a mano, sin mensaje de error.

Nunca se busca en los clientes o proveedores de **otra** empresa (serían datos de otro tenant). En
saas-admin no hay empresa elegida, así que solo aplica el paso 2.

### API y formularios

- `GET /contribuyentes/{rut}` (autenticado): recorre la cascada y devuelve los campos encontrados y de qué
  fuente salieron (`propio` o `sii`); 404 si no hay nada. El paso 1 usa el esquema del tenant de la
  cabecera `X-Tenant-Id`; sin tenant (saas-admin, superusuario) salta al paso 2.
- Frontend: un solo campo `RutInput` (formatea, valida con `lib/rut.ts` y, al salir con un RUT válido,
  llama la búsqueda) que usan los tres formularios. Llena **solo los campos vacíos** (no pisa lo que el
  usuario ya escribió) y muestra una línea chica: "Datos del SII" o "Ya registrado como proveedor".
- En saas-admin, las actividades vigentes quedan marcadas en `economic_activities`; se pueden quitar.
- Clientes y Proveedores pasan a la ficha lateral en el plan de administración
  ([`administracion.md`](administracion.md), tarea C2): `RutInput` entra ahí; si esta tarea llega antes,
  se pone en los formularios actuales y se mueve con ellos.

## Tareas

- [ ] Descargar las dos nóminas a mano y revisar el formato real (separador,
      encoding, columnas, cómo viene el RUT, cómo se marca la actividad
      principal, tamaño) y si el servidor del SII manda `ETag`/`Last-Modified`.
- [ ] Modelos + migración Alembic de `contribuyentes_sii` y `nominas_sii`.
- [ ] `sync_nominas_sii.py`: parser, detección de cambios y reemplazo en una
      transacción. Tests del parser con un recorte de cada archivo y de la
      detección de cambios (sin cambios no toca la tabla).
- [ ] Modo `--diario` y servicio en `docker-compose.yml`.
- [ ] Endpoint `GET /contribuyentes/{rut}` con la cascada + tests (propio gana a SII; sin tenant solo SII;
      nunca devuelve datos de otro tenant).
- [ ] `RutInput` y autocompletado en los tres formularios: empresa nueva (saas-admin), cliente y
      proveedor.
- [ ] Documentar en `CLAUDE.md` el servicio nuevo y cómo forzar una sincronización.

## Por decidir

- Si el giro se llena con la actividad principal o el usuario elige entre las
  que trae (puede tener varias).
