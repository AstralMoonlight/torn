# Prueba de carga del POS

`locustfile.py` simula cajeros usando el POS contra un backend Torn levantado:
abren el POS (catálogo), escanean productos, buscan clientes, consultan la caja
y cobran ventas. Cada venta es un `POST /sales/` real, que descuenta stock,
registra el pago y emite el DTE en dte-torn en la misma transacción, así que la
prueba mide la cadena completa: backend, Postgres y firma en dte-torn.

El uso principal es comparar servidores (por ejemplo, un VPS en Chile contra
uno en EE.UU.) con exactamente la misma carga.

## Antes de empezar

La prueba **solo corre contra empresas en modo Desarrollador (DEV)**: ahí
dte-torn firma con un CAF de prueba y no habla con el SII. En CERT consume
folios de certificación y envía al SII, así que exige
`TORN_CARGA_PERMITIR_CERT=1`; en PROD no corre nunca. Si la empresa no está en
DEV la prueba se detiene antes de mandar la primera venta.

Usa una empresa dedicada a la prueba: las ventas quedan guardadas, los productos
con control de stock pierden unidades y el usuario queda con la caja abierta.

La empresa necesita:

- **Modo DEV**, con dte-torn corriendo y el emisor sincronizado.
- **El cliente de las ventas**, por defecto `66666666-6` (se cambia con
  `TORN_CARGA_RUT_CLIENTE`).
- **El medio de pago `EFECTIVO`.** Una empresa recién creada no trae medios de
  pago; se agregan con los scripts de seed o a mano en la tabla
  `payment_methods` de su esquema.
- **Productos vendibles**: activos, sin variantes y sin control de stock o con
  al menos 1000 unidades. Los demás se ignoran, para que la prueba no falle por
  stock agotado.

## Instalación

En la máquina que genera la carga, no en el servidor que se mide (si corren en
el mismo equipo, Locust le quita CPU al backend y los números no sirven):

```bash
pip install -r backend/scripts/carga/requirements.txt
```

## Uso

```bash
export TORN_CARGA_EMAIL=usuario@empresa.cl
export TORN_CARGA_PASSWORD='...'
export TORN_CARGA_TENANTS=3          # o "3,4,5" para repartir cajeros entre empresas

# Con interfaz web en http://localhost:8089
locust -f backend/scripts/carga/locustfile.py --host http://IP_DEL_SERVIDOR:8000

# Sin interfaz, 50 cajeros durante 5 minutos, resultados en carga_*.csv
locust -f backend/scripts/carga/locustfile.py --host http://IP_DEL_SERVIDOR:8000 \
  --headless -u 50 -r 5 -t 5m --csv carga
```

| Variable | Por defecto | Para qué |
|---|---|---|
| `TORN_CARGA_EMAIL`, `TORN_CARGA_PASSWORD` | (obligatorias) | Usuario con acceso a las empresas. Un superusuario también sirve. |
| `TORN_CARGA_TENANTS` | (obligatoria) | Ids de empresa separados por coma. |
| `TORN_CARGA_TIPO_DTE` | `39` | Tipo de documento de las ventas (39 boleta, 33 factura). |
| `TORN_CARGA_RUT_CLIENTE` | `66666666-6` | Cliente de las ventas. |
| `TORN_CARGA_ESPERA` | `1,3` | Segundos entre acciones de un cajero, `min,max`. |
| `TORN_CARGA_PERMITIR_CERT` | (vacía) | `1` para aceptar empresas en CERT. |

Para medir solo lectura (sin emitir DTE): `--exclude-tags venta`.

## Cuántos cajeros simular

Con la espera por defecto (1 a 3 s) cada cajero simulado es mucho más intenso
que uno real: sirve para buscar el techo del servidor. Para imitar una hora punta
usa `TORN_CARGA_ESPERA=15,45`: cada cajero hace una venta por minuto, más o
menos. Con eso, contando entre 2 y 3 cajas por empresa:

| Empresas | Cajeros simulados (`-u`) |
|---|---|
| 10 | 25 |
| 50 | 125 |
| 100 | 250 |
| 1000 | 2500 (usar `--processes -1` en una máquina con varios núcleos) |

## Comparar dos servidores

1. Deja los dos con el mismo stack (`docker compose` del backend y de dte-torn),
   los mismos datos y la misma empresa DEV.
2. Corre Locust desde **la misma máquina** contra ambos. Si esa máquina está en
   Chile, la latencia medida es la que verá un cajero.
3. Sube la carga por escalones (por ejemplo 25, 50, 100 y 200 cajeros, 5 minutos
   cada uno) y guarda cada resultado con `--csv`.
4. Mientras corre, mira `docker stats` en el servidor para ver qué se satura
   primero: backend, Postgres o los workers de dte-torn.
5. El servidor aguanta un escalón si `POST /sales/ (venta + DTE)` queda con
   0% de fallas y p95 bajo 1 segundo. Compara hasta qué escalón llega cada uno.
