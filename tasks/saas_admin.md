# Plan: administración de Factureando (saas-admin)

Fecha: 2026-09-30. Sale de `lanzamiento.md` ("Administración del negocio de Factureando") y del pedido de
renovar el saas-admin. **No bloquea el piloto** (JCB no paga); sí la venta al primer cliente externo.

**Criterio:** el superusuario (el dueño de Factureando) abre una sola pantalla y sabe tres cosas: quién
debe plata, qué empresa tiene un problema (folios, certificado, rechazos) y qué hacer con eso. Lo demás
(crear empresa, usuarios, datos del SII) vive en la ficha de cada empresa.

> **Estado (2026-09-30): hecho en la rama `feat/saas-admin`** (una sola rama, pedido del usuario), salvo
> F1 (factura automática, bloqueada por la empresa propia) y S10 (correo: por ahora solo aviso en
> pantalla). Decisiones del usuario en la sección 6. Lo construido difiere del plan en:
> - La suscripción vive en `tenants` (`plan_id`, `suscripcion_vence`, `prorroga_hasta`), sin tabla
>   `suscripciones` aparte: una fila por empresa ya es la empresa.
> - Nuevo estado **Prórroga** y equipo con **cargos** (sección 2.9), pedidos en la revisión.
> - "Usuarios globales" no existe como página: los usuarios de empresa van en su ficha y el equipo de
>   Factureando en **Equipo**. El cambio de contraseña ya existía en el editor de usuario.

---

## 1. Qué hay hoy

| Pieza | Estado |
|---|---|
| `/saas-admin` | Portada con dos tarjetas: "Empresas" y "Usuarios globales" (esta dice "Próximamente") |
| `/saas-admin/tenants` (577 líneas) | Tabla de empresas + diálogo grande de crear/editar con datos del SII |
| `/saas-admin/tenants/[id]` (493 líneas) | Usuarios de la empresa + diálogo "Ajustar cupos" |
| `routers/saas.py` | CRUD de empresas y de sus usuarios, búsqueda de ACTECO, desactivar empresa |
| `inject-system-user` y `inject-system-users-all` | Mantenimiento de una sola vez (empresas creadas antes del usuario de soporte). Sin pantalla |
| `SaaSPlan` | Tabla con `price_monthly` y `max_users`; sin pantalla ni endpoint. Solo se lee el límite de usuarios |
| `Tenant.billing_day` | Se guarda, nadie lo usa |
| Empresa desactivada | `dependencies/tenant.py` ya la deja fuera (no entra nadie) |
| dte-torn | Ya expone lo que el panel necesita: `GET /folios` (stock y `umbral_alerta`), `GET /certificates/actual` (`dias_restantes`), `GET /documents` |

**Falta todo lo de negocio:** suscripción, vencimiento, pagos, pasarela, cobranza, factura a los
clientes, y una vista de salud de las empresas.

---

## 2. Propuesta

### 2.1 Navegación (simplificar)

Se borra la portada de tarjetas. `/saas-admin` pasa a ser el **Resumen**, con un menú lateral corto:

| Entrada | Qué muestra |
|---|---|
| **Resumen** | Ingreso del mes, empresas activas, por vencer (7 días), vencidas; lista "Requiere atención" |
| **Empresas** | Lista + ficha (patrón de `administracion.md` 3.1) |
| **Pagos** | Todos los pagos (pasarela y manuales), filtro por mes y estado |
| **Planes** | Mensual, Pack 6, Pack 12 (precio, meses, descuento, impresora incluida) |

"Usuarios globales" no se construye como página: lo que hace falta (reiniciar contraseña, desactivar)
va en la pestaña Usuarios de cada empresa.

### 2.2 Ficha de empresa

| Pestaña | Contenido |
|---|---|
| **Datos** | RUT, razón social, giro, dirección, ACTECO (lo que hoy está en el diálogo grande) |
| **Suscripción** | Plan, fecha de inicio, vence el, estado, historial de pagos, botones **Registrar pago** y **Link de pago** |
| **SII** | Ambiente, resolución, oficina; certificado (vence en N días) y folios por tipo, leídos de dte-torn |
| **Usuarios** | Lo que hoy es `/tenants/[id]`, + reiniciar contraseña; cupos adentro, sin diálogo aparte |

"Entrar como esta empresa" queda como botón en la cabecera de la ficha (hoy se hace desde
`select-tenant`).

### 2.3 Suscripciones (modelo)

- `SaaSPlan` se reutiliza: se agregan `meses` (1, 6, 12) y `incluye_impresora` (texto: "57 mm", "80 mm",
  vacío). El precio se guarda **con IVA** (el que se publica: $33.333), en pesos enteros.
