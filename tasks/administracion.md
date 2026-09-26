# Plan: tareas administrativas (todo el frontend menos el POS)

Fecha: 2026-09-25. Revisión de Productos, Listas de precios, Marcas, Compras, Clientes, Proveedores,
Personal, Historial, Reportes, Dashboard, Caja y Configuración, más el kardex en el backend.

**Criterio:** las usuarias del piloto tienen más de 60 años ([`lanzamiento.md`](lanzamiento.md)). Cada
pantalla hace una cosa, con los campos de todos los días a la vista y el resto en "Más opciones". No se
quita funcionalidad: se esconde lo que no se usa a diario.

---

## 1. Qué es el kardex y cómo está

**Kardex** = la libreta de movimientos de cada producto. Cada vez que el stock cambia se anota una línea:
fecha, qué pasó (venta, compra, devolución, ajuste), cuántas unidades entraron o salieron, quién lo hizo y
cuánto quedó. Sirve para contestar "¿por qué el sistema dice 12 si en la repisa hay 9?": se lee la libreta
y se ve dónde se fue la diferencia. Regla de oro: **el stock actual siempre es la suma de su kardex**. Si
algo cambia el stock sin anotar, la libreta deja de cuadrar y pierde su valor.

En Torn es la tabla `stock_movements` (`backend/app/models/inventory.py`).

| Quién mueve stock | ¿Anota en el kardex? | Problema |
|---|---|---|
| Venta (`sales.py` `_registrar_venta`) | Sí, SALIDA / VENTA o GUIA | Sin `balance_after`; glosa fija "Venta en proceso" (no dice el folio) |
| Nota de crédito (`sales.py` `create_return`) | Sí, ENTRADA / DEVOLUCION | Sin `balance_after` |
| Compra, edición y borrado de compra (`purchases.py`) | Sí | Sin `user_id`; borrar una compra puede dejar stock negativo |
| **Editar producto** (`PUT /products/{id}` desde `ProductEditDialog`) | **No** | Se escribe `stock_actual` a mano, sin rastro. Rompe la regla de oro |
| **Stock inicial de variantes** (`POST /products/with-variants`) | **No** | Nace stock sin movimiento INICIAL |
| Leer el kardex | **No existe** | No hay endpoint ni pantalla: se anota pero nadie lo puede ver |

**Veredicto:** la mitad está bien hecha (ventas, NC y compras anotan dentro de la misma transacción), pero
hoy el kardex no sirve: hay dos caminos que cambian stock sin anotar y no hay forma de mirarlo.

---

## 2. Hallazgos por pantalla

### Defectos (se arreglan primero)

| # | Dónde | Defecto |
|---|---|---|
| D1 | `ProductEditDialog` | "Sin marca" y "Sin impuesto" mandan `brand_id: 0` / `tax_id: 0`: violan la FK y el guardado falla |
| D2 | `ProductEditDialog` | "Sin impuesto (0%)" es falso: `tax_id` nulo cobra el IVA por defecto (`resolve_tax_rate`, `utils/taxes.py`). Para exento hay que elegir un impuesto de tasa 0 |
| D3 | `ProductEditDialog` | El stock se edita como un número más (ver kardex) |
| D4 | Clientes | Eliminar es borrado físico (`customers.py` `delete_customer`); un cliente con ventas choca con la FK. Proveedores ya desactiva |
| D5 | Historial | Trae solo las últimas 50 ventas (`getSales()` sin parámetros) y busca solo dentro de esas. Una venta de la semana pasada no aparece |
| D6 | Clientes | La deuda de crédito interno (`current_balance`) sube con cada venta fiada y solo baja con una NC. No se ve en ninguna pantalla y no hay cómo registrar que el cliente pagó |
| D7 | Compras | `updatePurchase` existe en `services/purchases.ts` pero ninguna pantalla lo usa (código muerto) |

### Fricción (lo que hace lento o confuso el trabajo diario)

- **Productos: dos formularios distintos.** `ProductWizard` para crear (2 pasos) y `ProductEditDialog` para
  editar (pestañas), con campos y comportamiento diferentes. Crear pide elegir "Sin variantes / Con
  variantes" antes de saber qué significa.
- **Variantes congeladas:** una vez creado el producto no se puede agregar ni quitar una variante, ni
  convertir un producto simple en uno con variantes.
- **La tabla de productos** muestra el stock sumado de las variantes; para ver cuántas quedan de la talla M
  hay que abrir el editor.
- **Stock mínimo y costo** existen en el modelo (`stock_minimo`, `costo_unitario`) pero no se pueden ver ni
  editar. La alerta "Bajo" del inventario nunca se activa porque el mínimo queda en 0.
