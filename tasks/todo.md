# Tareas: set de pruebas SII completo

> **Estado (2026-09-25):** todo declarado y muestras enviadas en la declaración. **Esperando la validación
> del SII.** Lo que queda es su respuesta y, después, la declaración de cumplimiento del representante legal.
> Lo siguiente está en [`alineacion_backend_frontend.md`](alineacion_backend_frontend.md) (prioridades).

Plan y decisiones en [`plan.md`](plan.md). Tests de dte-torn:
`cd dte-torn && docker compose --profile test run --rm tests` (291 en verde al 2026-09-24; la imagen no monta el código: agregar `-v "$(pwd -W)/app:/srv/app" -v "$(pwd -W)/tests:/srv/tests"` o reconstruir).
**U** = lo hace el usuario en maullin (crea cosas en el SII). **T** = código.

---

## Fase 1: Set básico (5093757)

### U1: Pedir folios del set básico
- [x] CAF 33 ×4, 61 ×3, 56 ×1 en maullin, guardados en `dte-torn/` (gitignored)
  - Estado 2026-09-24: los `caf_*_set_*.xml` de `dte-torn/` están AGOTADOS (los usó el set anterior 5093021). Hay que pedir CAF nuevos.
  - El archivo vigente es `setDePruebas/SIISetDePruebas763989569 (1).txt` (atención 5093757…); el sin "(1)" es un set anterior (5093746…).

### T1: Enviar y declarar el set básico
**Descripción:** correr `certificacion set` con el archivo nuevo y los CAF de U1.
**Aceptación:**
- [x] `revisar-set` muestra los 8 casos con totales que cuadran a mano
- [x] Envío único: EPR, 8 aceptados, 0 reparos - track 0260080046 (24-09-2026). CAF en `dte-torn/folios/`: 33 71-74, 61 69-71, 56 60
- [x] Usuario declara el avance con el track ID
**Dependencias:** U1 · **Archivos:** ninguno (solo `.env`) · **Tamaño:** XS

---

## Fase 2: Factura exenta (5093759)

### U2: Subir máximos (en paralelo, ya se puede)
- [x] 56: no hizo falta; el SII autorizó 2 folios directo
- [x] 34: no hizo falta; el SII autorizó 3 folios directo

### T2: Lector entiende el set de exenta
**Descripción:** `set_pruebas.py` hoy falla con este set. Hay que soportar la columna `UNIDAD MEDIDA` (texto),
el encabezado `VALOR UNITARIO` sin `CANTIDAD`, las notas "MODIFICA MONTO" que traen solo el valor unitario
(la cantidad sale del caso referenciado) y la nota de débito del caso 8, que referencia la factura.
**Aceptación:**
- [x] `parsear_set(texto, "SET FACTURA EXENTA")` devuelve 8 casos: 34×3, 61×3, 56×2
- [x] Unidad "Hora" llega a `Item.unidad`; montos de cada caso calculados a mano en el test
- [x] El set básico sigue pasando igual
**Verificación:** tests de `test_set_pruebas.py` · **Dependencias:** ninguna
**Archivos:** `app/dte/set_pruebas.py`, `tests/test_set_pruebas.py` · **Tamaño:** S
**Skill:** test-driven-development

### T3: Script elige el set y valida el 34 contra el XSD
**Descripción:** `DTE_SET_NOMBRE` en `set`, `revisar-set` y `muestras`, con la clave idempotente
`set-<atención>-<caso>` ya distinta por set. Test: los 8 documentos de exenta construyen XML válido
contra `DTE_v10.xsd` y sin IVA ni tasa.
**Aceptación:**
- [x] `revisar-set` con `DTE_SET_NOMBRE="SET FACTURA EXENTA"` lista los 8 casos y folios necesarios
- [x] XML del 34 sin `IVA`/`TasaIVA`/`MntNeto`, valida XSD
- [x] `certificacion enviar` emite una prueba con un CAF 34 (para U2)
**Dependencias:** T2 · **Archivos:** `app/scripts/certificacion.py`, `tests/test_certificacion_script.py`, `tests/test_builder_xsd.py` · **Tamaño:** S

### T4: Enviar y declarar el set de exenta
- [x] Máximos 34 ≥ 3 y 56 ≥ 2 (U2); pedir CAF 34×3, 61×3, 56×2 - el SII los dio directo: 34 101-103, 61 72-74, 56 61-62
- [x] Envío único EPR 8 aceptados 0 reparos - track 0260081142 (24-09-2026); declarado con el reenvío 0260088718
**Dependencias:** T3, U2 · **Tamaño:** XS

### Checkpoint A
- [x] Suite verde · revisión `code-review-and-quality` del diff de fase 2
- [x] Básico y exenta enviados sin reparos

---

