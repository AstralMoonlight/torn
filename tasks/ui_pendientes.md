# Pendientes de UI/UX (fuera del POS)

Surgen de la revisión de uniformidad del 2026-09-25 (rama `feat/ui-uniformidad`,
ya mergeada). Lo hecho en esa rama: estilos de tabla centralizados, `TableEmpty`,
`SearchInput`, `ConfirmDialog`, pestañas y espaciado de botones iguales.

## Funcionalidad

- [ ] **Opción "Control de caja" en Configuración.** Hay negocios que no usan
  turnos de caja. Si la opción está apagada: se oculta Caja del menú y el POS
  vende sin pedir que se abra caja.
  - Guardarla por empresa en el backend, no en `uiStore` (hoy ahí vive
    `posVariantDisplay`, que es solo del navegador): una columna nueva en
    `SystemSettings` (`backend/app/models/settings.py`), encendida por defecto,
    con migración Alembic que recorra los esquemas (patrón `c9d0e1f2a3b4`).
  - **Backend**: `create_sale` (`backend/app/routers/sales.py`, paso "0. Validar
    Caja Abierta") devuelve 409 si no hay turno. Con el control apagado no debe
    exigirlo; si no, ocultarlo en el frontend no sirve de nada.
  - **Frontend**:
    - `app/pos/page.tsx`: saltarse la pantalla "Caja cerrada" (`sessionStatus !== 'OPEN'`);
    - `components/layout/Sidebar.tsx`: ocultar el ítem `/caja`;
    - `app/configuracion/page.tsx`: agregar el interruptor (`Switch`).
  - **Por decidir**:
    - ¿qué pasa con `/caja` si alguien entra por URL?
    - ¿qué pasa si se apaga el control con turnos abiertos?
    - ¿los reportes que dependen del arqueo siguen teniendo sentido?

    Las ventas no guardan el id del turno, así que venderían igual.
  - Tests: una venta sin turno pasa con el control apagado y sigue dando 409 con
    el control encendido.

- [ ] **Configuración > General se guarda sola al elegir cada opción.** Hoy el
  botón "Guardar Cambios" queda al final de la tarjeta, la gente no lo ve y se
  va sin guardar. Además, en la misma tarjeta, "Vista del Terminal POS - Variantes" ya
  aplica al instante (va a `uiStore`) y los formatos de impresión no: dos
  comportamientos en la misma pantalla.
  - `app/configuracion/page.tsx`: que `setDocPrintFormat` llame a
    `updateSettings` enseguida y quitar el botón. `PUT /settings/`
    (`backend/app/routers/config.py`) ya actualiza solo los campos que llegan
    (`exclude_unset`), así que no hay que tocar el backend. Se puede seguir
    mandando el `print_formats` completo, como hace hoy `handleSaveSettings`.
  - `handleSaveSettings` también manda `iva_default_id`, pero en esta pestaña no
    hay dónde editarlo. Revisar si se puede dejar de mandar.
  - Feedback: una marca "Guardado" junto a la opción (sin toast, ver tarea de toasts). Si
    falla, volver a la opción anterior y mostrar el error.
  - Evitar que se pisen los cambios: si el usuario toca dos opciones seguidas,
    la segunda respuesta no debe revertir la primera. Mandar siempre el estado
    más reciente, o encolar los envíos.
  - Si se hace la tarea de "Control de caja", su interruptor debe guardarse
    igual, sin botón.
  - Aplicar la misma regla (guardado inmediato) a otros ajustes simples de
    Configuración. Los formularios con varios campos (emisor, impuestos nuevos)
    siguen con botón.

- [ ] **Eliminar el guion largo "—" de todo el proyecto.** Usar "-" normal o
  reescribir la frase (coma, dos puntos, paréntesis). Hay 106 usos en archivos
  versionados (`git grep -c "—"`):
  - texto que ve el usuario: `frontend/app` (13), `frontend/components` (7),
    `frontend/lib` (1) y las plantillas de impresión de `backend/app/templates/html/`
    (por ejemplo `customer.giro or '—'` como relleno de campo vacío, y el pie
    "Documento generado por Torn — ...");
  - comentarios y docstrings: `backend/`, `dte-torn/app`, `dte-torn/tests`;
  - documentación: `dte-torn/DESIGN.md` (19), `dte-torn/README.md`, `CLAUDE.md`,
    `tasks/*.md`, `.env.example`, `dte-torn/Dockerfile`.

  **Excepción:** `dte-torn/app/dte/builder.py:336` (`texto_sii`) convierte a propósito
  "—" en "-" antes de mandar el texto al SII, y `dte-torn/tests/test_builder.py`
  (líneas 299 y 310) lo prueba. Ahí el carácter no se borra: se escribe como
  `"—"` para que el código siga igual y el grep quede limpio.

  Para que no vuelva: agregar la regla a la sección 5 de `CLAUDE.md` y un paso
  en `.github/workflows/ci.yml` que falle si `git grep "—"` encuentra algo.
  Después de reemplazar, correr los tests de backend y de dte-torn y
  revisar en pantalla los textos del frontend.

- [ ] **Dejar de usar toasts; si hace falta un mensaje, usar `Alert` de shadcn.**
  Hoy conviven dos sistemas de toast, y los dos están montados:
  - **sonner**: `import { toast } from 'sonner'` en 28 archivos, unas 135 llamadas
    (`toast.success`/`toast.error`). `<Toaster>` en `app/layout.tsx`. Los que más
    tienen: `saas-admin/tenants/[id]` (12), `saas-admin/tenants` (11), `clientes`
    (11), `compras` (10), `caja` (10), `personal` (9). También
    `lib/store/cartStore.ts`, que es un store y no puede mostrar un Alert: tiene que
    devolver el error al componente.
  - **toast de shadcn/Radix**: solo en `app/configuracion/FoliosTab.tsx`
    (`useToast`). `<Toaster />` en `components/layout/AppShell.tsx`.

  `Alert` no está instalado (`components/ui/` solo tiene `alert-dialog.tsx`):
  agregarlo con `npx shadcn@latest add alert` (regla 2 de `CLAUDE.md`).

  Criterio para reemplazar cada llamada:
  - error al guardar en un diálogo o formulario: `Alert variant="destructive"`
    dentro del diálogo, sobre los botones, sin cerrarlo;
  - error al cargar una página: `Alert` arriba del contenido, con botón Reintentar;
  - éxito (creado, guardado, eliminado): casi siempre sobra, porque el resultado
    ya se ve (el diálogo se cierra y aparece la fila). Si hace falta, un Alert
    breve en la página o una marca junto al elemento;
  - avisos del POS (6 archivos en `app/pos` y `components/pos`, unas 18 llamadas):
    el POS ya está validado, así que confirmar con el usuario antes de tocarlo.

  Al terminar, desinstalar `sonner` y `@radix-ui/react-toast`, borrar
  `components/ui/toast.tsx`, `toaster.tsx` y `use-toast.ts`, y quitar los dos
  `<Toaster>`. Actualizar `CLAUDE.md`: sacar Sonner de la tabla del stack y
  agregar a la sección 5 la regla "no usar toasts; usar Alert".

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
  "Crea"). Revisar descripciones y mensajes (los que hoy son toasts pasan a Alert, ver tarea de toasts).
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