- **Precio neto** en todos los formularios de producto, cuando en el mesón se piensa en el precio con IVA.
  Listas de precios ya tiene el interruptor Neto/Bruto; Productos no.
- **Compras:** busca solo por nombre o SKU (no por código de barras) y, si el producto no existe, hay que
  salir a Productos, crearlo y volver (se pierde lo que se llevaba escrito).
- **Clientes:** la lista de precios de un cliente se asigna solo desde Listas de precios, no desde su ficha.
- **Marcas** ocupa una entrada del menú para algo que ya se crea desde el formulario de producto.
- **Menú:** 13 entradas en 5 grupos con nombres técnicos ("Entidades", "Auditoría", "Terminal SaaS global").

---

## 3. Propuesta

### 3.1 Menú

| Grupo | Entradas | Cambio |
|---|---|---|
| Vender | Punto de venta, Caja, Ventas | "Historial" pasa a llamarse Ventas |
| Productos | Productos, Compras, Listas de precios | Marcas sale del menú (pestaña dentro de Productos) |
| Clientes y proveedores | Clientes, Proveedores | |
| Reportes | Resumen (dashboard), Reportes | |
| Ajustes | Configuración, Personal | Personal deja "Entidades"; SaaS global queda solo para superusuario |

Mismos permisos (`permissionKey`) que hoy: solo cambian etiquetas y agrupación en `Sidebar.tsx`
(`MobileNav.tsx` es una barra fija de 5 accesos y ya dice "Ventas"; no cambia).

### 3.2 Productos: un solo formulario

Un `ProductoForm` para crear y editar (reemplaza `ProductWizard` y `ProductEditDialog`):

- **A la vista:** nombre, precio de venta, código de barras (acepta el lector), controla stock.
- **"Tiene variantes (talla, color...)"**: interruptor. Encendido, aparece una tabla corta: nombre, precio,
  código de barras. Se pueden agregar y quitar filas también al editar. Quitar una variante con ventas la
  desactiva, no la borra.
- **Más opciones** (cerrado por defecto): SKU, marca, impuesto, descripción, stock mínimo, unidad.
- **Stock no es un campo.** Se muestra el número y dos botones: "Ajustar stock" y "Ver movimientos".

La tabla de Productos gana: fila expandible con el stock por variante y filtro "Stock bajo".

### 3.3 Kardex visible

- **Ajustar stock:** un diálogo que pregunta "¿Cuántas hay ahora?" y el motivo (Conteo, Merma o pérdida,
  Stock inicial, Otro). El sistema calcula la diferencia y la anota.
- **Ver movimientos:** lista del producto con fecha, motivo, entra, sale, saldo, documento (folio de venta
  o compra) y quién. Sin filtros en la primera versión.

### 3.4 Clientes: cuenta corriente

- Columna **Saldo** en la lista (solo si es distinto de 0) y filtro "Con deuda".
- En la ficha del cliente: saldo, ventas a crédito y botón **Registrar pago** (monto, medio de pago, nota).
- La lista de precios del cliente se elige en su ficha.
- Eliminar = desactivar, igual que proveedores.

---

## 4. Tareas

Una tarea = una rama o commit verificado, suite verde (`cd backend && pytest -q`, `cd frontend && npx tsc
--noEmit && npm run build`). Backend antes que frontend en cada fase.

### Fase 0: defectos

- [ ] **A1** D1 y D2: "Sin marca" manda `null`; quitar la opción "Sin impuesto (0%)" (el exento se elige
      como impuesto). Archivos: `ProductEditDialog.tsx`. XS
- [ ] **A2** D4: `delete_customer` desactiva (`is_active = False`) y `GET /customers` filtra activos.
      Test: borrar un cliente con ventas responde 204 y las ventas siguen. S
- [ ] **A3** D5: `GET /sales` acepta `desde`/`hasta` y `q` (folio o cliente); Historial filtra por día
      (hoy por defecto, con selector de fecha) en vez de las últimas 50. Test del filtro. S
- [ ] **A4** D7: borrar `updatePurchase` de `services/purchases.ts`. Una compra mal ingresada se elimina y
      se vuelve a ingresar (el borrado ya revierte el stock). XS

### Fase 1: kardex correcto (backend)

- [ ] **K1** Función única `mover_stock(db, producto, cantidad, motivo, user_id, sale_id=None,
      purchase_id=None, glosa)` en `backend/app/services/`: cambia `stock_actual`, escribe
      `balance_after` y crea el `StockMovement`. Ventas, NC y compras pasan a usarla.
      Test: tras vender, devolver, comprar y borrar la compra, `stock_actual` = suma de movimientos y cada
      `balance_after` es el saldo corrido. M
