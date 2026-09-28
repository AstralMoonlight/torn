# Checklist de revisión (2026-09-28)

Trabajo hecho a partir de los pendientes de `tasks/`, **una rama por tarea, sin mergear**. Cada punto
dice la rama, qué cambió, cómo se verificó y qué mirar al revisar. Marcar `[x]` cuando se apruebe y se
mergee; si necesita cambios, anotarlos debajo del punto.

Este archivo vive solo en `main`: las ramas no lo tocan, para que no choquen al mergear.

---

## Plan antes del piloto (`lanzamiento.md` 0.1)

### [ ] 3. A5: el cierre de caja resta las devoluciones en efectivo
- **Rama:** `fix/arqueo-devoluciones` (ya existía, commit `378a22e`)
- **Qué:** `close_session` resta los pagos EFECTIVO de las NC en vez de sumarlos.
- **Revisar:** el test de `test_devoluciones.py` (abrir 10.000, vender 5.000, devolver 2.000 → espera 13.000).

### [ ] 4. NC de una boleta sin cliente (consumidor final)
- **Rama:** `fix/nc-boleta-consumidor-final`
- **Qué:** dte-torn acepta una 61/56 sin giro, dirección ni comuna del receptor **solo si referencia
  una boleta (39 o 41)**. El XSD ya los deja opcionales. El backend no cambia: ya mandaba el cliente
  `66666666-6` y la referencia a la 39.
- **Verificado:** dte-torn 317 en verde (incluye XSD de una 61 de boleta a consumidor final); backend 105.
- **Revisar / pendiente tuyo:** emitir una NC de boleta real en maullín y ver que el SII la acepte sin
  reparos (el XSD la acepta, pero la regla de negocio del SII solo se confirma enviándola).

### [ ] 5. A3: historial sin tope de 50
- **Rama:** `feat/historial-busqueda`
- **Qué:** `GET /sales/` acepta `desde`/`hasta` (días en hora de Chile) y `q` (folio, razón social o RUT,
  con o sin puntos). Con `q` ignora las fechas. El historial parte en **hoy**, tiene Desde/Hasta y un
  botón Hoy, busca en el servidor (espera 300 ms tras dejar de escribir) y pagina de a 50 con "Ver más".
- **Verificado:** 4 tests nuevos (día en hora de Chile, rango, búsqueda que ignora fechas, paginado);
  en el navegador con el tenant de demo: rango de septiembre, búsqueda "pedro" en todas las fechas y
  "Ver más" (50 → 60).
- **Revisar:** el aviso "El SII rechazó N documentos" ahora mira solo lo que se muestra (antes, las
  últimas 50). Orden por `fecha_emision` (antes `created_at`).

### [ ] 6. K1 + K3: ajuste de stock con kardex
- **Rama:** `feat/kardex-ajuste-stock`
- **Qué:**
  - `backend/app/services/kardex.py` → `mover_stock`: único punto que cambia el stock y anota el
    movimiento con `balance_after`. Lo usan ventas, NC y compras (crear, editar y borrar compra, que
    ahora guardan el usuario). La glosa de la venta dice `DTE 39 folio 123` (antes "Venta en proceso").
  - `POST /products/{id}/ajuste-stock` `{cantidad_contada, motivo, nota}`, motivos CONTEO, MERMA,
    INICIAL y AJUSTE ("Otro"). Anota la diferencia; sin diferencia no anota nada.
  - `GET /products/{id}/movimientos` (adelanto de K4, por producto).
  - `PUT /products/{id}` con `stock_actual` → 422. Crear producto o variante con stock → movimiento INICIAL.
  - Inventario: acción "Ajustar stock" (ícono de portapapeles) en productos simples que controlan
    stock; en el editor el stock se ve pero no se edita (botón "Ajustar" por variante).
- **Verificado:** 7 tests (`test_kardex.py`, incluye la regla de oro tras vender, devolver, comprar y
  borrar la compra); en el navegador: ajuste del Post-it de demo (la herramienta de pruebas tipeó dos veces y quedó en 4.848; se volvió a 50 con otro ajuste), editor guarda sin stock.
