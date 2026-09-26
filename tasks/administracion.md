# Plan: tareas administrativas (todo el frontend menos el POS)

Fecha: 2026-09-25. Revisión de Productos, Listas de precios, Marcas, Compras, Clientes, Proveedores,
Personal, Historial, Reportes, Dashboard, Caja y Configuración, más el kardex y la caja en el backend.

**Criterio:** no todos los usuarios serán mayores, pero la vara es que una persona de más de 60 años lo
pueda usar sin ayuda: si a ella no se le complica, a nadie más joven tampoco. Cada pantalla hace una cosa,
con los campos de todos los días a la vista y el resto en "Más opciones". No se quita funcionalidad: se
esconde lo que no se usa a diario. Cuando el negocio tiene que elegir cómo trabajar, la elección vive en
**Configuración → Mi negocio**, no en el código.

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

## 2. Hallazgos

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
| D8 | Caja | **Una devolución en efectivo suma al arqueo en vez de restar.** La NC guarda un `SalePayment` EFECTIVO positivo (`create_return`) y `close_session` (`cash.py`) suma todo pago EFECTIVO del cajero. Devolver $10.000 hace que el sistema espere $10.000 más en el cajón, cuando hay $10.000 menos: el arqueo marca un faltante de $20.000 |
| D9 | Reportes | **La utilidad de ventas pasadas cambia cuando cambia el costo.** `stats.py` calcula `precio_unitario - Product.costo_unitario` con el costo de hoy; `SaleDetail` no guarda el costo del momento de la venta. Una compra nueva reescribe la utilidad del mes pasado |

### Fricción (lo que hace lento o confuso el trabajo diario)

- **Cada pantalla resuelve distinto lo mismo.** Productos usa un asistente para crear y un diálogo con
  pestañas para editar; Clientes y Marcas, un diálogo simple; Compras, pestañas "Nuevo / Historial";
  Listas de precios, un diálogo grande de dos columnas. Quien aprende una pantalla no aprende las demás.
- **Productos: dos formularios distintos** (`ProductWizard` y `ProductEditDialog`), con campos y
  comportamiento diferentes. Crear pide elegir "Sin variantes / Con variantes" antes de saber qué significa.
- **Variantes congeladas:** una vez creado el producto no se puede agregar ni quitar una variante, ni
  convertir un producto simple en uno con variantes.
- **La tabla de productos** muestra el stock sumado de las variantes; para ver cuántas quedan de la talla M
  hay que abrir el editor.
- **Stock mínimo y costo** existen en el modelo (`stock_minimo`, `costo_unitario`) pero no se pueden ver ni
  editar. La alerta "Bajo" del inventario nunca se activa porque el mínimo queda en 0.
- **Precio neto** en los formularios de producto. Listas de precios ya tiene el interruptor Neto/Bruto,
  pero hecho a mano dentro de esa página.
- **Lista base duplicada:** Listas de precios tiene un modo "lista base" que edita el precio de todos los
  productos, lo mismo que hace el formulario de producto, en otro lugar y con otra forma.
- **Compras:** busca solo por nombre o SKU (no por código de barras) y, si el producto no existe, hay que
  salir a Productos, crearlo y volver (se pierde lo que se llevaba escrito).
- **Caja:** solo conoce ventas. No hay cómo anotar que entró plata que no es venta (un pago de deuda) ni
  que salió (pagar un flete desde el cajón), así que el arqueo nunca cuadra ese día.
- **Clientes:** la lista de precios de un cliente se asigna solo desde Listas de precios, no desde su ficha.
- **Configuración → General** mezcla preferencias del negocio (control de caja, vista de variantes,
  formato de impresión) sin un lugar pensado para ellas.
- **Marcas** ocupa una entrada del menú para algo que ya se crea desde el formulario de producto.
- **Menú:** 13 entradas en 5 grupos con nombres técnicos ("Entidades", "Auditoría", "Terminal SaaS global").

---

## 3. Propuesta

### 3.1 Un solo patrón: lista + ficha

Todas las pantallas de administración funcionan igual:

1. **Lista** a pantalla completa: buscador arriba, filtros rápidos como botones ("Stock bajo", "Con deuda",
   "Hoy"), botón "Nuevo" a la derecha. Clic en una fila abre la ficha.
2. **Ficha** en un panel lateral (`Sheet`, `frontend/components/ui/sheet.tsx`, ya instalado) con pestañas.
   La primera pestaña siempre es **Datos** y se edita ahí mismo; las demás muestran la historia de esa cosa.
   "Nuevo" abre la misma ficha vacía. Se cierra con Esc o la X, y la lista queda donde estaba.

