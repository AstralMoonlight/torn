# Alinear backend y frontend con dte-torn

Estado al 2026-09-24. Esta etapa va **después** de la certificación de boletas (orden acordado:
certificación de factura → boletas → esta alineación → seguridad → servidor y release).

---

## 1. Lo realizado en la certificación de factura (JCB, 76.398.956-9)

| Paso | Resultado | Envío / track |
|---|---|---|
| Set básico (intento 2) | SOK | 0260088892 |
| Set factura exenta (intento 2) | SOK | 0260088718 |
| Set guía de despacho | SOK | 0260086000 |
| Libros de ventas, compras y guías | LOK / SOK | 0260088990 · 0260084758 · 0260086522 |
| Simulación: 24 documentos reales de Bsale (17×33, 34, 2×52, 3×61, 56) | EPR 24/24, aprobada | 0260198860 |
| Muestras impresas: 28 del set + 7 de simulación | Enviadas, **en revisión del SII** | reemplazo de simulación: 0260200310 |
| Declaración de cumplimiento (representante legal) | Pendiente | — |

Cambios de código de esta etapa (dte-torn):

- `f76ddbb`: el set de simulación tiene formato propio y una línea `RECEPTOR` por caso.
- `fa4f259`: el PDF ya no corta la razón social ni otros datos del receptor.
- `248851b`: la fecha de emisión se toma en hora de Chile (`hoy_chile()`), y la firma se niega a timbrar un
  documento con fecha posterior a la del timbre. Los contenedores corren en UTC: desde las 21 h, la
  simulación salió con FchEmis del día siguiente y el validador de muestras la rechazó.

---

## 2. Qué sabe hacer dte-torn hoy (API)

| Endpoint | Qué hace |
|---|---|
| `PUT /tenants/{id}` | Datos del emisor, ambiente (`CERT`/`PROD`) y resolución |
| `POST /certificates`, `GET /certificates/actual` | Carga y consulta el certificado |
| `POST /cafs`, `GET /folios` | Carga CAF y muestra el stock por tipo |
| `POST /documents`, `POST /boletas` | Emite (idempotente por `external_id`) |
| `GET /documents?estado=&tipo_dte=&folio=` | Lista con estado |
| `GET /documents/{external_id}` | `estado`, `estado_sii` y `track_id` de un documento |
| `GET /documents/{external_id}/xml` · `/pdf?cedible=&con_cedible=` | XML firmado y PDF carta |

El modelo de documento (`DatosDocumento`) acepta tipos 33, 34, 39, 41, 52, 56 y 61. Además de lo básico,
tiene estos campos:

- **Encabezado**: `forma_pago` (1 contado, 2 crédito, 3 sin costo), `fecha_vencimiento`, `ind_traslado` y
  `tipo_despacho` (guía), y hasta 20 `descuentos_globales`.
- **Ítem**: `descuento` en pesos o `descuento_pct`, `unidad`, `codigo`, `descripcion` y `exento`.
- **Referencia**: `tipo_doc`, `folio`, `fecha`, `codigo` (1 anula, 2 corrige texto, 3 corrige montos) y `razon`.

---

## 3. Brechas: lo que dte-torn ya sabe hacer y el backend o el frontend no usan

Ordenadas por impacto. Cada una se trabaja como un issue: commit, tests y verificación.

### A. Correcto frente al SII (lo primero)

1. ✅ **Estado SII de cada venta.** Hecho: `Sale.dte_estado`/`dte_glosa` (migración `c9d0e1f2a3b4`), se
   guardan al emitir y `POST /sales/dte-estados` refresca los no terminales; el historial los muestra en la
   columna SII y avisa los rechazados. Pendiente: verlo pasar de FIRMADO a ACEPTADO con una venta real en
   maullin. Antes: el backend guardaba solo `Sale.folio`. Nunca se entera de si el SII aceptó,
   aceptó con reparos o rechazó. Falta:
   - Backend: guardar `estado`, `estado_sii` y `track_id` (migración Alembic). Consultar
     `GET /documents/{external_id}` después de emitir y en segundo plano, o con un botón "actualizar".
   - Frontend: mostrar el estado en historial, reporte diario y detalle de venta. Alertar los rechazados.
2. ✅ **`razon` en las referencias.** Hecho: la devolución manda su motivo (truncado a 90) y `SaleCreate` acepta `razon`. Antes: `_referencias_dte` (`backend/app/routers/sales.py:111`) envía `codigo` pero
   no `razon`. El manual de muestras exige imprimir el motivo. Hay que pasar la razón que ya pide el
   formulario de devolución.