- **Revisar:** en el tenant de demo quedaron 2 movimientos de prueba en el Post-it 3x3 (stock final 50,
  el mismo de antes). Los movimientos viejos sin saldo se ven en blanco: eso lo cuadra K5.

### [ ] 7. C1: pagos de clientes con crédito interno
- **Rama:** `feat/pagos-credito-interno`, **sale de `fix/arqueo-devoluciones`** (los dos tocan el cierre
  de caja): mergear A5 primero.
- **Qué:**
  - Tabla `customer_payments` (migración `a3b4c5d6e7f8`, por esquema de empresa).
  - `POST /customers/{rut}/pagos` `{amount, payment_method_id, nota}`: baja `current_balance`. No deja
    pagar más que la deuda ni pagar con crédito interno. En efectivo y con control de caja, exige turno
    abierto (409 "Abra la caja...") y el pago queda en ese turno.
  - El cierre de caja suma los pagos de deuda en efectivo del turno.
  - `GET /customers/{rut}/cuenta`: saldo y movimientos (ventas fiadas, NC abonadas, pagos).
  - Clientes: columna **Debe**, botón **Con deuda** y acción **Cuenta y pagos** (ícono de billetera) con
    el saldo grande, "Registrar pago" (con atajo "Paga todo") y la lista de movimientos.
- **Verificado:** 6 tests (`test_pagos_clientes.py`: el cierre espera 10.000 + 5.000 del pago, la
  transferencia no entra a la caja, tope de la deuda, sin caja abierta, cuenta). Migración probada
  arriba y abajo en una copia de la base de desarrollo (`torn_migtest`, no en la real). En el navegador,
  contra esa copia: pago de $10.000 a un cliente con deuda de $25.000, queda en $15.000 y en el turno abierto.
- **Revisar:**
  - Hice que el pago en efectivo **exija caja abierta** cuando el control de caja está encendido (el
    plan decía que "entra a la caja", pero no qué pasa sin turno). ¿De acuerdo?
  - Es la opción chica de `administracion.md` 3.7: sin tabla `cash_movements` todavía (J1). Cuando se
    haga J1, el pago pasa a ser un INGRESO del turno.
  - La cuenta muestra las ventas del modo actual (DEV/CERT/PROD), pero el saldo es uno solo.

### [ ] 8. A2: eliminar un cliente lo desactiva
- **Rama:** `fix/cliente-desactivar`
- **Qué:** `DELETE /customers/{rut}` pone `is_active = False` (antes borraba y chocaba con la FK si tenía
  ventas). La lista y la búsqueda del POS muestran solo activos. Crear de nuevo ese RUT lo **reactiva**
  con los datos nuevos (antes daría 409 con un cliente invisible). El diálogo de confirmación lo explica.
- **Verificado:** 2 tests (`test_clientes_desactivar.py`).

### [ ] 9. A4: borrar `updatePurchase`
- **Rama:** `chore/borrar-update-purchase`
- **Qué:** se borra la función del frontend (nadie la usa). `tsc` limpio.
- **Revisar:** el endpoint `PUT /purchases/{id}` del backend sigue ahí, también sin uso. ¿Lo borro?

### [ ] 10. A6: costo del momento en cada línea de venta
- **Rama:** `fix/costo-en-venta`
- **Qué:** `sale_details.costo_unitario` (migración `b4c5d6e7f8a9`; las líneas existentes toman el costo
  actual del producto). Se llena al vender; la NC hereda el costo de la línea original y la factura de
  guías el de la guía. `stats.py` (dashboard, top productos, reporte) usa ese costo.
- **Verificado:** test de que cambiar el costo después de vender no cambia la utilidad. Migración
  probada arriba y abajo en una copia (2.180 líneas del tenant de demo quedaron con el costo actual).