- [ ] **K2** Columna `purchase_id` en `stock_movements` (migración Alembic que recorre esquemas, patrón
      `c9d0e1f2a3b4`) para enlazar el documento en vez de texto libre. S
- [ ] **K3** `PUT /products/{id}` deja de aceptar `stock_actual` (422 si viene).
      `POST /products/{id}/ajuste-stock {cantidad_contada, motivo, nota}` anota AJUSTE o INICIAL.
      Crear producto o variantes con stock > 0 anota INICIAL. Tests. S
- [ ] **K4** `GET /products/{id}/movimientos?skip&limit`, más nuevo primero, con folio y nombre de usuario.
      Test. S
- [ ] **K5** Cuadratura de lo existente: migración de datos que, por producto con `controla_stock`, anota
      un AJUSTE "Saldo al activar el kardex" por la diferencia entre `stock_actual` y la suma de sus
      movimientos. Correrla en una copia de la base del piloto antes. S

→ *Checkpoint 1:* suite verde; en la base de desarrollo todo producto cuadra (consulta SQL de control).

### Fase 2: productos

- [ ] **P1** Backend de variantes editables: `POST /products/{id}/variants` (agrega a un padre o
      convierte un simple en padre si no tiene ventas ni stock) y desactivar variante. Tests. M
- [ ] **P2** `ProductoForm` (sección 3.2) con React Hook Form + Zod, como `CustomerForm`. Reemplaza y
      borra `ProductWizard.tsx` y `ProductEditDialog.tsx`. M
- [ ] **P3** Diálogos "Ajustar stock" y "Ver movimientos" (sección 3.3). S
- [ ] **P4** Tabla de productos: fila expandible por variante, filtro "Stock bajo", Marcas como pestaña
      (mueve el contenido de `app/marcas/page.tsx`; la ruta redirige). S
- [ ] **P5** Compras: buscar también por código de barras (lector) y botón "Crear producto" que abre
      `ProductoForm` sin salir de la compra. S

→ *Checkpoint 2:* crear, editar, agregar variante, ajustar stock y comprar desde el navegador; revisión
`code-review-and-quality`.

### Fase 3: clientes

- [ ] **C1** Backend de pagos de cuenta corriente: tabla `customer_payments` (fecha, monto, medio,
      usuario, nota; migración), `POST /customers/{rut}/pagos` que baja `current_balance`,
      `GET /customers/{rut}/cuenta` (ventas a crédito, pagos y NC). No se permite pagar más que la deuda.
      Tests. M
- [ ] **C2** Clientes: columna Saldo, filtro "Con deuda", ficha con cuenta y "Registrar pago", lista de
      precios en el formulario. S

### Fase 4: menú

- [ ] **M1** Menú de la sección 3.1 en `Sidebar.tsx`; renombrar títulos de página para
      que coincidan. XS

→ *Checkpoint final:* recorrido completo en el navegador (tema claro y oscuro, ancho de celular);
revisión con el usuario antes del piloto.

## 5. Skills por fase

| Skill | Dónde |
|---|---|
| `test-driven-development` | K1-K5, P1, C1: test rojo con el stock o saldo calculado a mano |
| `incremental-implementation` | Una tarea = un commit con la suite verde |
| `frontend-ui-engineering` | P2-P5, C2, M1: formularios accesibles, letra mínima 12 px, sin toasts |
| `code-simplification` | P2: al fusionar los dos formularios de producto |
| `code-review-and-quality` | En cada checkpoint |

## 6. Preguntas abiertas

1. **Precio en el formulario de producto:** ¿se escribe con IVA (lo que paga el cliente) y el sistema
   guarda el neto, o se deja neto como hoy? Recomendación: con IVA.
2. **Pago de cuenta corriente en efectivo:** ¿entra a la caja del turno abierto (suma al arqueo)?
   Recomendación: sí, si el control de caja está encendido.
3. **Carga masiva desde Bsale:** ¿se importan productos y clientes desde un Excel/CSV exportado de Bsale
   para el piloto, o se cargan a mano? Si hay que importar, va como fase propia antes del piloto.
4. **Costo del producto:** hoy es el costo de la última compra. ¿Basta, o se quiere costo promedio? Afecta
   la utilidad de los reportes. Recomendación: dejar el último costo.
5. **Menú:** ¿se aprueba la agrupación de 3.1 y sacar Marcas del menú?

Fuera de alcance: el POS; autocompletar por RUT tiene su plan en
[`autocompletar_rut_sii.md`](autocompletar_rut_sii.md).
