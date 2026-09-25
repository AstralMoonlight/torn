# Alinear backend y frontend con dte-torn

Estado al 2026-09-25. La certificación de factura está cerrada del lado de Torn: todo declarado y
muestras enviadas, **esperando la validación del SII**.

**Orden (actualizado 2026-09-25 por el usuario):** primero las tres prioridades de la sección 0.
Después, sin orden fijo todavía: lo demás de este archivo, la certificación de boletas y
[autocompletar por RUT](autocompletar_rut_sii.md). Al final, seguridad → servidor y release.

---

## 0. Prioridades

### P1. Intercambio: XML a los clientes y acuse de recibo

Antes estaba fuera de esta etapa. No existe nada: no hay correo (ni SMTP ni IMAP) en el repo, ni
formatos de respuesta en dte-torn. Son dos partes:

**a) Enviar el XML a la casilla del cliente.** Cuando el SII acepta un 33, 34, 52, 56 o 61, se manda el
`EnvioDTE` (sobre dirigido al RUT del cliente) a su correo de intercambio. Las boletas no pasan por
intercambio. La venta registra si se envió y cuándo, y el historial permite reenviarlo.

**b) Recibir los DTE de proveedores y responder.** Una casilla recibe el `EnvioDTE` del proveedor.
Torn valida la firma y que el receptor seamos nosotros, guarda el documento y responde con el acuse
(`RespuestaDTE`: recepción del envío y resultado por documento). Si aplica, responde también con el
recibo de mercaderías (`EnvioRecibos`, Ley 19.983). Un documento recibido puede llenar una compra
(`backend/app/models/purchase.py`).

**Lo que dicen los documentos del SII (leídos el 2026-09-25):**

Fuentes: `formato_ic.pdf` (respuesta, 2005), `desc_19983.pdf` (recibo, 2005),
`GUIA_aceptacion_reclamo_dte.pdf` y `Webservice_Registro_Reclamo_DTE_V1.2.pdf` (2017), todos en
`sii.cl/factura_electronica/`. Los XSD están en `dte-torn/app/dte/xsd/intercambio/`: `RespuestaEnvioDTE_v10.xsd`
(de `schema_ic.zip`) y `EnvioRecibos_v10.xsd` + `Recibos_v10.xsd` (de `schema19983.zip`). `schema_ic.zip`
no trae `SiiTypes`; se usa el de `xsd/dte/`, que es más nuevo que el de `schema19983.zip` y compila con los tres.

- **Acuse del envío (`RespuestaDTE` con `RecepcionEnvio`)**: `formato_ic.pdf` dice que el receptor *debe*
  generarlo por cada envío recibido. Estados: 0 conforme, 1 error de schema, 2 error de firma, 3 RUT receptor
  no corresponde, 90 repetido, 91 ilegible, 99 otros.
- **Resultado por documento (`RespuestaDTE` con `ResultadoDTE`)**: opcional ("podrían"). 0 aceptado, 1
  aceptado con discrepancia, 2 rechazado.
- **Aceptar, reclamar y dar recibo de mercaderías con efecto legal: no va por XML.** Desde la Ley 20.956 se
  hace en el Registro de Aceptación o Reclamo del SII, dentro de 8 días corridos desde que el SII recibió la
  factura. Pasado el plazo, la factura queda aceptada y la mercadería recibida por presunción legal. Solo
  aplica a 33, 34 y 43. Acciones: `ACD` acepta contenido, `ERM` recibo de mercaderías, `RCD` reclamo al
  contenido, `RFP`/`RFT` falta parcial/total. Reclamar impide dar recibo después y al revés.
  Se puede automatizar con el web service SOAP `ingresarAceptacionReclamoDoc` (y `listarEventosHistDoc`
  para consultar), autenticado con el mismo token de certificado que ya usa dte-torn:
  CERT `ws2.sii.cl/WSREGISTRORECLAMODTECERT/registroreclamodteservice?wsdl`,
  PROD `ws1.sii.cl/WSREGISTRORECLAMODTE/registroreclamodteservice?wsdl`.
- **`EnvioRecibos` (Ley 19.983)** es el recibo en XML de antes de 2017. El recibo con efecto legal ahora
  es el `ERM` del registro, así que `EnvioRecibos` queda fuera salvo que un proveedor lo exija.
- **Como emisor**, el mismo web service deja consultar si el cliente aceptó o reclamó una factura nuestra.
  Si la reclama, hay que emitir una NC.

**Conclusión:** la parte b) se reduce a recibir y leer la casilla, responder el acuse del envío y
aceptar o reclamar por el web service del registro. El `ResultadoDTE` es opcional y `EnvioRecibos`
no se hace.

**Por decidir:**
- El correo de intercambio del cliente. `customers.email` existe, pero es uno solo. ¿Se usa ese, o un
  campo aparte? El SII publica un listado de contribuyentes electrónicos con su correo de intercambio.
  Hay que ver su formato y si se carga como las nóminas de [autocompletar por RUT](autocompletar_rut_sii.md).