## Fase 3: Guía de despacho (5093758)

### T5: Documento 52 en el builder
**Descripción:** agregar 52 a `TIPOS_SOPORTADOS` con `IndTraslado` (1 venta, 5 traslado interno…) y
`TipoDespacho` (1 cliente, 2 emisor a local del cliente, 3 emisor a otras instalaciones) en `IdDoc`.
Hay que permitir líneas sin precio en el traslado interno. En el traslado interno el receptor es el emisor.
Todo contra XSD e instructivo (**source-driven-development**).
**Aceptación:**
- [x] Los 3 casos construyen XML válido contra `DTE_v10.xsd`, con totales a mano (caso 1 en $0)
- [x] 52 sin `IndTraslado` se rechaza con error claro
- [x] Timbre (TED) y firma verifican para 52
**Dependencias:** ninguna · **Archivos:** `app/dte/builder.py`, `tests/test_builder.py`, `tests/test_builder_xsd.py`, `tests/test_signer.py` · **Tamaño:** M

### T6: Lector entiende el set de guía
**Descripción:** `MOTIVO:` → `IndTraslado`, `TRASLADO POR:` → `TipoDespacho`, líneas sin precio.
Caso 1: receptor = datos del emisor.
**Aceptación:**
- [x] `parsear_set(texto, "SET GUIA DE DESPACHO")` → 3 casos 52 con traslado y despacho correctos
**Dependencias:** T5 · **Archivos:** `app/dte/set_pruebas.py`, `app/scripts/certificacion.py`, tests · **Tamaño:** S

### T7: PDF de la guía
**Descripción:** nombre del documento (ya está en `pdf.py`), tipo de traslado impreso y copia cedible
solo si el traslado es venta. En el traslado interno "el ejemplar cedible es inoficioso".
**Aceptación:**
- [x] Caso 2 y 3 generan tributaria + cedible; caso 1 solo tributaria
- [x] Timbre legible en el PDF (mismo test PDF417 que 33)
**Dependencias:** T5 · **Archivos:** `app/dte/pdf.py`, `tests/test_pdf.py` · **Tamaño:** S

### T8: Subir máximo del 52, enviar y declarar
- [x] `certificacion enviar` emite una prueba con un CAF 52
- [x] ~~Emisiones de prueba de 52 hasta máximo ≥ 3 (U)~~ no hizo falta: el SII dio los 3 folios directo
- [x] CAF 52×3 (106-108); envío único EPR 3 aceptados 0 reparos - track 0260086000 (24-09-2026)
**Dependencias:** T6, T7

### Checkpoint B
- [x] Guía enviada sin reparos (SOK)
- [ ] Revisión del diff de fase 3 (no se hizo; ya no bloquea porque el SII aceptó el envío)

---

## Fase 4: Libros (5093760, 5093761, 5093762)

### T9: Esqueleto de libros validado (riesgo alto: hacerlo primero en la fase)
**Descripción:** bajar de sii.cl los XSD oficiales `LibroCV` y `LibroGuia` (con su `SiiTypes`) a
`app/dte/xsd/libros/`. Hay que construir y firmar `LibroCompraVenta` y `LibroGuia` (carátula + resumen +
detalle, firma sobre `EnvioLibro`) y subirlos con `ClienteSii.enviar`. Hay que confirmar en el instructivo
`TipoLibro`, `TipoEnvio` y `FolioNotificacion`.
**Aceptación:**
- [x] Un libro mínimo de cada tipo valida contra su XSD y su firma verifica (XSD en `app/dte/xsd/libros/`, parche de 2 defectos en `tests/factories.py`)
- [x] Preguntas abiertas respondidas: `inst_set_pruebas.pdf` → ESPECIAL, TOTAL, FolioNotificacion 1 (ventas) y 2 (compras), período = el del set básico. Aceptado así por el SII.
**Dependencias:** ninguna (se puede adelantar) · **Archivos:** `app/dte/libros.py` (nuevo), `app/dte/signer.py`, XSD, `tests/test_libros.py` · **Tamaño:** M

### T10: Libro de ventas desde el set básico
**Descripción:** detalle y resumen por tipo a partir de los 8 documentos aceptados (tabla `documents`,
external_id `set-5093757-*`).
**Aceptación:** [x] totales por tipo a mano en el test · [x] valida XSD - **ENVIADO: track 0260084694, LOK** (24-09-2026). El primer intento (0260084070) fue LRH: faltaban MntExe/MntNeto/MntIVA en 0.
**Dependencias:** T9, T1 · **Tamaño:** S

### T11: Libro de compras desde el set
**Descripción:** leer la tabla del set: IVA de uso común con factor 0,60, factura de compra 46 con
retención total, entrega gratuita como IVA no recuperable (código a confirmar) y notas de crédito.
**Aceptación:** [x] 7 detalles con montos e IVA a mano · [x] valida XSD - **ENVIADO: track 0260084758, LOK** (24-09-2026)
**Dependencias:** T9 · **Tamaño:** S