3. ✅ **Guía de despacho (52).** Hecho: el POS la emite con tipo de traslado y despacho; descuenta stock,
   no pasa por caja ni se cobra. Traslado interno (5) va al propio emisor y no se factura. Historial →
   "Facturar guías" arma una 33/34 con las líneas y precios de las guías (mismo cliente, hasta 40),
   las referencia con tipo 52, cobra con un medio de pago y no vuelve a mover stock
   (`sales.ind_traslado`, `sales.facturada_por_id`, migración `d0e1f2a3b4c5`). Pendiente: emitir una
   real en maullin (JCB no tiene CAF 52 vigentes). Antes: El POS no la puede emitir: dte-torn rechaza una 52 sin `ind_traslado`, y el
   backend no lo envía. Falta:
   - Frontend: tipo de traslado (venta, traslado interno, etc.) y tipo de despacho en el checkout.
   - Backend: enviarlos. En traslado interno, el receptor es el propio emisor.
   - Definir si la guía descuenta stock y si después se factura. La factura referencia la guía con tipo 52.
4. **NC que corrige texto (código 2).** Hoy la devolución solo reingresa stock. Falta un flujo de NC sin
   montos, con el detalle en la forma "donde dice… debe decir…", como pide el manual. Sirve, por ejemplo,
   para corregir el giro o la dirección del cliente.
5. **Forma de pago y vencimiento.** Una venta con `CREDITO_INTERNO` debería ir con `forma_pago=2` y
   `fecha_vencimiento`. Hoy no se envían.

### B. Paso a producción

6. **Ambiente y resolución.** `public.tenants.sii_ambiente` / `sii_resolucion_*` ya se copian a dte-torn.
   Para JCB en producción corresponde **Res. 80 del 22-08-2014**, la que imprime Bsale. El número 0 de 2020
   es el de certificación. Falta:
   - Una pantalla (superusuario) para pasar a PROD con confirmación.
   - Un control: con PROD no se aceptan CAF de maullin.
7. **CAF de producción.** Se piden en palena, no en maullin. La pantalla de Folios (`FoliosTab.tsx`) debería
   mostrar el ambiente del CAF y alertar si no coincide con el del emisor.
8. **Convivencia con Bsale.** No emitir el mismo tipo de documento en ambos sistemas a la vez: son rangos de
   folio distintos, pero el SII los ve todos. Hay que documentar la fecha de corte por tipo.

### C. Mejoras de uso

9. **Descuento global y descuento %.** dte-torn los soporta y el POS no.
10. **Reimpresión.** Revisar que la reimpresión de cedible (`_impreso_dte`) y el ticket 57/80 mm
    (`backend/app/services/dte_impreso.py`) no corten la razón social, como pasaba en el PDF carta.
11. **Stock de folios.** Mostrar la alerta de pocos folios (`DTE_FOLIO_UMBRAL_ALERTA`) en el dashboard.

### D. Deuda técnica que toca esta etapa

12. **Totales triplicados.** `calcular_totales` (dte-torn), `totales_dte` (backend) y `totalesDte`
    (frontend). La opción mínima: un test de contrato que compare los tres con los mismos casos. La
    opción mayor: que el backend use el `monto_total` que devuelve dte-torn como fuente de verdad.
13. **Tablas DTE locales.** Correr `backend/scripts/migrate_retiro_dte_local.py --aplicar` una vez
    confirmado que todos los CAF vigentes están en dte-torn.

### Fuera de esta etapa

- **Boletas (39/41):** su propia certificación. Es la etapa anterior a esta.
- **Recepción de DTE de proveedores y acuse de recibo** (intercambio): el SII no lo exigió en esta
  certificación. Lo necesita quien reciba facturas electrónicas de compra. Evaluar después de la release.
- **Libros de compra/venta:** los reemplaza el RCV del SII. Solo se usaron en la certificación.

---

## 4. Cómo verificar que quedó alineado

- Suite del backend (`cd backend && pytest -q`), con `FakeDte` actualizado a los campos nuevos (estado,
  razón, traslado).
- Suite de dte-torn en Docker (ver `tasks/todo.md`).
- `cd frontend && npm run build` sin errores de tipos.
- En maullin, con CAF de prueba, emitir desde el POS real una venta por cada tipo: 33, 34, 52 venta,
  52 traslado interno, 61 devolución, 61 corrige texto y 56. Cada una tiene que quedar ACEPTADO, con el
  estado visible en el historial y el PDF con referencia y motivo.
