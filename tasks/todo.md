# Tareas: set de pruebas SII completo

Plan y decisiones en [`plan.md`](plan.md). Tests de dte-torn:
`cd dte-torn && docker compose --profile test run --rm tests` (250 en verde al 2026-09-24).
**U** = lo hace el usuario en maullin (crea cosas en el SII). **T** = código.

---

## Fase 1: Set básico (5093757)

### U1: Pedir folios del set básico
- [ ] CAF 33 ×4, 61 ×3, 56 ×1 en maullin, guardados en `dte-torn/` (gitignored)

### T1: Enviar y declarar el set básico
**Descripción:** correr `certificacion set` con el archivo nuevo y los CAF de U1.
**Aceptación:**
- [ ] `revisar-set` muestra los 8 casos con totales que cuadran a mano
- [ ] Envío único: EPR, 8 aceptados, 0 reparos
- [ ] Usuario declara el avance con el track ID
**Dependencias:** U1 · **Archivos:** ninguno (solo `.env`) · **Tamaño:** XS

---

## Fase 2: Factura exenta (5093759)

### U2: Subir máximos (en paralelo, ya se puede)
- [ ] 56: una emisión de prueba más (`certificacion enviar` tipo 56) → máximo ≥ 2
- [ ] 34: 2–3 emisiones de prueba tras T3 → máximo ≥ 3

### T2: Lector entiende el set de exenta
**Descripción:** `set_pruebas.py` hoy falla con este set. Hay que soportar la columna `UNIDAD MEDIDA` (texto),
el encabezado `VALOR UNITARIO` sin `CANTIDAD`, las notas "MODIFICA MONTO" que traen solo el valor unitario
(la cantidad sale del caso referenciado) y la nota de débito del caso 8, que referencia la factura.
**Aceptación:**
- [ ] `parsear_set(texto, "SET FACTURA EXENTA")` devuelve 8 casos: 34×3, 61×3, 56×2
- [ ] Unidad "Hora" llega a `Item.unidad`; montos de cada caso calculados a mano en el test
- [ ] El set básico sigue pasando igual
**Verificación:** tests de `test_set_pruebas.py` · **Dependencias:** ninguna
**Archivos:** `app/dte/set_pruebas.py`, `tests/test_set_pruebas.py` · **Tamaño:** S
**Skill:** test-driven-development

### T3: Script elige el set y valida el 34 contra el XSD
**Descripción:** `DTE_SET_NOMBRE` en `set`, `revisar-set` y `muestras`, con la clave idempotente
`set-<atención>-<caso>` ya distinta por set. Test: los 8 documentos de exenta construyen XML válido
contra `DTE_v10.xsd` y sin IVA ni tasa.
**Aceptación:**
- [ ] `revisar-set` con `DTE_SET_NOMBRE="SET FACTURA EXENTA"` lista los 8 casos y folios necesarios
- [ ] XML del 34 sin `IVA`/`TasaIVA`/`MntNeto`, valida XSD
- [ ] `certificacion enviar` emite una prueba con un CAF 34 (para U2)
**Dependencias:** T2 · **Archivos:** `app/scripts/certificacion.py`, `tests/test_certificacion_script.py`, `tests/test_builder_xsd.py` · **Tamaño:** S

### T4: Enviar y declarar el set de exenta
- [ ] Máximos 34 ≥ 3 y 56 ≥ 2 (U2); pedir CAF 34×3, 61×3, 56×2
- [ ] Envío único EPR 8 aceptados 0 reparos; usuario declara
**Dependencias:** T3, U2 · **Tamaño:** XS

### Checkpoint A
- [ ] Suite verde · revisión `code-review-and-quality` del diff de fase 2
- [ ] Básico y exenta enviados sin reparos

---

## Fase 3: Guía de despacho (5093758)

### T5: Documento 52 en el builder
**Descripción:** agregar 52 a `TIPOS_SOPORTADOS` con `IndTraslado` (1 venta, 5 traslado interno…) y
`TipoDespacho` (1 cliente, 2 emisor a local del cliente, 3 emisor a otras instalaciones) en `IdDoc`.
Hay que permitir líneas sin precio en el traslado interno. En el traslado interno el receptor es el emisor.
Todo contra XSD e instructivo (**source-driven-development**).
**Aceptación:**
- [ ] Los 3 casos construyen XML válido contra `DTE_v10.xsd`, con totales a mano (caso 1 en $0)
- [ ] 52 sin `IndTraslado` se rechaza con error claro
- [ ] Timbre (TED) y firma verifican para 52
**Dependencias:** ninguna · **Archivos:** `app/dte/builder.py`, `tests/test_builder.py`, `tests/test_builder_xsd.py`, `tests/test_signer.py` · **Tamaño:** M