- **Ojo al mergear:** esta migración y la de C1 salen las dos de `f2a3b4c5d6e7`. La que se mergee
  segunda tiene que cambiar su `down_revision` a la otra, o `alembic upgrade head` falla por dos heads.
- **Visto de paso (no cambiado):** los reportes suman las NC como si fueran ventas (monto y utilidad
  positivos). Merece su propio arreglo.

---

## Brechas de `alineacion_backend_frontend.md` (issues abiertos)

### [ ] 11. #51: aviso de pocos folios en el panel
- **Rama:** `feat/alerta-pocos-folios`
- **Qué:** dte-torn agrega `umbral_alerta` (`DTE_FOLIO_UMBRAL_ALERTA`, 100 por defecto) a `GET /folios`.
  El backend marca `alerta` en `/folios/status` para los tipos que **alguna vez tuvieron CAF** y quedan
  bajo el umbral (un tipo que nunca se cargó no se emite, no avisa), y nunca en modo Desarrollador. El
  panel muestra **un** `Alert` con los tipos y lo que queda, y enlaza a Configuración con `?tab=folios`,
  que ahora abre esa pestaña.
- **Verificado:** dte-torn 315, backend con 2 tests nuevos. En el navegador con JCB (CERT, CAF de la
  certificación agotados): el aviso lista Factura, Factura exenta, Guía, ND y NC en 0 y el enlace abre
  Folios. Para verlo corrí una segunda API de dte-torn con el código de la rama en el puerto 8011; la
  de siempre no se tocó.
- **Revisar:** hoy JCB va a ver este aviso apenas se mergee (sus CAF de certificación están agotados).
  Es lo esperado, pero se va a ver rojo hasta que carguen CAF de producción.

### [ ] 12. #54: el CAF tiene que ser del ambiente del emisor
- **Rama:** `feat/caf-ambiente`
- **Qué:** dte-torn lee el `IDK` del CAF (100 = maullín, certificación) y rechaza con 422 un CAF de
  maullín si el emisor está en PROD, o uno de palena si está en CERT ("Este CAF es de certificación
  (maullín) y el emisor está en producción..."). En Desarrollador no aplica. Configuración > Folios dice
  dónde se piden los CAF según el modo, y en Desarrollador desactiva "Cargar CAF".
- **Verificado:** dte-torn 315 (test nuevo con los dos sentidos y el caso que sí entra).
- **Revisar:** que IDK 100 = certificación sale de la práctica conocida (todos los CAF de maullín del
  repo traen 100); no tengo un CAF de palena para confirmar el otro lado. El primer CAF de producción que
  se cargue lo confirma: si lo rechaza, es esto.
- No hice "mostrar el ambiente de cada CAF": la pantalla solo lista los del ambiente actual (dte-torn
  filtra), y con esta validación no puede entrar uno del otro.

### [ ] 13. #44: forma de pago en facturas fiadas (parcial)
- **Rama:** `feat/forma-pago-credito`
- **Qué:** las facturas (33, 34) mandan `forma_pago`: **2 (crédito)** si algún pago es crédito interno,
  aunque sea una parte; **1 (contado)** si no. Boletas y notas no llevan. El PDF carta ya la imprime.
- **Verificado:** 4 tests (`test_forma_pago.py`).
- **Pendiente tuyo (por eso el commit dice "Refs #44" y el issue sigue abierto):** de dónde sale la
  **fecha de vencimiento** (plazo por cliente, uno por defecto en Mi negocio o elegido en el POS). Y
  confirmar que un pago mixto vaya como crédito.

### [ ] 14. #46: el ticket no deja salir del papel un texto largo
- **Rama:** `fix/ticket-textos-largos`
- **Qué:** en el ticket 57/80 mm la razón social, el giro y la dirección ya saltaban de línea; lo que
  faltaba era que una palabra sin espacios (un correo, un código) se partiera en vez de salirse del
  ancho. La carta es el PDF de dte-torn, que ya se corrigió en `fa4f259`.
- **Verificado:** test con los largos máximos del SII (100, 40 y 70) en 57 y 80 mm; y lo medí en el
  navegador: 57 mm, la razón social en 7 líneas dentro del ancho.
- **Revisar:** en 57 mm una razón social larga queda en una columna angosta a la derecha. Si prefieres,
  el nombre puede ir debajo de "Señor(es):" a todo el ancho.

### [ ] 15. #39: contrato de los totales
- **Rama:** `test/contrato-totales`
- **Qué:** `dte-torn/tests/casos_totales.json`: 16 casos calculados a mano (factura, exenta, boleta,
  boleta exenta, mixtos, cantidades decimales, redondeos, y 6 con descuentos). Los corren
  `calcular_totales` (dte-torn, 16/16), `totales_dte` + `_linea_dte` del backend (12, 4 pendientes: %
  por línea y descuentos globales) y `totalesDte` del frontend (10, 6 pendientes: todo descuento).
- El frontend no tenía tests: `npm test` usa `node:test` (sin dependencias), el archivo queda fuera de
  `tsconfig` (el build de Docker no trae `dte-torn/`) y CI lo corre con Node 22. `npm run build` pasa.
- **Revisar:** el cambio de CI (un paso nuevo con Node 22 en el job del frontend).

### [ ] 16. #43: el ticket muestra bien los descuentos (parcial)
- **Rama:** `fix/ticket-descuentos`
- **Qué:** en el ticket 57/80 mm, el descuento global en pesos salía sin su monto (solo "Descuento") y
  el de línea en % no decía el porcentaje. Ahora: `Dcto 12,5%: -$2.500` en la línea y
  `Descuento: -$1.500` / `Cliente frecuente: -5%` abajo, como el PDF carta (ese ya estaba bien: lo
  aprobó el SII en las muestras).
- **Verificado:** test con un XML con descuento de línea en % y dos globales.
- **Pendiente:** #41 y #42 (dar descuentos desde el POS) esperan la decisión de **#40** (quién puede y
  con qué tope); el propio issue pide decidirlo antes de hacer la pantalla.

