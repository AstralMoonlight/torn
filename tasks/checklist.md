# Checklist de revisión (2026-09-28, segunda y tercera tanda 2026-09-29)

> **Tercera tanda (puntos 27 a 34): mergeada a `main` el 2026-09-29** (revisada en el navegador por el
> usuario). En `main`: backend 188 tests, dte-torn en verde, `tsc`, contrato 17/17. Ramas borradas.
>
> **Puntos 1 a 26: mergeados a `main` el 2026-09-29** (merge de `revision/todo-junto`, las 24 ramas juntas). En `main`:
> backend 172 tests, dte-torn en verde, frontend `tsc`, lint (los 7 warnings de siempre), contrato de
> totales 17/17 y `npm run build`. Las ramas locales se borraron. Lo de abajo queda como registro de
> qué cambió y qué mirar; los `[ ]` son para marcar lo que vayas revisando en uso. Lo que sigue
> pendiente está en "Lo que falta", al final.

Trabajo hecho a partir de los pendientes de `tasks/`, una rama por tarea. Cada punto dice la rama, qué
cambió, cómo se verificó y qué mirar al revisar.

## Cómo mergear

- **Todas juntas funcionan.** La rama `revision/todo-junto` es `main` con las **24** ramas mezcladas y
  los conflictos resueltos. Primera tanda (20 ramas): backend 153 tests, dte-torn 335, frontend `tsc`,
  lint (solo los 7 warnings que ya había), `npm test` y `npm run build`, migraciones encadenadas sobre
  una copia de la base, y las pantallas tocadas cargando sin errores. Con la segunda tanda (puntos 23
  a 26, con el plazo por cliente): backend **172** en verde, dte-torn en verde, contrato de
  totales 17/17 en el frontend, `tsc` limpio. Es de referencia: si una rama cambia en la revisión, esa
  rama manda.
- **Conflictos esperables** (todos de "dos ramas agregan en el mismo lugar", se resuelven dejando ambos
  lados): `backend/tests/test_devoluciones.py` (NC de boleta y arqueo), `backend/tests/test_dte_impreso.py`
  (tickets), y `backend/app/routers/sales.py` entre forma de pago, errores y kardex. En la llamada a
  `_emitir_dte` de `_registrar_venta` queda **una** llamada con `_forma_pago(...)` y, debajo, el `for`
  que pone la glosa a los movimientos.
- **Alembic:** C1 (`a3b4c5d6e7f8`) y A6 (`b4c5d6e7f8a9`) salen las dos de `f2a3b4c5d6e7`. La que entre
  segunda cambia su `down_revision` a la otra (en `revision/todo-junto`, A6 va después de C1). Las de
  la segunda tanda ya van encadenadas detrás: `b4c5d6e7f8a9` -> `c5d6e7f8a9b0` (vencimiento) ->
  `d6e7f8a9b0c1` (descuentos). Si A6 no entra, cambiar el `down_revision` de `c5d6e7f8a9b0`.
