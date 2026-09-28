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