---

## Piloto en el local (`lanzamiento.md` 1.2 a 1.5)

### [ ] 17. 1.3 y 1.5: compose del piloto
- **Rama:** `chore/compose-piloto`
- **Qué:** `docker-compose.piloto.yml` en la raíz y en `dte-torn/`, que van **encima** de los de
  desarrollo (que no cambian): frontend de producción (`runner`), `TORN_ENV=production`, backend y
  frontend solo en `127.0.0.1`, las bases, MinIO y la API de dte-torn sin publicar. El backend se une a
  la red `dte-torn_default` y llama a `http://api:8000` (ya no `host.docker.internal:8001`).
- **Hallazgo verificado:** con las dos redes, el nombre `db` resolvía al **Postgres de dte-torn**. El
  override usa `TORN_DB_HOST=torn_db`, que solo existe en la red de Torn. Lo probé con un contenedor
  en las dos redes; también que `http://api:8000/health` responde por nombre.
- **Verificado:** `docker compose config` de los dos (0 puertos publicados en dte-torn). **No** levanté
  el stack del piloto: habría reemplazado tus contenedores de desarrollo.
- **Revisar:** el orden de arranque (dte-torn primero: su red es externa para Torn) y que el `.env` del
  piloto tenga `SECRET_KEY` (con `TORN_ENV=production` el backend no arranca sin ella) y contraseñas
  nuevas de Postgres y MinIO. Una línea nueva en `claude.md` lo resume.

### [ ] 18. 1.2: vaciar los datos de demostración de JCB
- **Rama:** `chore/vaciar-datos-demo`
- **Qué:** `backend/scripts/vaciar_datos_demo.py <esquema> [--aplicar]`. Borra ventas, compras,
  catálogo, marcas, clientes (menos el consumidor final 66666666-6), proveedores, listas de precios y
  turnos de caja. Deja empresa, emisor, usuarios, roles, medios de pago, impuestos y configuración; no
  toca dte-torn (el id de la empresa no cambia). Sin `--aplicar` solo cuenta.