| Cosa | Pestañas de la ficha |
|---|---|
| Producto | Datos · Variantes · Stock (kardex) · Precios (su precio en cada lista) |
| Cliente | Datos · Cuenta (saldo, ventas a crédito, pagos) · Compras que hizo |
| Proveedor | Datos · Compras |
| Venta | Detalle · Documento (reimprimir, NC) |
| Compra | Detalle (anular) |

Reemplaza la mezcla actual de asistente, diálogos y pestañas por página. Un componente `Ficha` (Sheet +
Tabs) y un `Lista` (sobre `ListToolbar` y `Table`, que ya existen) sirven para todas.

### 3.2 Menú (aprobado)

| Grupo | Entradas | Cambio |
|---|---|---|
| Vender | Punto de venta, Caja, Ventas | "Historial" pasa a llamarse Ventas |
| Productos | Productos, Compras, Listas de precios | Marcas sale del menú (pestaña dentro de Productos) |
| Clientes y proveedores | Clientes, Proveedores | |
| Reportes | Resumen (dashboard), Reportes | |
| Ajustes | Configuración, Personal | Personal deja "Entidades"; SaaS global queda solo para superusuario |

Mismos permisos (`permissionKey`) que hoy: solo cambian etiquetas y agrupación en `Sidebar.tsx`
(`MobileNav.tsx` es una barra fija de 5 accesos y ya dice "Ventas"; no cambia).

La página Productos tiene tres pestañas arriba: **Productos · Movimientos · Marcas**. Movimientos es el
kardex de todo el negocio por día ("¿qué se ajustó hoy y quién?").

### 3.3 Configuración → Mi negocio (decidido)

La pestaña General pasa a llamarse **Mi negocio** y reúne las decisiones de cada cliente, agrupadas por
tema, cada una con una frase que explica qué cambia:

| Sección | Opción | Valores | Por defecto |
|---|---|---|---|
| Precios | Cómo escribo los precios | Con IVA / Neto | Con IVA |
| Costos | Cómo calculo el costo | Última compra / Costo promedio | Última compra |
| Caja | Control de caja | Encendido / Apagado | Ya existe |
| Punto de venta | Vista de variantes | Ya existe (hoy en el navegador; se queda así) | |
| Impresión | Formato por tipo de documento | Ya existe | |

Se guardan por empresa en `SystemSettings` (`backend/app/models/settings.py`), como `control_caja`.
Impuestos y Folios siguen como pestañas propias.

### 3.4 Precios con IVA o neto (decidido)

Un componente `PrecioInput` con interruptor **Con IVA / Neto** al lado. Arranca en lo que dice Mi negocio
y el usuario lo puede cambiar en el momento; debajo muestra el otro valor ("Neto $8.403" o "Con IVA
$10.000"). Siempre se guarda el neto, como hoy. Usa la tasa del impuesto del producto (exento = igual en
los dos). Se usa en la ficha de producto, en variantes y en Listas de precios (reemplaza su interruptor
hecho a mano).

### 3.5 Costo: última compra o promedio (decidido: lo elige el cliente)

- **Última compra** (hoy): el costo es el precio de la última compra.
- **Costo promedio**: al comprar, `costo = (stock_antes × costo_antes + cantidad × costo_compra) /
  (stock_antes + cantidad)`. Si el stock anterior es 0 o negativo, el costo es el de la compra.
- Cambiar de método rige desde ese momento; no recalcula el pasado.
- Borrar una compra no devuelve el costo anterior (el promedio no se puede deshacer exacto). La ficha lo
  advierte al anular.
- **Requisito previo (D9):** cada línea de venta guarda el costo del momento (`SaleDetail.costo_unitario`)
  y los reportes usan ese. Sin esto, cualquiera de los dos métodos reescribe la utilidad pasada.

### 3.6 Productos

- **Datos, a la vista:** nombre, precio (`PrecioInput`), código de barras (acepta el lector), controla
  stock. **Más opciones** (cerrado): SKU, marca, impuesto, descripción, stock mínimo, unidad, costo.
- **Variantes:** interruptor "Tiene variantes (talla, color...)". Encendido, aparece una tabla corta:
  nombre, precio, código de barras, stock. Se agregan y quitan filas también después de creado. Quitar una
  variante con ventas la desactiva.
- **Stock no es un campo.** La pestaña Stock muestra la cantidad, el botón **Ajustar stock** (pregunta
  "¿Cuántas hay ahora?" y el motivo: Conteo, Merma o pérdida, Stock inicial, Otro; el sistema calcula la
  diferencia) y la lista de movimientos (fecha, motivo, entra, sale, saldo, documento, quién).