- Tabla nueva `public.suscripciones`: `tenant_id`, `plan_id`, `inicio`, `vence`, `estado`.
  **Una fila por empresa** (la vigente); la historia está en los pagos. `Tenant.billing_day` se borra.
- Tabla nueva `public.pagos`: `tenant_id`, `plan_id`, `monto`, `medio` (PASARELA | TRANSFERENCIA |
  EFECTIVO | CORTESIA), `estado` (PENDIENTE | PAGADO | FALLIDO | ANULADO), `referencia_pasarela`,
  `periodo_desde`, `periodo_hasta`, `folio_factura`, `creado_por`, fechas.
- **Un pago PAGADO extiende `vence`** en los meses del plan, contados desde el `vence` anterior (o desde
  hoy si ya venció). Una sola función lo hace, la usan el pago manual y el webhook.
- **Estado derivado de la fecha**, no guardado a mano: AL_DIA, POR_VENCER (7 días o menos), EN_GRACIA
  (vencida hace N días o menos), SUSPENDIDA. JCB y empresas de prueba: plan CORTESIA sin vencimiento.

### 2.4 Cobranza (qué pasa si no paga)

Propuesta (decisión pendiente, ver 6):

1. **7 días antes:** aviso en la barra superior del sistema de la empresa (solo lo ve el administrador).
   Correo: después, con el correo del dominio.
2. **Vencida, días 1 a 5 (gracia):** aviso, todo funciona.
2b. **Prórroga (decidido):** a una empresa ya suspendida el superusuario le da horas extra desde su ficha.
   Por defecto 12 (se cambia en Planes > Reglas de cobranza) y en cada prórroga se puede poner más o
   menos. Pagar la quita.
3. **Suspendida:** **solo lectura**. Puede ver ventas, reimprimir y descargar sus documentos, pero no
   emitir. Nunca se le bloquea el acceso a sus datos tributarios. Se implementa en un solo lugar
   (`dependencies/tenant.py`): `get_tenant_db` rechaza con 402 todo método que escribe. Pagar va por
   `/suscripcion`, que no usa esa sesión. El equipo de Factureando pasa (soporte).
5. Días de aviso, de gracia y horas de prórroga: tabla `saas_ajustes`, editable en Planes.
4. Pagar desde el aviso (link de pasarela) reactiva al instante.

### 2.5 Pasarela de pago

Requisitos: 12 cuotas sin interés en los packs (comisión absorbida por el precio), link de pago por
monto (no hace falta cobro recurrente automático al principio), webhook con firma, ambiente de pruebas,
liquidación en cuenta chilena.

- **Decidido (G0): Flow** (flow.cl). API simple firmada con HMAC-SHA256, confirmación por token +
  `payment/getStatus` (no hay que confiar en el webhook), sandbox propio, 2 a 12 cuotas sin interés.
  Documentación: https://developers.flow.cl/api. Las cuotas sin interés se activan en el panel de Flow
  (no por la API): quedan para toda la cuenta, también en el plan mensual.
- **Comisión (decidido):** en los packs de 6 y 12 meses la paga Factureando (`cuotas_sin_interes` del plan).
- **Una sola pasarela, sin capa de abstracción:** `services/flow.py` (`crear_orden`, `estado_orden`).
  Webhook `POST /pagos/flow/confirmacion`, retorno `/pagos/flow/retorno` que lleva a `/pago-resultado`.
  Variables: `TORN_FLOW_API_KEY`, `TORN_FLOW_SECRET_KEY`, `TORN_FLOW_URL`, `TORN_PUBLIC_API_URL`,
  `TORN_PUBLIC_APP_URL`. Sin ellas el botón Pagar explica que se pida el link a Factureando.
- **Flujo:** se crea un `pago` PENDIENTE → la pasarela devuelve la URL → el cliente paga → el webhook
  confirma **consultando el estado a la pasarela** (nunca se confía en el cuerpo del webhook solo) → el
  pago pasa a PAGADO y extiende la suscripción. Idempotente: la misma notificación dos veces no extiende
  dos veces.
- Mientras no esté la pasarela, **Registrar pago manual** (transferencia) cubre todo el flujo.

### 2.6 Factura de Factureando a sus clientes

Factureando es una empresa más dentro de Torn. Al quedar PAGADO un pago, el backend emite una factura
(33) o boleta (39) desde la empresa de Factureando hacia el RUT del cliente, por dte-torn, y guarda el
folio en el pago. Depende de que exista la empresa propia (`lanzamiento.md`). Mientras no exista, el pago
queda con `folio_factura` vacío y se emite a mano.