- El servicio de correo, para enviar y recibir.
- El reparto entre servicios: el XML, la firma y el web service del registro en dte-torn, y los clientes,
  las compras y la UI en el backend.

**Tareas:**
- [x] Bajar del SII los XSD y el instructivo de intercambio (`RespuestaDTE`, `EnvioRecibos`), igual que se
      hizo con los libros (source-driven-development).
- [ ] Decidir el correo del cliente y el servicio de correo.
- [ ] dte-torn: sobre `EnvioDTE` para el receptor y su envío al correo tras la aceptación del SII, con reintentos.
- [ ] Backend y frontend: estado del envío en la venta y botón de reenviar en el historial.
- [ ] Recepción: leer la casilla, validar y guardar los documentos recibidos.
- [ ] Acuse del envío firmado (`RespuestaDTE` con `RecepcionEnvio`), validado contra el XSD, enviado al proveedor.
- [ ] dte-torn: cliente del web service del Registro de Aceptación o Reclamo (registrar y consultar eventos).
- [ ] Frontend: bandeja de documentos recibidos con aceptar / reclamar (va al registro) y el plazo de 8 días a la vista.

### P2. Modo del emisor: Desarrollador, CERT, PROD

Lo elige el superusuario en saas-admin (`frontend/app/saas-admin/tenants/page.tsx`), por empresa. **No va en
la Configuración ni en el POS de los clientes** (decidido el 2026-09-25). Hoy ahí mismo se edita
`public.tenants.sii_ambiente` (`CERT`|`PROD`), que se copia a dte-torn (`Tenant.ambiente`, enum `Ambiente`
en `dte-torn/app/models.py`).

- **CERT** (servidor maullín del SII) y **PROD** (servidor palena): los valores que ya existen. De PROD
  solo va la opción, con confirmación. El resto del paso a producción sigue postergado (ver B7 y B8).
- **Desarrollador** (nuevo): dte-torn no habla con el SII (ni token, ni envío, ni consulta), pero la venta
  se emite igual, con firma, timbre, XML y PDF. Queda en un estado propio, distinto de ACEPTADO. Sirve para
  pruebas internas.

**Decidido (2026-09-25):** cada venta guarda el modo con que se emitió, y los documentos solo se ven en
su modo. Los de Desarrollador aparecen solo en Desarrollador y no se mezclan con los de CERT. Lo
mismo vale entre CERT y PROD. No se borra nada: al volver al modo, siguen ahí.

**Por decidir:**
- Los folios en Desarrollador. El timbre necesita un CAF: ¿se usan los CAF de maullín, o un CAF de
  prueba que nunca vaya al SII?
- Qué más se separa por modo, aparte de historial y documentos. Una venta de prueba descuenta stock,
  registra kardex, entra a la caja y suma en los reportes y el dashboard. ¿Se separa todo eso, o solo se
  oculta el documento?

**Tareas:**
- [ ] dte-torn: tercer valor de `Ambiente` que corta el pipeline antes de enviar, con tests.
- [ ] Backend: `sii_ambiente` acepta el modo nuevo (migración Alembic) y lo copia a dte-torn.
- [ ] Backend: columna con el modo en `sales` (migración Alembic, que marca las ventas existentes como
      CERT). Historial, reimpresión y reportes filtran por el modo actual del tenant.
- [ ] dte-torn: `GET /documents` y `GET /folios` filtran por el ambiente del tenant.
- [ ] Frontend: el selector de ambiente de saas-admin pasa a tres opciones, con confirmación al pasar a
      PROD. Por decidir si el cliente ve algún aviso del modo (por ejemplo, un distintivo en el POS en
      Desarrollador) aunque no pueda cambiarlo.

### P3. Descuentos por ítem y global

Hoy el backend acepta un `descuento` por línea en pesos (`backend/app/schemas.py:307`, validado en
`backend/app/routers/sales.py:407`) y lo manda a dte-torn. Pero el POS no lo ofrece: no hay descuento en
`frontend/components/pos` ni en el carrito. El descuento global no existe en el backend, y dte-torn
acepta hasta 20 `descuentos_globales`. En los dos, dte-torn también acepta porcentaje (`descuento_pct`).

**Tareas:**
- [ ] Test de contrato de los totales (D12): los tres cálculos con los mismos casos, incluidos los
      descuentos. Va primero, porque los descuentos tocan los tres.
- [ ] POS: descuento por ítem en $ o %.
- [ ] Backend y POS: descuento global en $ o %, enviado como `descuentos_globales`.
- [ ] El impreso (carta, 57 y 80 mm) muestra los descuentos por línea y el global, como pidió el set de pruebas.
- [ ] Por decidir: quién puede aplicar descuentos y con qué tope.

---

## 1. Lo realizado en la certificación de factura (JCB, 76.398.956-9)