- **Lista:** fila expandible con el stock por variante; filtros "Stock bajo" y "Sin stock"; modo
  **Editar precios** que vuelve editable la columna de precio para cambiar varios de una vez.
- **Listas de precios** pierde el modo "lista base": el precio base se edita en Productos. Queda solo
  para listas especiales (mayoristas, etc.), y la pestaña Precios de cada producto muestra su precio en
  cada lista.

### 3.7 Caja con movimientos (decidido: el pago en efectivo entra a la caja)

- Tabla `cash_movements` (turno, tipo INGRESO | RETIRO, monto, motivo, usuario, fecha).
- En la página Caja, con turno abierto: botones **Entró dinero** y **Salió dinero** (monto y motivo).
- El pago de deuda en efectivo crea un INGRESO en el turno abierto. Si el control de caja está apagado,
  no crea nada.
- El cierre calcula: `inicial + ventas en efectivo - vuelto - devoluciones en efectivo + ingresos -
  retiros` (corrige D8).

### 3.8 Clientes: cuenta corriente

- Columna **Saldo** en la lista (solo si es distinto de 0) y filtro "Con deuda".
- Pestaña Cuenta: saldo, ventas a crédito, pagos, y botón **Registrar pago** (monto, medio, nota). No
  se puede pagar más que la deuda.
- La lista de precios del cliente se elige en su ficha. Eliminar = desactivar.

### 3.9 Compras

- La lista de compras es la página; **Nueva compra** abre una página propia (`/compras/nueva`), porque una
  factura de 30 líneas no cabe en un panel.
- Busca por nombre, SKU o código de barras (lector). Si no existe: **Crear producto** abre la ficha de
  producto encima, sin perder la compra.
- Anular una compra desde su ficha (el borrado actual, con la advertencia del costo promedio).

---

## 4. Tareas

Una tarea = un commit verificado, suite verde (`cd backend && pytest -q`, `cd frontend && npx tsc --noEmit
&& npm run build`). Backend antes que frontend en cada fase. Migraciones que recorren esquemas (patrón
`c9d0e1f2a3b4`), columnas JSON con `sa.JSON`.

### Fase 0: defectos

- [ ] **A1** D1 y D2: "Sin marca" manda `null`; quitar la opción "Sin impuesto (0%)" (el exento se elige
      como impuesto). `ProductEditDialog.tsx`. XS
- [ ] **A2** D4: `delete_customer` desactiva y `GET /customers` filtra activos. Test: borrar un cliente con
      ventas responde 204 y las ventas siguen. S
- [ ] **A3** D5: `GET /sales` acepta `desde`/`hasta` y `q` (folio o cliente); Historial filtra por día (hoy
      por defecto) en vez de las últimas 50. Test. S
- [ ] **A4** D7: borrar `updatePurchase` de `services/purchases.ts`. XS
- [ ] **A5** D8: el cierre de caja resta las devoluciones en efectivo. Test: abrir con 10.000, vender
      5.000 en efectivo, devolver 2.000 en efectivo, el sistema espera 13.000. S
- [ ] **A6** D9: columna `SaleDetail.costo_unitario` (migración; las ventas existentes toman el costo
      actual del producto), se llena al vender y `stats.py` la usa. Test: cambiar el costo después de
      vender no cambia la utilidad. S

### Fase 1: kardex correcto (backend)

- [ ] **K1** Función única `mover_stock(db, producto, cantidad, motivo, user_id, sale_id=None,
      purchase_id=None, glosa)` en `backend/app/services/`: cambia `stock_actual`, escribe `balance_after`
      y crea el `StockMovement`. Ventas, NC y compras la usan. Test: tras vender, devolver, comprar y
      borrar la compra, `stock_actual` = suma de movimientos y cada `balance_after` es el saldo corrido. M
- [ ] **K2** Columna `purchase_id` en `stock_movements` (migración) para enlazar el documento. S
- [ ] **K3** `PUT /products/{id}` rechaza `stock_actual` (422). `POST /products/{id}/ajuste-stock
      {cantidad_contada, motivo, nota}` anota AJUSTE o INICIAL. Crear con stock > 0 anota INICIAL. Tests. S
- [ ] **K4** `GET /products/{id}/movimientos` y `GET /inventory/movimientos?fecha&motivo` (todo el
      negocio), más nuevo primero, con folio y usuario. Tests. S
- [ ] **K5** Cuadratura de lo existente: migración de datos que anota un AJUSTE "Saldo al activar el
      kardex" por la diferencia entre `stock_actual` y la suma de movimientos. Probar en una copia de la
      base del piloto. S

