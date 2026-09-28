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
  borrar la compra); en el navegador: ajuste 50 → 48 → 50 del Post-it de demo, editor guarda sin stock.
- **Revisar:** en el tenant de demo quedaron 2 movimientos de prueba en el Post-it 3x3 (stock final 50,
  el mismo de antes). Los movimientos viejos sin saldo se ven en blanco: eso lo cuadra K5.
