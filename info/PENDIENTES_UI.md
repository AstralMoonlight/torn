# Pendientes de UI/UX (fuera del POS)

Surgen de la revisión de uniformidad del 2026-09-25 (rama `feat/ui-uniformidad`,
ya mergeada). Lo hecho en esa rama: estilos de tabla centralizados, `TableEmpty`,
`SearchInput`, `ConfirmDialog`, pestañas y espaciado de botones iguales.

## Prioridad alta

- [ ] **Puntero de mano en hover que no funciona bien.** `app/globals.css` pone
  `cursor: pointer` a `button`, `[role=button]`, `select`, `[role=combobox]` y
  `[role=option]`, pero en la práctica hay elementos clickeables que siguen con la flecha.
  Revisar:
  - que la regla le gane al preflight de Tailwind 4 (orden de `@layer base`);
  - elementos Radix que no son `button`: `DropdownMenuItem` (`role=menuitem`),
    `TabsTrigger` (`role=tab`), `Switch`/`Checkbox`, `SelectItem`;
  - `div`/`Card`/`TableRow` con `onClick` (tarjetas de módulos en `saas-admin`,
    filas clickeables, etc.);
  - que los deshabilitados muestren `not-allowed` y no la mano;
  - probarlo en la imagen Docker (`docker compose build frontend`): el
    contenedor no monta el código y puede estar mostrando un build viejo.
- [ ] **Gestión de Caja queda cargada a la izquierda.** `app/caja/page.tsx`: el
  `TabsContent` "gestion" tiene `max-w-2xl` sin `mx-auto`, así que queda pegado
  a la izquierda dentro del `PageContainer` (`max-w-4xl`). Centrarlo, o decidir
  un ancho único para la página y quitar el `max-w-2xl`.
- [ ] **Plantilla única para las vistas de listado** (Inventario/Productos,
  Marcas, Clientes, Proveedores, Historial, Personal, Listas de precios,
  Empresas). Hoy todas usan `SearchInput`, pero cada una lo pone con otro ancho
  y en otro lugar:
  - Clientes, Marcas, Proveedores: `max-w-sm`;
  - Inventario, Historial: ancho completo;
  - Personal (roles): `max-w-xs` y comparte fila con botones;
  - Empresas: dentro de una tarjeta, con contador "N de M empresas".

  Definir una barra de herramientas común (buscador + filtros + contador +
  acciones secundarias) con el mismo ancho, altura y posición, y usarla en
  todas. Conviene armarla como componente en `components/layout/` junto a
  `PageHeader`.

## Prioridad media

- [ ] **Acciones por fila**: Inventario usa un menú "⋯" (`DropdownMenu`) y las
  demás tablas usan íconos sueltos (lápiz/basurero) con colores de hover
  distintos. Elegir uno de los dos y aplicarlo en todas las tablas.
- [ ] **Mayúsculas en títulos y botones**: hay mezcla de "Title Case" ("Nuevo
  Cliente", "Panel de Control", "Historial de Ventas") y oración. En español
  corresponde oración: "Nuevo cliente", "Panel de control". Incluye el
  `Sidebar`, los `PageHeader`, los títulos de diálogo y los botones.
- [ ] **Voz de los textos**: unificar tuteo (la mayoría usa "Gestiona",
  "Crea"). Revisar descripciones y mensajes de toast.
- [ ] **saas-admin con su propio contenedor**: `app/saas-admin/**` usa
  `max-w-5xl p-6 md:p-12` y encabezados propios. Evaluar usar `PageContainer`
  y `PageHeader` (el de detalle de empresa necesita el enlace "Volver" y los
  datos del tenant, así que quizás `PageHeader` debería aceptar contenido
  extra).

## Prioridad baja

- [ ] **Tablas editables de variantes** en `components/inventory/ProductWizard.tsx`
  y `ProductEditDialog.tsx`: siguen siendo `<table>` a mano con letra de
  10–11 px. Pasarlas a `Table` con una variante compacta, sin perder densidad.
- [ ] **Formularios**: casi todos usan `useState` a mano, aunque React Hook Form,
  Zod y el `Form` de shadcn (`components/ui/form.tsx`) están instalados. Migrar
  empezando por los diálogos simples (Marca, Cliente, Proveedor) para tener
  validación y errores junto al campo iguales en todas partes.
- [ ] **Tamaños de letra menores a 12 px** (`text-[10px]`, `text-[11px]`)
  repartidos en páginas y diálogos: revisar si son necesarios, por legibilidad.