→ *Checkpoint 1:* suite verde; en la base de desarrollo todo producto cuadra (consulta SQL de control).

### Fase 2: Mi negocio, precios y costos

- [ ] **N1** `SystemSettings`: `precios_con_iva` (bool, true) y `metodo_costo` (`ULTIMO` | `PROMEDIO`,
      `ULTIMO`), migración y endpoint de config existente. S
- [ ] **N2** Costo promedio en `create_purchase` según `metodo_costo`. Test con montos a mano (stock 0,
      stock positivo, stock negativo). S
- [ ] **N3** Configuración: pestaña General → **Mi negocio** con las secciones de 3.3. S
- [ ] **N4** `PrecioInput` (3.4) con test del cálculo neto ↔ con IVA usando `frontend/lib/taxes.ts`
      (redondeo a peso, exento). Listas de precios lo adopta. S

### Fase 3: patrón lista + ficha y productos

- [ ] **F1** Componentes `Ficha` (Sheet + Tabs) y ajustes a `ListToolbar` para filtros rápidos. Se prueban
      primero con Marcas (lo más chico). S
- [ ] **P1** Backend de variantes editables: `POST /products/{id}/variants` (agrega a un padre o
      convierte un simple sin ventas ni stock en padre) y desactivar variante. Tests. M
- [ ] **P2** Ficha de producto (3.6: Datos, Variantes, Stock, Precios) con React Hook Form + Zod. Borra
      `ProductWizard.tsx` y `ProductEditDialog.tsx`. M
- [ ] **P3** Lista de productos: fila expandible, filtros, modo Editar precios, pestañas Productos ·
      Movimientos · Marcas (`/marcas` redirige). M
- [ ] **P4** Listas de precios sin "lista base". S

→ *Checkpoint 2:* crear, editar, agregar variante, ajustar stock y cambiar precios en bloque desde el
navegador; revisión `code-review-and-quality`.

### Fase 4: caja, clientes, proveedores, compras y ventas

- [ ] **J1** `cash_movements` + endpoints de ingreso/retiro + cierre con la fórmula de 3.7. Tests. M
- [ ] **J2** Caja: botones Entró dinero / Salió dinero y movimientos del turno. S
- [ ] **C1** `customer_payments` (migración), `POST /customers/{rut}/pagos` (baja `current_balance`; si es
      efectivo y hay control de caja, crea el INGRESO), `GET /customers/{rut}/cuenta`. Tests. M
- [ ] **C2** Clientes y Proveedores en lista + ficha (3.1, 3.8). S
- [ ] **V1** Compras: lista + ficha, `/compras/nueva` con lector y "Crear producto" (3.9). M
- [ ] **V2** Ventas (ex Historial): lista + ficha con reimprimir y NC. S

### Fase 5: menú

- [ ] **M1** Menú de 3.2 en `Sidebar.tsx`; títulos de página que coincidan. XS

→ *Checkpoint final:* recorrido completo en el navegador (tema claro y oscuro, ancho de celular);
revisión con el usuario antes del piloto.

## 5. Skills por fase

| Skill | Dónde |
|---|---|
| `test-driven-development` | A5, A6, K1-K5, N2, N4, P1, J1, C1: test rojo con montos y stock a mano |
| `incremental-implementation` | Una tarea = un commit con la suite verde |
| `frontend-ui-engineering` | F1 en adelante: accesible, letra mínima 12 px, sin toasts, sin `<select>` nativo |
| `code-simplification` | P2 y P3: al fusionar formularios y borrar la lista base |
| `code-review-and-quality` | En cada checkpoint |

## 6. Decisiones (2026-09-25)

1. **Precio:** interruptor Con IVA / Neto en el formulario; el valor por defecto lo elige cada negocio en
   Mi negocio (Con IVA si no elige). Se guarda siempre el neto.
2. **Pago de deuda en efectivo:** entra a la caja del turno abierto si el control de caja está encendido.
3. **Costo:** lo elige cada negocio (última compra o promedio) en una pestaña de Configuración para las
   decisiones del cliente (Mi negocio).
4. **Menú:** aprobada la agrupación de 3.2 y sacar Marcas del menú.

### Por confirmar (propuestas nuevas de esta versión)

- Patrón lista + ficha lateral en todas las pantallas (3.1).
- Quitar "lista base" de Listas de precios y editar precios en bloque desde Productos (3.6).
- Movimientos de caja: Entró dinero / Salió dinero (3.7).
- Nueva compra como página propia (3.9).

Fuera de alcance: el POS; autocompletar por RUT tiene su plan en
[`autocompletar_rut_sii.md`](autocompletar_rut_sii.md).