### T12: Libro de guías desde el set de guía
**Descripción:** 3 guías; caso 2 marcada facturada y caso 3 anulada.
**Aceptación:** [x] valida XSD · [x] marcas de facturada y anulada - factura 75 (track 0260086476) ampara la guía 107; **libro ENVIADO: track 0260086522, LOK** (24-09-2026). FolioNotificacion = N° de atención del set de libro de guías.
**Dependencias:** T9, T8 · **Tamaño:** S

### T13: Modo `libros` en el script, enviar y declarar
- [x] `certificacion libro` (`DTE_LIBRO=ventas|compras`) sube el libro, espera el estado y muestra el track. Falta guías.
- [x] Los 3 aceptados; usuario declara cada uno (ventas reenviado como 0260088990)
  - 2026-09-24: libro de ventas declarado con 0260084694 → **SRH "No Tiene un SET Basico Aprobado"**. Cada libro se declara recién cuando su set de origen está APROBADO (ventas ← básico, guías ← guía). Reenviar el libro de ventas (nuevo track) cuando el básico salga aprobado.
**Dependencias:** T10, T11, T12

### Checkpoint C
- [x] 6 sets declarados
- [ ] Revisión del diff de fase 4 (no se hizo; ya no bloquea porque el SII aceptó el envío)

---

## Fase 5: Muestras impresas

### T14: Muestras según las indicaciones del set
**Descripción:** hay que revisar `pdf.py` contra lo que exige el set. Los descuentos por línea y globales tienen que verse en el
impreso, las cifras llevan punto como separador de miles, y se generan tributaria + cedible de 33, 34 y 52
(no de 61/56). También hay que confirmar la unidad "S.I.I. - CONCEPCION" y el tamaño del timbre en el
instructivo de formato.
**Aceptación:**
- [x] `certificacion muestras` genera los PDF de los 3 sets en `setDePruebas/muestras/`
- [x] Revisión visual del usuario; 28 muestras del set enviadas en la declaración, esperando validación del SII
**Dependencias:** Checkpoint C · **Archivos:** `app/dte/pdf.py`, `app/scripts/certificacion.py`, `tests/test_pdf.py` · **Tamaño:** S

---

## Tabla declarada (24-09-2026, segundo intento)

Básico y exenta se reenviaron (DTE_SET_INTENTO=2) tras el SRH por "Los Valores de la Linea 1 del
Detalle No Cuadran" (fix bdb1f9d). Guía y libro de guías ya están SOK.

| Set | N° Envío | Fecha | Estado |
|---|---|---|---|
| SET BASICO | 0260088892 | 24-09-2026 | SOK |
| SET GUIA DE DESPACHO | 0260086000 | 24-09-2026 | SOK |
| SET FACTURA EXENTA | 0260088718 | 24-09-2026 | SOK |
| LIBRO DE VENTAS | 0260088990 | 24-09-2026 | LOK (docs del intento 2) |
| LIBRO DE COMPRAS | 0260084758 | 24-09-2026 | LOK |
| LIBRO DE GUIAS | 0260086522 | 24-09-2026 | SOK |

---

## Fase 6: Simulación

- [x] `setDePruebas/simulacion.txt` (gitignored): 24 documentos con clientes, productos y precios reales de Bsale (facturas 1648-1667). 17×33, 1×34 exenta, 2×52 y 3×61. La NC que anula apunta a la exenta, porque JCB no tiene productos exentos. 1×56.
- [x] Envío único EPR, 24 aceptados, 0 reparos - **track 0260198860 (24-09-2026)**. CAF en `dte-torn/folios/`: 33 80-96, 34 107-108 (sobra el 108), 52 109-110, 61 81-83, 56 66
- [x] Usuario declara el avance con el track ID
- [ ] ~~Intercambio de información~~: el SII no lo exigió en esta certificación. Ahora es la prioridad P1 de [`alineacion_backend_frontend.md`](alineacion_backend_frontend.md)
- [x] Muestras impresas: las del set de pruebas + 7 de la simulación (reemplazo 0260200310), enviadas; esperando validación del SII
- 2026-09-24: las muestras de la simulación 0260198860 no pasan el validador ("Fecha Firma del TED debe ser mayor o igual a la fecha del documento"): FchEmis 25-09 por UTC (fix 248851b). Se emitió un envío de reemplazo con 1 documento por tipo, EPR 5/5, **track 0260200310** (33 F97, 34 F108, 52 F111, 61 F84, 56 F67). Sus PDF están en `setDePruebas/subir_sii_simulacion/`.