### 2.7 Salud de las empresas ("Requiere atención" en el Resumen)

Una fila por problema, con enlace a la ficha, en tres niveles (Urgente, Revisar, Para saber).
`services/salud_empresas.py`:

| Urgente | Revisar | Para saber |
|---|---|---|
| Suspendida | Vencida en gracia, con prórroga, sin primer pago | Por vencer |
| Sin certificado, certificado vencido (no emite) | Certificado vence en 30 días o menos | Sin usuarios activos |
| Sin CAF cargados, sin folios de un tipo, folios vencidos | Folios bajo el umbral, CAF vence en 15 días | Folios por anular en el SII |
| | Documentos rechazados, sin respuesta del SII hace más de 2 días | En producción sin ventas hace 7+ días |
| | dte-torn no responde | En certificación o desarrollador hace 30+ días |

Las empresas en modo Desarrollador no se revisan por certificado ni folios.

Se calcula al abrir el Resumen, empresa por empresa. `ponytail:` N llamadas a dte-torn por carga; si
pasan de ~50 empresas, cachear el resultado unos minutos.

### 2.8 Lo que se borra

- Portada de tarjetas y tarjeta "Usuarios globales".
- `inject-system-user` e `inject-system-users-all`: borrados; la migración `b1c2d3e4f5a6` deja el usuario
  de soporte en las empresas que no lo tenían (las nuevas ya nacen con él).
- `Tenant.billing_day` (lo reemplaza `Tenant.suscripcion_vence`).

### 2.9 Equipo de Factureando (decidido)

El dueño (superusuario sin cargo) crea **cargos** con permisos y **superusuarios** con un cargo. Solo el
dueño entra a Equipo; nadie toca al dueño. Permisos (`dependencies/saas.PERMISOS`): ver empresas, editarlas,
datos del SII, usuarios de empresas, entrar a una empresa, ver pagos, registrar y anular pagos, dar
prórroga, editar planes. Desactivar a alguien corta su sesión al instante (`get_current_global_user`).
- Diálogo "Ajustar cupos" (pasa a la pestaña Usuarios).

---

## 3. Tareas

Una tarea = una rama, suite verde (`cd backend && pytest -q`, `cd frontend && npx tsc --noEmit && npm
run build`), entrada en `checklist.md`. Tablas de `public` con migración Alembic propia (no recorren
esquemas). Montos en pesos enteros.

### Fase 0: limpiar

- [x] **S0** Verificar que todas las empresas en producción/piloto tienen usuario de soporte; borrar los
      dos endpoints `inject-*`. Test existente de creación de empresa sigue verde. XS

### Fase 1: suscripciones y pagos manuales (sin pasarela)

- [x] **S1** Migración: `saas_plans.meses`, `saas_plans.incluye_impresora`; tablas `suscripciones` y
      `pagos`; seed de los 3 planes y CORTESIA; cada empresa existente recibe CORTESIA; borrar
      `billing_day`. S
- [x] **S2** `services/suscripciones.py`: `estado(suscripcion, hoy)` y `aplicar_pago(pago)`.
      TDD con fechas a mano: renovar antes de vencer, después de vencer, pack 12, pago repetido. S
- [x] **S3** Endpoints: `GET/PUT /saas/plans`, `GET /saas/tenants/{id}/suscripcion`,
      `POST /saas/tenants/{id}/pagos` (manual), `GET /saas/pagos?mes&estado`, `POST /saas/pagos/{id}/anular`.
      Solo superusuario. Tests. M

→ *Checkpoint 1:* registrar un pago de transferencia desde la API extiende el vencimiento.

### Fase 2: nuevo saas-admin

- [x] **S4** Layout del saas-admin (menú de 2.1) y `/saas-admin` = Resumen con los contadores de
      suscripción (sin salud todavía). Borra la portada. S
- [x] **S5** Empresas en lista + ficha: pestañas Datos y SII (mueve el diálogo grande). Columna de
      estado de suscripción y filtros rápidos (Por vencer, Suspendidas). M
- [x] **S6** Pestaña Usuarios (mueve `/tenants/[id]`) + `POST /saas/users/{id}/reset-password`
      (contraseña temporal que se muestra una vez). Borra `/tenants/[id]`. M
- [x] **S7** Pestaña Suscripción + páginas Pagos y Planes. S

→ *Checkpoint 2:* recorrido en navegador (claro, oscuro, celular); `code-review-and-quality`; revisión
del usuario.

### Fase 3: cobranza