- **Verificado:** sin `--aplicar` contra la base real de JCB (`tenant_763989569`: 16 ventas, 22
  productos, 4 clientes...; no cambió nada) y con `--aplicar` sobre una copia.
- **Pendiente tuyo:** correrlo con `--aplicar` cuando quieras. Ojo: borra también las 16 ventas de la
  certificación (modo CERT); dte-torn las sigue teniendo.

### [ ] 19. 1.4: respaldo diario
- **Rama:** `feat/respaldo-diario`
- **Qué:** `infra/respaldo/respaldo.sh`: vuelca las dos bases, copia el `/data` de MinIO y lo sube en
  **una** foto de restic (cifrada en el PC). Timer de systemd a las 03:00 con `Persistent=true` (el PC
  se apaga de noche: corre al encender). Deja la hora del último respaldo bueno en
  `/var/lib/torn/ultimo-respaldo-ok` para la futura alerta. README con instalación, el `rest-server
  --append-only`, la retención aprobada (14/8/12/6) y cómo restaurar.
- **Verificado:** el script contra los contenedores reales con un `restic` simulado (2 volcados + 67 MB
  de XML, limpia la carpeta), y un volcado de Torn restaurado en una base aparte (964 ventas iguales).
- **Diferencia con el diseño:** los volcados pasan un momento por disco (`/var/tmp`) en vez de ir por
  `--stdin`, para que bases y XML queden en la misma foto. El disco va cifrado (LUKS).
- **Pendiente tuyo:** el servidor, `restic init`, guardar aparte `DTE_MASTER_KEY` y la clave del
  repositorio, y probar la restauración completa en otra máquina.

### [ ] 20. 1.6: errores en palabras simples en el POS
- **Rama:** `fix/errores-en-palabras-simples`
- **Qué:** el backend traduce los rechazos conocidos de dte-torn a qué pasó y qué hacer, y deja el texto
  técnico en el log: sin folios → "Se acabaron los números autorizados por el SII para boleta. Avise al
  administrador"; dte-torn caído (antes salía "... no respondió: [Errno 111] Connection refused") →
  "el sistema de facturación no responde. Espere un minuto y vuelva a intentar..."; datos del cliente
  que faltan → "faltan datos del cliente: giro, dirección. Complételos en Clientes..."; sin
  certificado. Caja cerrada: "No hay un turno de caja abierto: abra la caja antes de vender" (antes
  "El vendedor (ID 1)..."). En el POS, la marca "sin folios" pasa a "agotado" con una ayuda.
- **Verificado:** 5 tests de los mensajes; en el navegador, el cobro de una boleta sin números muestra
  el texto nuevo.
- **Visto de paso:** al entrar al POS desde saas-admin, a veces dice "Caja cerrada" con la caja
  abierta (se arregla al ir a Caja y volver). No lo investigué.

---

## Revisión de código (#57)

### [ ] 21. Fases 3 (guía) y 4 (libros) de la certificación
- **Rama:** `fix/ticket-guia` (lo único que hubo que corregir)
- **Hallazgo corregido:** el ticket 57/80 mm de una **guía** decía "DOCUMENTO 52", no imprimía el tipo
  de traslado y nunca sacaba la copia cedible. Ahora sigue la regla del PDF carta: nombre, "Traslado:
  Operación constituye venta" (o el que sea) y cedible con acuse de recibo solo si es venta. 2 tests.
- **Revisado sin cambios:** `builder.py` (52: `IndTraslado`, `TipoDespacho`, líneas sin precio y
  traslado interno al propio emisor, cubiertos por los tests contra el XSD), `pdf.py` (cedible solo
  en guías de venta), `libros.py` (resumen y detalle salen de los mismos montos; `firmar_libro`
  agrega `TmstFirma` cada vez que se llama, inofensivo porque se llama una vez y los libros solo se
  usaron en la certificación).
- **Al mergear:** marcar los Checkpoints B y C en `tasks/todo.md` y cerrar #57.