### T6: Lector entiende el set de guía
**Descripción:** `MOTIVO:` → `IndTraslado`, `TRASLADO POR:` → `TipoDespacho`, líneas sin precio.
Caso 1: receptor = datos del emisor.
**Aceptación:**
- [ ] `parsear_set(texto, "SET GUIA DE DESPACHO")` → 3 casos 52 con traslado y despacho correctos
**Dependencias:** T5 · **Archivos:** `app/dte/set_pruebas.py`, `app/scripts/certificacion.py`, tests · **Tamaño:** S

### T7: PDF de la guía
**Descripción:** nombre del documento (ya está en `pdf.py`), tipo de traslado impreso y copia cedible
solo si el traslado es venta. En el traslado interno "el ejemplar cedible es inoficioso".
**Aceptación:**
- [ ] Caso 2 y 3 generan tributaria + cedible; caso 1 solo tributaria
- [ ] Timbre legible en el PDF (mismo test PDF417 que 33)
**Dependencias:** T5 · **Archivos:** `app/dte/pdf.py`, `tests/test_pdf.py` · **Tamaño:** S

### T8: Subir máximo del 52, enviar y declarar
- [ ] `certificacion enviar` emite una prueba con un CAF 52
- [ ] Emisiones de prueba de 52 hasta máximo ≥ 3 (U)
- [ ] CAF 52×3; envío único EPR 3 aceptados 0 reparos; usuario declara
**Dependencias:** T6, T7

### Checkpoint B
- [ ] Suite verde · revisión del diff de fase 3 · guía enviada sin reparos

---

## Fase 4: Libros (5093760, 5093761, 5093762)

### T9: Esqueleto de libros validado (riesgo alto: hacerlo primero en la fase)
**Descripción:** bajar de sii.cl los XSD oficiales `LibroCV` y `LibroGuia` (con su `SiiTypes`) a
`app/dte/xsd/libros/`. Hay que construir y firmar `LibroCompraVenta` y `LibroGuia` (carátula + resumen +
detalle, firma sobre `EnvioLibro`) y subirlos con `ClienteSii.enviar`. Hay que confirmar en el instructivo
`TipoLibro`, `TipoEnvio` y `FolioNotificacion`.
**Aceptación:**
- [ ] Un libro mínimo de cada tipo valida contra su XSD y su firma verifica
- [ ] Preguntas abiertas de `plan.md` respondidas con cita al instructivo
**Dependencias:** ninguna (se puede adelantar) · **Archivos:** `app/dte/libros.py` (nuevo), `app/dte/signer.py`, XSD, `tests/test_libros.py` · **Tamaño:** M

### T10: Libro de ventas desde el set básico
**Descripción:** detalle y resumen por tipo a partir de los 8 documentos aceptados (tabla `documents`,
external_id `set-5093757-*`).
**Aceptación:** [ ] totales por tipo a mano en el test · [ ] valida XSD
**Dependencias:** T9, T1 · **Tamaño:** S

### T11: Libro de compras desde el set
**Descripción:** leer la tabla del set: IVA de uso común con factor 0,60, factura de compra 46 con
retención total, entrega gratuita como IVA no recuperable (código a confirmar) y notas de crédito.
**Aceptación:** [ ] 7 detalles con montos e IVA a mano · [ ] valida XSD
**Dependencias:** T9 · **Tamaño:** S

### T12: Libro de guías desde el set de guía
**Descripción:** 3 guías; caso 2 marcada facturada y caso 3 anulada.
**Aceptación:** [ ] valida XSD · [ ] marcas de facturada y anulada según el instructivo
**Dependencias:** T9, T8 · **Tamaño:** S

### T13: Modo `libros` en el script, enviar y declarar
- [ ] `certificacion libros` sube cada libro, espera el estado y muestra el track
- [ ] Los 3 aceptados; usuario declara cada uno
**Dependencias:** T10, T11, T12

### Checkpoint C
- [ ] Suite verde · revisión del diff de fase 4 · 6 sets declarados

---

## Fase 5: Muestras impresas

### T14: Muestras según las indicaciones del set
**Descripción:** hay que revisar `pdf.py` contra lo que exige el set. Los descuentos por línea y globales tienen que verse en el
impreso, las cifras llevan punto como separador de miles, y se generan tributaria + cedible de 33, 34 y 52
(no de 61/56). También hay que confirmar la unidad "S.I.I. - CONCEPCION" y el tamaño del timbre en el
instructivo de formato.
**Aceptación:**
- [ ] `certificacion muestras` genera los PDF de los 3 sets en `setDePruebas/muestras/`
- [ ] Revisión visual del usuario
**Dependencias:** Checkpoint C · **Archivos:** `app/dte/pdf.py`, `app/scripts/certificacion.py`, `tests/test_pdf.py` · **Tamaño:** S