- [x] **S8** Bloqueo de solo lectura en `dependencies/tenant.py` según `estado` (402 en escrituras,
      lista de excepciones). Tests: suspendida puede listar ventas y descargar PDF, no puede vender;
      CORTESIA nunca se suspende. S
- [x] **S9** Aviso en la app de la empresa (por vencer / en gracia / suspendida) con `avisar()` de
      `uiStore`, solo para el administrador. S
- [ ] **S10** Correo de aviso 7 días antes y al suspender. Depende de dónde vive el correo (ver 6). S

### Fase 4: pasarela

- [x] **G0** Investigación de pasarelas (2.5) → decisión escrita en este archivo. Sin código.
- [x] **G1** `services/pasarela.py` + `POST /saas/tenants/{id}/link-pago` + webhook
      `POST /pagos/notificacion` (público, verificado contra la pasarela, idempotente). Tests con la
      pasarela sustituida por un fake, como `FakeDte`. M
- [x] **G2** Botón **Pagar** en el aviso de la empresa (S9) y **Link de pago** en la ficha (copiar /
      enviar por correo). S
- [ ] **G3** Prueba de punta a punta en el sandbox de la pasarela: pagar en cuotas, reactivar una
      empresa suspendida. Revisión con `security-and-hardening`. S **Pendiente: faltan credenciales
      de sandbox de Flow.** Hoy lo cubren los tests con un Flow falso (`test_saas_admin.py`).

→ *Checkpoint 3:* un cliente suspendido paga con tarjeta de prueba y vuelve a vender sin intervención.

### Fase 5: salud y factura

- [x] **H1** "Requiere atención" (2.7) en el Resumen y en la pestaña SII. S
- [ ] **F1** Factura automática al quedar PAGADO (2.6). Bloqueada hasta tener la empresa propia. M

### Después (fuera de este plan)

- Alta guiada de empresa nueva (certificado, CAF, primer usuario) sobre la ficha de S5: `lanzamiento.md`,
  junto con el autocompletado por RUT (#50).
- Cobro automático recurrente con tarjeta guardada: solo si la cobranza manual por link se vuelve pesada.
- Bitácora de acciones del superusuario: cuando haya más de una persona administrando.

---

## 4. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Webhook falsificado reactiva una empresa sin pagar | Alto | Confirmar siempre consultando a la pasarela; idempotencia por `referencia_pasarela` única |
| Suspender bloquea datos tributarios que el cliente está obligado a conservar | Alto | Solo lectura, nunca sin acceso; descarga de XML/PDF siempre permitida |
| Suspensión por error (fecha mal cargada) en pleno horario de venta | Alto | Gracia de N días + CORTESIA para JCB; test de fechas en S2 |
| La pasarela exige empresa constituida | Medio | G0 lo averigua primero; mientras, pago manual |
| Resumen lento con muchas empresas (dte-torn por empresa) | Bajo | Anotado con `ponytail:`; cache si pasa de ~50 |

## 5. Skills por fase

| Skill | Dónde |
|---|---|
| `planning-and-task-breakdown` | Este plan |
| `test-driven-development` | S2, S3, S8, G1 (fechas y montos a mano) |
| `api-and-interface-design` | S3, G1 (contrato de planes, pagos y webhook) |
| `deprecation-and-migration` | S0, S1 (`inject-*`, `billing_day`) |
| `frontend-ui-engineering` + `ui-ux-pro-max` | S4 a S7, S9 (sin toasts, sin `<select>` nativo) |
| `code-simplification` | S5, S6 (fusionar las dos páginas de 1.070 líneas) |
| `source-driven-development` | G0, G1 (documentación oficial de la pasarela) |
| `security-and-hardening` | G1, G3 (webhook público, endpoints de superusuario) |
| `code-review-and-quality` | En cada checkpoint |

## 6. Decisiones (2026-09-30)

1. **Días de gracia:** 5, editable en Planes > Reglas de cobranza.
2. **Suspendida = solo lectura** (sí).
3. **Prórroga** para suspendidas: 12 horas por defecto, editable, y se ajusta en cada prórroga.
4. **Correo de aviso:** solo en pantalla hasta tener el correo del dominio (sí).
5. **Pasarela:** Flow. **Comisión de los packs la paga Factureando.**
6. **Equipo:** el dueño crea superusuarios y cargos con permisos.

### Por confirmar

- Las cuotas sin interés de Flow son de toda la cuenta: el plan mensual también las tendría. ¿Se acepta,
  o el mensual solo por transferencia?
- **Sucursal adicional** (idea: mitad del plan): fuera de v1, sin modelo todavía.
