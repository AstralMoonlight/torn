# Plan: set de pruebas SII completo (dte-torn)

Fecha: 2026-09-24. Archivo del SII: `setDePruebas/SIISetDePruebas763989569.txt` (fuera de git).
Tareas detalladas en [`tasks/todo.md`](todo.md).

> **Estado (2026-09-25): terminado.** Los 6 sets, la simulación y las muestras están declarados; se espera la
> validación del SII. Las preguntas abiertas de abajo quedaron respondidas en T9 (ver `todo.md`).

## Objetivo

Enviar y declarar los 6 sets pedidos para DISTRIBUIDORA JCB SPA, cada uno en su propio envío,
sin reparos ni rechazos, y dejar listas las muestras impresas.

| Set | N° atención | Folios |
|---|---|---|
| Básico | 5093757 | 33×4, 61×3, 56×1 |
| Guía de despacho | 5093758 | 52×3 |
| Factura exenta | 5093759 | 34×3, 61×3, 56×2 |
| Libro de ventas | 5093760 | - (documentos del set básico) |
| Libro de compras | 5093761 | - (7 documentos dados por el SII) |
| Libro de guías | 5093762 | - (guías del set de guía; caso 2 facturada, caso 3 anulada) |

## Decisiones

- **Todo vive en `dte-torn/`.** El backend de Torn no participa en la certificación.
- **Un set = un envío = una declaración.** El máximo de folios del SII importa por set, no por total.
- **Se reutiliza lo existente:** `set_pruebas.py` (lector), `certificacion.py` (modos `set`,
  `revisar-set`, `muestras`, `enviar`), `firmar_sobre` y `ClienteSii.enviar`. Los libros se suben
  por el mismo endpoint de upload que los DTE. Hay que confirmarlo contra el instructivo.
- **`parsear_set(texto, nombre)`** elige la sección del archivo (commit 6322a3c). Los modos del
  script reciben el set a usar por una variable de entorno (`DTE_SET_NOMBRE`), con el básico por defecto.
- **Totales esperados calculados a mano en los tests**, nunca con el código que se prueba (convención de
  `tests/test_set_pruebas.py`).
- **Formatos nuevos (guía, libros) se construyen desde los XSD e instructivos oficiales del SII**, no
  de memoria.

## Skills por fase

| Skill | Dónde |
|---|---|
| `source-driven-development` | Guía 52 y libros: leer XSD e instructivo del SII antes de programar |
| `test-driven-development` | Cada cambio de builder o lector: test rojo con montos a mano, luego código |
| `incremental-implementation` | Una tarea = un commit verificado, suite verde en cada paso |
| `code-review-and-quality` | En cada checkpoint, antes de enviar al SII real |
| `git-workflow-and-versioning` | Commits por tarea (Conventional Commits en español), push a `main` |
| `debugging-and-error-recovery` | Si el SII devuelve reparos o rechazos |

## Orden y checkpoints

1. **Fase 1: set básico.** Ya soportado; solo operar (folios + envío + declarar).
2. **Fase 2: factura exenta.** Cambios chicos al lector; el 34 ya existe.
   → *Checkpoint A:* básico y exenta enviados con EPR sin reparos.
3. **Fase 3: guía de despacho.** Documento 52 nuevo en builder, lector y PDF.
   → *Checkpoint B:* guía enviada sin reparos.
4. **Fase 4: libros.** Formato nuevo: sobre de libro, XSD, firma. Depende de los documentos aceptados.
   → *Checkpoint C:* los 3 libros aceptados y los 6 sets declarados.
5. **Fase 5: muestras impresas.** Copia tributaria y cedible de 33, 34 y 52.

**En paralelo desde hoy (lo hace el usuario en maullin):** emisiones de prueba para subir el máximo
de folios del 56 a 2. Las del 34 y 52 empiezan cuando existan sus tareas (T4 y T7).

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Máximo de folios de 34, 52 y 56 en 1 | Alto: bloquea el envío | Ciclos de emisión de prueba temprano; si no sube, pedir a la mesa de ayuda del SII |
| Formato de libros desconocido en el repo (sin XSD) | Alto | T9 primero: esqueleto validado contra el XSD oficial antes de llenar datos |
| Pedir el set otra vez anula todo | Alto | No volver a pedir el set; cualquier duda se resuelve sin tocar "Generación de set de pruebas" |
| Subida ambigua (maullin corta la conexión) | Medio | Ya resuelto: el modo `set` verifica y reenvía, es idempotente |
| Reparos por la representación impresa (descuentos, separador de miles) | Medio | T14 revisa el PDF contra la indicación del set |
| Correos de intercambio apuntan a Haulmer | Medio (etapa siguiente) | El usuario los cambia en maullin antes de la etapa de intercambio |

## Preguntas abiertas

- ¿Qué va en `FolioNotificacion` y `TipoLibro` para los libros del set? Hay que confirmarlo en el instructivo del
  libro (T9). La suposición es "ESPECIAL" + número de atención.
- ¿Qué período tributario llevan los libros? Probablemente el mes de envío de los documentos del set.
- ¿El libro de compras informa la factura de compra (46) con retención total aunque JCB no emita 46? Sí,
  el set lo trae como dato recibido; solo se informa.