- **Orden sugerido:** A5 antes que C1 (C1 sale de A5). Las ramas 23 a 25 salen de
  `revision/todo-junto`; la 26 (descuentos) sale de la 25 (vencimiento): mergear la 25 primero.

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
- **Visto de paso:** los reportes sumaban las NC como si fueran ventas. Arreglado en el punto 23.

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
- **Vencimiento:** hecho en el punto 25 (plazo de cada cliente). Falta confirmar que
  un pago mixto vaya como crédito (así quedó).

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
- **Dar descuentos desde el POS (#41, #42):** hecho en el punto 26, con la decisión de #40 que tomé yo.

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
- **Visto de paso:** al entrar al POS desde saas-admin, a veces decía "Caja cerrada" con la caja
  abierta. Arreglado en el punto 24.

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

### [ ] 22. Guía de instalación del PC del piloto
- **Rama:** `docs/instalacion-piloto`
- **Qué:** `infra/piloto/README.md` (sistema, `.env` nuevos, orden de arranque con los overrides,
  soporte por Tailscale con SSH solo por llave, respaldo, cómo actualizar) y
  `factureando-pos.desktop`, que abre Chrome en quiosco con impresión directa cuando el frontend responde.
- **Sin probar:** no hay un Ubuntu a mano. Se valida al instalar el PC.

---

## Segunda tanda (2026-09-29): lo que había quedado pendiente

Lo que no necesitaba nada tuyo, más las dos decisiones de negocio que tomé con un valor por defecto
configurable (vencimiento y descuentos). Revisar sobre todo esas decisiones.

### [ ] 23. Los reportes restan las notas de crédito
- **Rama:** `fix/reportes-nc` (sale de `revision/todo-junto`)
- **Qué:** `stats.py` (panel, ranking de productos y Reportes) sumaba la NC (61) como una venta más:
  devolver subía las ventas y la utilidad. Ahora la NC resta (monto, neto, IVA, cantidad y utilidad),
  la ND (56) suma, la guía (52) no cuenta (la venta es la factura que la cobra) y el número de ventas
  cuenta solo 33, 34, 39 y 41. El `/reports/dashboard` dejaba fuera las exentas (34 y 41): ya no.
- **Verificado:** test nuevo en `test_costo_en_venta.py` (vender 5, devolver 2: ventas, neto,
  utilidad, cantidad del ranking y número de ventas).
- **Revisar:** un documento que el SII rechazó sigue contando (se cobró y la mercadería salió). Si
  prefieres sacarlo de los reportes, es una línea.

### [ ] 24. "Caja cerrada" falso al entrar al POS
- **Rama:** `fix/pos-caja-cerrada` (sale de `revision/todo-junto`)
- **Causa:** `AppShell` solo preguntaba el turno a `/cash/status` si el navegador tenía un `userId`
  guardado, que se guarda al abrir la caja en ese navegador. El superusuario que llega desde saas-admin
  no lo tiene: el POS usaba el estado viejo guardado y decía "Caja cerrada".
- **Qué:** `sincronizarCaja()` en `services/cash.ts`, usada por `AppShell` (al entrar y al cambiar de
  empresa) y por Caja. Elegir empresa limpia el turno de la anterior. El POS no muestra "Caja cerrada"
  mientras todavía no sabe (estado `UNKNOWN`).
- **Verificado:** en el navegador (frontend de la rama contra el backend de Docker): con el estado
  guardado en "cerrada" y sin `userId`, el POS consultó el servidor y mostró los productos.

### [ ] 25. #44: plazo de crédito de cada cliente y vencimiento de la factura fiada
- **Rama:** `feat/vencimiento-credito` (sale de `revision/todo-junto`)
- **Decidido contigo (2026-09-29):** el plazo es **de cada cliente** (`customers.dias_credito`, en su
  ficha: "Plazo de crédito (días)"). **Sin plazo, el cliente no puede comprar fiado**: el POS no le
  ofrece "Crédito interno" (dice por qué) y el backend lo rechaza (409: "... no tiene crédito: el
  administrador le asigna un plazo de pago en Clientes. Mientras tanto, cobre con otro medio de pago.").
  No hay plazo general de la empresa. Con forma de pago crédito (algún pago con crédito interno, aunque
  sea una parte), el DTE lleva `FchVenc` = hoy + el plazo del cliente.
- **Decisión que tomé:** solo el **administrador** pone o quita el plazo (403 para el resto; el campo
  aparece deshabilitado): el plazo decide a quién se fía, y si no cualquiera se lo daría editando la ficha.
- **Qué más:** el ticket 57/80 mm muestra "Forma de pago" y "Vencimiento", como el PDF carta.
  Migración `c5d6e7f8a9b0` (columna en `customers`; la primera versión la ponía en `system_settings`,
  nunca llegó a `main`).
- **Verificado:** tests del vencimiento (45 y 60 días según el cliente, sin vencimiento al contado),
  cliente sin plazo que no puede fiar pero sí pagar en efectivo, vendedor que no puede dar crédito
  (403) pero sí editar el email; ticket con forma de pago y vencimiento. En el navegador contra la copia:
  el plazo se guarda desde la ficha del cliente, y en el cobro de JCB aparece "Crédito Interno" para un
  cliente con plazo y no para uno sin plazo, con el aviso.
- **Ojo al mergear:** los clientes que hoy deben (fiados antes de esto) quedan sin plazo y no pueden
  seguir comprando fiado hasta que se les asigne uno. En JCB se vacían los datos antes del piloto, así
  que no debería pesar; si no, hay que cargar sus plazos.

### [ ] 26. #40, #41, #42: descuentos en el POS
- **Rama:** `feat/descuentos` (**sale de la 25**: las dos migraciones van encadenadas)
- **Decisión que tomé (#40):** el **administrador descuenta sin tope**; el resto del personal, hasta
  `descuento_maximo` % del total de la venta (**10%** por defecto, configurable en Configuración >
  General > Descuentos; **0 = solo el administrador**). Pasarse se **bloquea** (403: "El descuento supera el
  10% que puede dar el personal. Pida al administrador que haga la venta."); no hay autorización de un
  supervisor. Quién vendió ya queda en la venta (`seller_id`).
- **Qué:**
  - Backend: descuento por línea en pesos netos o `descuento_pct` (`sale_details.descuento_pct`) y
    descuento al total (`sales.descuento_global` y `descuento_global_pct`), enviado a dte-torn como
    `descuentos_globales`. Va sobre lo afecto (o sobre lo exento si no hay nada afecto); en boletas los
    pesos pasan a bruto. Migración `d6e7f8a9b0c1`.
  - La **NC devuelve lo cobrado**: repite el % de la línea y del total, y prorratea los descuentos en
    pesos (devolver todo devuelve el total exacto de la venta).
  - La guía no acepta descuento al total (la factura de guías copia las líneas y lo perdería).
  - POS: botón **%** en cada línea del ticket y **"Descuento al total"** abajo; se elige % o $ y se
    escribe el monto. Los pesos son del precio que se ve (bruto); el carrito los pasa a neto. El ticket
    muestra "Dcto 10%" en la línea y "Descuentos: -$X" sobre el total. Quien no puede descontar no ve
    los botones.
  - Contrato de totales (#39): ya sin pendientes. 17 casos (uno nuevo: boleta con descuento al total
    en pesos) en dte-torn, backend (`totales_dte` + `_descuento_global_dte`) y frontend (`totalesDte`).
- **Verificado:**
  - 9 tests (`test_descuentos.py`: % por línea y al total, pesos brutos en boleta, tope del personal,
    tope 0, NC total y parcial, NC que repite el %, guía); contrato 17/17 en dte-torn, backend y
    frontend; dte-torn completo en verde; `tsc`, lint y `npm run build`.
  - En el navegador, con `revision/todo-junto` contra la copia de la base y la empresa de demo pasada
    **un rato** a modo Desarrollador (en la copia y en dte-torn; quedó de vuelta en CERT): boleta de
    2 diccionarios (exentos) con 10% en la línea y $1.000 al total = $20.600, y boleta de un Post-it
    ($833 con IVA) con $500 al total = $333. En los dos casos dte-torn calculó el mismo total
    (documentos SIMULADO `venta-979` y `venta-980`, quedaron en dte-torn en modo DEV, no se ven en CERT).
  - La NC completa de la boleta de $333 armó el documento correcto ($700 neto - $420 = $280 + IVA $53 =
    $333), pero dte-torn la rechazó: el dte-torn de Docker es el de `main`, sin el punto 4 (NC de boleta
    a consumidor final). Con el punto 4 mergeado debería pasar.
- **Falta:** una **factura** con descuento en el navegador (la empresa de demo no tiene cliente con
  giro a mano en la prueba). El commit dice "Refs" y no cierra #40, #41 ni #42 hasta eso.
- **Revisar:**
  - La decisión de arriba (tope por venta, no por línea; bloqueo en vez de pedir clave).
  - En facturas, un descuento en pesos se aplica sobre el neto: $500 escritos bajan el total en $499 o
    $500 según el redondeo del IVA.

---

## Tercera tanda (2026-09-29): lo que faltaba de todos los archivos de `tasks/`

Salió de revisar todos los `.md` de `tasks/` contra los issues abiertos y el código. **Mergeada a `main`
el 2026-09-29**; las ramas se borraron. **`revision/tanda-3`** es `main` con las 8 juntas y los conflictos resueltos (dos ramas agregando en
el mismo lugar: `sales.py`, `schemas.py`, `services/sales.ts` e Historial). Ahí: backend **188** en
verde, dte-torn completo en verde, `tsc`, lint (los 7 warnings de siempre), contrato de totales 17/17
y `npm run build`. **Alembic:** `d6e7f8a9b0c1` -> `e7f8a9b0c1d2` (permisos, punto 32) ->
`f8a9b0c1d2e3` (intercambio, punto 33); dte-torn `0004` -> `0005`. **Orden:** la 30 sale de la 28 y
la 33 de la 32: mergear esas primero.

Verificado en el navegador con `revision/tanda-3` contra la copia de la base (`torn_migtest`) y la
empresa de demo pasada **un rato** a Desarrollador (en la copia y en dte-torn; quedó de vuelta en CERT).
Configuraciones `backend-tanda3` (puerto 8012) y `frontend-tanda3` (3003) en `.claude/launch.json`,
sin versionar.

### [ ] 27. Los rechazados por el SII no cuentan en los reportes
- **Rama:** `fix/reportes-sin-rechazados`
- **Decidido contigo (2026-09-29):** no se contabilizan, porque se vuelven a emitir; solo se informan.
- **Qué:** RECHAZADO y ERROR_VALIDACION (el criterio del Historial) quedan fuera de panel, ranking,
  Reportes y `/reports/dashboard` (`CUENTA` en `stats.py`). `/stats/report` y `/reports/dashboard`
  devuelven cuántos hay y por cuánto; el Panel (hoy) y Reportes (el periodo) lo avisan con un `Alert`
  que enlaza a Historial. La nota al pie de Reportes ya no dice que la utilidad usa el costo de hoy.
- **Verificado:** test con dos ventas, una rechazada (reporte, resumen, ranking y dashboard); en el
  navegador, Reportes del 17-09 con una boleta rechazada: "Un documento rechazado... Suman $6.724".
- **Revisar:** hoy no hay forma de "volver a emitir" un rechazado: se hace otra venta, y el stock de la
  rechazada ya salió. Ver "Lo que falta".

### [ ] 28. #45: nota de crédito que corrige texto
- **Rama:** `feat/nc-corrige-texto`
- **Hallazgo:** Historial ya ofrecía "2 - Corrige Texto" en la devolución, pero esa ruta reingresaba
  stock y emitía la NC **con montos**.
- **Qué:** `POST /sales/{id}/corrige-texto {donde_dice, debe_decir}`: NC 61 con una línea "Corrige texto"
  a $0 y la corrección en la descripción, referencia código 2 (como la aceptó el SII en la
  certificación). No mueve stock, caja ni deuda. `/sales/return` ya no acepta el 2. Historial: acción
  "Corregir un dato (giro, dirección...)" en facturas, con "Dónde dice / Debe decir".
- **Verificado:** 3 tests; dte-torn: caso XSD nuevo. En el navegador (DEV): NC N° 2 por $0, el XML
  firmado trae `MntTotal` 0, `DscItem` con la corrección y `CodRef` 2, y el PDF carta sale.
- **Revisar:** #45 sigue abierto: su último criterio es verla ACEPTADA en maullín (junto con #47).

### [ ] 29. El error de dte-torn llega como texto (pendiente del punto 20)
- **Rama:** `fix/mensaje-error-dte`
- **Causa:** un 422 de validación de FastAPI trae `detail` como lista con el pedido entero; `dte_client`
  lo pasaba por `str()` y "faltan datos del cliente" mostraba el volcado. Ahora deja solo los `msg`.
- **Verificado:** test con la respuesta real de FastAPI.

### [ ] 30. Devolver una parte, en palabras simples (`lanzamiento.md` 1.6)
- **Rama:** `feat/devolucion-simple` (**sale de la 28**)
- **Hallazgo:** Historial siempre devolvía la venta **entera**: no había cómo devolver 1 de 5.
- **Qué:** diálogo nuevo "Devolver productos": ¿Qué vuelve? (cantidad por producto, Todo / Nada),
  ¿Por qué?, ¿Cómo se devuelve el dinero? Sin tipo de documento ni "Razón SII": el backend pone
  código 1 si vuelve toda la venta de una vez y 3 si no. `/sales/return` solo emite 61 (una ND por ahí
  reingresaba stock y devolvía plata) y exige cantidades mayores que 0 (una negativa pasaba y sacaba
  stock). El exceso se explica con el nombre del producto. Historial dice "N°" en vez de "Folio".
- **Verificado:** 5 tests; en el navegador (DEV): de una factura con 2 diccionarios y 3 Post-it se
  devolvió 1 diccionario: NC por $12.000 con código 3.
- **Revisar:** el diálogo parte con **todo** marcado. Las ND (56) quedan sin pantalla (una al año,
  `lanzamiento.md` 0).

### [ ] 31. Confirmar antes de cerrar la caja (`lanzamiento.md` 1.6)
- **Rama:** `feat/confirmar-cierre-caja`
- **Qué:** "Cerrar caja" pregunta "¿Cerrar la caja con $X contados?": un cero de más dejaba el arqueo
  mal para siempre (no hay cómo reabrir).
- **Verificado:** en el navegador, con $150.000.

### [ ] 32. La vendedora ve su menú
- **Rama:** `fix/permisos-vendedor`
- **Hallazgo (bloqueaba el piloto):** el rol VENDEDOR nacía con `{"sales", "cash"}`, pero el menú y el
  guardián leen "Terminal POS", "Caja"... En la base de JCB está así: las vendedoras entraban al POS
  **sin menú**, sin llegar a Caja, Historial ni Clientes. "Personal" usaba la clave "Vendedores", que el
  editor de roles nunca pone. Y el superusuario que entra a una empresa (soporte) veía el menú vacío.
- **Qué:** el rol nace con Terminal POS, Caja, Historial y Clientes; la migración `e7f8a9b0c1d2` cambia
  los VENDEDOR que siguen con el valor de fábrica (uno editado en Personal no se toca). El guardián deja
  entrar solo con el permiso en `true` y cubre Historial, Reportes y Listas de precios. El superusuario
  ve todo.
- **Verificado:** migración arriba y abajo en la copia (esquemas con `json` y `jsonb`). En el navegador,
  con una vendedora de prueba creada en la copia: menú Terminal POS, Caja, Clientes e Historial;
  `/configuracion` y `/dashboard` la mandan a "acceso denegado".
- **Revisar:** el menú de la vendedora (¿algo más que esos cuatro?). El backend no revisa esos permisos
  en cada endpoint (solo `require_admin` en algunos): para la auditoría de seguridad.

### [ ] 33. #56 parte a: el XML aceptado va al correo del cliente
- **Rama:** `feat/intercambio-envio` (**sale de la 32**: migraciones encadenadas)
- **Qué (dte-torn):** un 33/34/52/56/61 **de producción** que el SII acepta queda con el XML
  PENDIENTE (o SIN_CORREO); en certificación y Desarrollador no sale solo, y boletas y consumidor final
  nunca. La tarea `intercambiar` (worker de estado) manda un `EnvioDTE` dirigido al RUT del cliente,
  firmado, más el PDF, por SMTP (`smtplib`, sin dependencias nuevas), con reintentos; dirección
  rechazada o intentos agotados, ERROR con dead letter. Sin `DTE_SMTP_HOST` no se manda nada.
  `POST /documents/{id}/intercambio` lo manda a mano, también en certificación, a otro correo si se
  indica. Migración `0005`; variables en `.env.example`; nota en `DESIGN.md`.
- **Qué (backend y Historial):** `sales.intercambio_estado` (migración `f8a9b0c1d2e3`), el refresco
  sigue las ventas con el XML pendiente, `POST /sales/{id}/reenviar-xml`. Historial: "XML enviado /
  por enviar / Sin correo / no enviado" junto al estado del SII, y "Mandar el XML al cliente".
- **Verificado:** dte-torn 7 tests (sobre dirigido al cliente con firmas que verifican, CERT no sale,
  sin correo, reintento y dirección rechazada, sin servidor, reenvío por API), migración 0005 arriba y
  abajo en `dte_test` (tu `dte` sigue en 0004); backend 4 tests; en el navegador el estado "XML
  enviado" y la acción. **No se mandó ningún correo real.**
- **Decisión que tomé:** va al `email` de la ficha del cliente (el que ya viaja como `CorreoRecep`);
  el reenvío acepta otro. **Pendiente tuyo:** ver "Lo que falta".

### [ ] 34. En Desarrollador ningún documento aparece agotado
- **Rama:** `fix/folios-desarrollador`
- **Causa:** dte-torn crea el CAF de prueba con la primera emisión de cada tipo; antes, `/folios/status`
  decía 0: el POS lo marcaba agotado y el Historial no ofrecía devolver. Lo vi al probar.

**Visto de paso (arreglado sin rama):** las pruebas de la tanda anterior dejaron en dte-torn
`venta-979` y `venta-980` (desde la copia), y la próxima venta de tu base de desarrollo en la empresa
de demo iba a ser la 979: dte-torn la habría rechazado por "payload distinto". Se adelantó la secuencia
de `tenant_167603513.sales` a 1000 en tu base y a 50000 en la copia, para que no vuelvan a chocar.
En la copia quedaron una vendedora de prueba, un cliente "Cliente de Prueba SpA" y tres documentos DEV.

---

## Lo que falta (necesita que decidas o hagas algo)

Actualizado el 2026-09-29 (tercera tanda; issues cruzados con GitHub el mismo día: #53 y #54 cerrados, #59 a #62 nuevos). Nada de lo que sigue se empezó salvo lo que dice:

| Pendiente | Qué falta | Dónde |
|---|---|---|
| **Al actualizar Docker** | `docker compose build` y `up -d` en los dos compose: el backend migra solo (`e7f8a9b0c1d2`, `f8a9b0c1d2e3`) y dte-torn aplica `0005` al arrancar | puntos 32 y 33 |
| **Correo del intercambio** (#56) | Poner `DTE_SMTP_HOST/USUARIO/CLAVE` de `xml@distribuidorajcb.cl` en el `.env` de dte-torn (la clave, solo ahí), mandar a mano un documento de certificación a un correo tuyo y revisar que llegue bien. Confirmar que el destino sea el correo de la ficha. Registrar la casilla en el SII (hoy Haulmer). La parte b (recibir de proveedores) sin empezar | punto 33, `intercambio.md` |
| **Fecha de corte con Bsale** (#55) | Por tipo de documento; es la única decisión abierta de `lanzamiento.md` 0 | `lanzamiento.md` 0 |
| **Volver a emitir un rechazado** (#62) | Hoy se hace otra venta y el stock sale dos veces. ¿Un botón "Emitir de nuevo" que reuse la venta, o la NC de la rechazada? | punto 27 |
| **Probar descuentos en una factura** | Una factura con descuento en el POS y la NC con el punto 4 mergeado; después cerrar #40, #41 y #42 | punto 26 |
| **0.2 alertas por correo** | Desde qué casilla salen y dónde corre el revisor. El SMTP del punto 33 sirve para mandarlas | `lanzamiento.md` 0.2 |
| **Autocompletar RUT** (#50) | Descargar las nóminas del SII (pide tu permiso para bajar archivos) y ver su formato | `autocompletar_rut_sii.md` |
| **Certificación de boletas** (#49) | Pedir el set en el SII (estaba para la semana del 28-09). Después: lector del set, envío por REST y la verificación por folio de boletas ambiguas (`pipeline.py`, hoy va a revisión manual), que se prueba contra el SII con esas boletas | `certificacion_boletas.md` |
| **Paso a producción** | Declaración de cumplimiento (#48; las muestras ya están aprobadas), CAF de palena, Res. 80, correos del SII, venta real de cada tipo (#47), retirar tablas DTE locales (#52) | `lanzamiento.md` 1.1 |
| **Piloto en el local** | `vaciar_datos_demo.py --aplicar`, cuentas del personal (con el punto 32 ya ven su menú), servidor y respaldo diario (#59), instalar el PC, UPS, impresora y lector reales, apagado a mitad de envío y sin internet | `lanzamiento.md` 1.2 a 1.4 |
| **1.5 sesiones** (#61) | Cerrar o bloquear por inactividad: cuántos minutos y si cierra o bloquea. Propuesta: cerrar sesión a los 15 minutos, configurable en Mi negocio | `lanzamiento.md` 1.5 |
| **1.6 con ellas** | Hojas de una página por tarea, capacitación y el recorrido de cada flujo con ellas (lo que se pudo sin ellas está en los puntos 20, 30 y 31) | `lanzamiento.md` 1.6 |
| **Preguntas de la primera tanda** | ¿Borrar `PUT /purchases/{id}` (punto 9)? ¿Razón social debajo de "Señor(es):" en 57 mm (punto 14)? ¿Pago en efectivo de deuda exige caja abierta (punto 7)? | puntos 7, 9 y 14 |
| **Auditoría de seguridad** (#60) | Correr `security-audit` completa (pedirla así). Incluir que el backend no revisa los permisos del menú | `lanzamiento.md` 1.5, punto 32 |

Tampoco hice, por decisión del plan (van después del piloto): K2, K4 (pantalla de movimientos), K5
(cuadratura del kardex viejo; tras vaciar JCB no hace falta), N1-N4, F1, P1-P4, J1-J2, C2, V1-V2, M1 de
`administracion.md`, y todo `lanzamiento.md` 2 (Factureando).

Cerrados sin trabajo pendiente: #53 (lo cubre el contrato de totales de #39) y #54 (la validación del
ambiente del CAF basta; mostrar el ambiente de cada CAF se descartó).