| Paso | Resultado | Envío / track |
|---|---|---|
| Set básico (intento 2) | SOK | 0260088892 |
| Set factura exenta (intento 2) | SOK | 0260088718 |
| Set guía de despacho | SOK | 0260086000 |
| Libros de ventas, compras y guías | LOK / SOK | 0260088990 · 0260084758 · 0260086522 |
| Simulación: 24 documentos reales de Bsale (17×33, 34, 2×52, 3×61, 56) | EPR 24/24, aprobada | 0260198860 |
| Muestras impresas: 28 del set + 7 de simulación | Enviadas en la declaración, **esperando validación del SII** | reemplazo de simulación: 0260200310 |
| Declaración de cumplimiento (representante legal) | Pendiente, tras la validación | - |

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

## 3. Brechas: lo demás (después de las prioridades)

Cada una se trabaja como un issue: commit, tests y verificación.

### A. Correcto frente al SII

1. ✅ **Estado SII de cada venta.** `Sale.dte_estado`/`dte_glosa` (migración `c9d0e1f2a3b4`) se guardan al
   emitir, y `POST /sales/dte-estados` refresca los que no son terminales. El historial los muestra en la
   columna SII y avisa los rechazados. **Pendiente:** verlo pasar de FIRMADO a ACEPTADO con una venta real
   en maullín.
2. ✅ **`razon` en las referencias.** La devolución manda su motivo (truncado a 90) y `SaleCreate` acepta `razon`.
3. ✅ **Guía de despacho (52).** El POS la emite con tipo de traslado y de despacho. Descuenta stock, no pasa
   por caja y no se cobra. El traslado interno (5) va al propio emisor y no se factura. En el historial,
   "Facturar guías" arma una 33/34 con las líneas y precios de las guías (mismo cliente, hasta 40), las
   referencia con tipo 52, cobra con un medio de pago y no vuelve a mover stock (`sales.ind_traslado`,
   `sales.facturada_por_id`, migración `d0e1f2a3b4c5`). **Pendiente:** emitir una real en maullín (JCB no
   tiene CAF 52 vigentes).
4. **NC que corrige texto (código 2).** Hoy la devolución solo reingresa stock. Falta un flujo de NC sin
   montos, con el detalle en la forma "donde dice… debe decir…", como pide el manual. Sirve, por ejemplo,
   para corregir el giro o la dirección del cliente.
5. **Forma de pago y vencimiento.** Una venta con `CREDITO_INTERNO` debería ir con `forma_pago=2` y
   `fecha_vencimiento`. Hoy no se envían.

### B. Paso a producción (postergado por el usuario, salvo el selector de P2)

6. → Pasó a **P2** (modo del emisor). Para JCB en producción corresponde la **Res. 80 del 22-08-2014**, la
   que imprime Bsale. El número 0 de 2020 es el de certificación.
7. **CAF de producción.** Se piden en palena, no en maullín. La pantalla de Folios (`FoliosTab.tsx`) debería
   mostrar el ambiente del CAF y alertar si no coincide con el del emisor. Con PROD no se aceptan CAF de maullín.
8. **Convivencia con Bsale.** No emitir el mismo tipo de documento en ambos sistemas a la vez: son rangos de
   folio distintos, pero el SII los ve todos. Hay que documentar la fecha de corte por tipo.

### C. Mejoras de uso

9. → Pasó a **P3** (descuentos).
10. **Reimpresión.** Revisar que la reimpresión de cedible (`_impreso_dte`) y el ticket 57/80 mm
    (`backend/app/services/dte_impreso.py`) no corten la razón social, como pasaba en el PDF carta.
11. **Stock de folios.** Mostrar la alerta de pocos folios (`DTE_FOLIO_UMBRAL_ALERTA`) en el dashboard.

### D. Deuda técnica que toca esta etapa

12. **Totales triplicados.** `calcular_totales` (dte-torn), `totales_dte` (backend) y `totalesDte`
    (frontend). El test de contrato se adelanta como primera tarea de **P3**. La opción mayor sigue abierta:
    que el backend use el `monto_total` que devuelve dte-torn como fuente de verdad.
13. **Tablas DTE locales.** Correr `backend/scripts/migrate_retiro_dte_local.py --aplicar` una vez
    confirmado que todos los CAF vigentes están en dte-torn.

### Fuera de esta etapa

- **Boletas (39/41):** su propia certificación.
- **Libros de compra/venta:** los reemplaza el RCV del SII. Solo se usaron en la certificación.

---

## 4. Cómo verificar que quedó alineado

- Suite del backend (`cd backend && pytest -q`), con `FakeDte` actualizado a los campos nuevos (estado,
  razón, traslado, descuentos, modo).
- Suite de dte-torn en Docker (ver `tasks/todo.md`).
- `cd frontend && npm run build` sin errores de tipos.
- En maullín, con CAF de prueba, emitir desde el POS real una venta por cada tipo: 33, 34, 52 venta,
  52 traslado interno, 61 devolución, 61 corrige texto y 56. Cada una tiene que quedar ACEPTADO, con el
  estado visible en el historial, el PDF con referencia y motivo, y el XML llegado a la casilla del cliente.
- En Desarrollador, la misma venta se emite sin ninguna llamada al SII.
