# Lanzamiento: piloto en el local de JCB y después Factureando

Decidido por el usuario el 2026-09-25:

- El producto se llamará **Factureando**. El dominio `.cl` se compra en nic.cl en más o menos un mes.
  "Torn" queda como nombre clave del repo.
- Antes de eso, **piloto de 30 a 45 días** en el local de DISTRIBUIDORA JCB: un PC propio en el local, que
  el personal enciende al abrir y apaga al cerrar. Se usa por `localhost`, sin dominio. Única empresa.
- Soporte: el usuario entra por SSH o va en persona (10 minutos).
- Quienes lo usan son personas de más de 60 años: **la facilidad de uso es requisito**, no un extra.
- Seguridad con la skill `security-audit` de Cloudflare (instalada globalmente el 2026-09-25).

Orden general (ver [`alineacion_backend_frontend.md`](alineacion_backend_frontend.md)): prioridad P3,
certificación de boletas ([`certificacion_boletas.md`](certificacion_boletas.md)), lo de este archivo,
y el [intercambio](intercambio.md) cuando haya correo.

---

## 0. Decisiones que bloquean el piloto

- [x] **Documentos del piloto (decidido 2026-09-25):** boleta (39), factura (33) y nota de crédito (61).
      Nota de débito (56) muy rara, una al año. El POS sigue ofreciendo **todos** los tipos disponibles
      (34, 41, 52 incluidos): si está disponible para trabajarse, se muestra (decidido 2026-09-25). El
      piloto necesita las **dos** cosas:
      - certificación de boletas ([`certificacion_boletas.md`](certificacion_boletas.md), #49);
      - envío del XML a la casilla de los clientes que reciben factura ([`intercambio.md`](intercambio.md)
        parte a, #56). La casilla de JCB ya existe: `xml@distribuidorajcb.cl`.
- [x] **Sistema operativo:** Linux (decidido 2026-09-25). Distro: Ubuntu Desktop LTS (ver 1.3).
- [ ] **Fecha de corte con Bsale por tipo de documento** (#55): nunca el mismo tipo en los dos a la vez.
- [x] **Bsale como respaldo (decidido 2026-09-26):** queda activo un mes más después del corte, con su
      propio lote de folios. Factureando nunca usa ese lote.
- [x] **Sin marcha blanca en paralelo con Bsale** (descartada 2026-09-26).

## 0.1 Plan de trabajo antes del piloto (2026-09-26)

Lo que falta en código para que el personal no tropiece el primer día. Una tarea = un commit con la
suite verde. Los detalles de A1 a C1 están en [`administracion.md`](administracion.md). El resto de ese
plan (lista + ficha, menú, Mi negocio) va **después** del piloto, con lo que ahí se aprenda.

| # | Tarea | Por qué antes del piloto | Estado |
|---|---|---|---|
| 1 | Rotación de logs de Docker (driver `local` en los dos compose) | El `json-file` crece sin límite y llena el disco del PC | ✅ `2bfd862` |
| 2 | **A1** "Sin marca" manda `null`; fuera "Sin impuesto (0%)" | Editar un producto fallaba al cargar el catálogo | ✅ `df4b4c6` |
| 3 | **A5** El cierre de caja resta las devoluciones en efectivo | La primera devolución descuadra el arqueo por el doble | Hecho en la rama `fix/arqueo-devoluciones`, sin mergear |
| 4 | **NC de una boleta sin cliente** (consumidor final) | dte-torn exige giro, dirección y comuna al receptor de una 61; sin esto no se devuelve el grueso de las ventas. Test en dte-torn y en el backend | |
| 5 | **A3** Historial sin tope de 50 | Ver abajo | |
| 6 | **K1 + K3** Ajuste de stock con kardex (Conteo, Merma, Stock inicial) y `PUT /products` sin `stock_actual` | La toma de inventario del día del corte tiene que quedar anotada | |
| 7 | **C1** Pagos de clientes con crédito interno (saldo, registrar pago; si es efectivo, entra al cierre de caja) | JCB fía: hoy la deuda sube y nunca baja | |
| 8 | Alertas por correo (0.2) | Nadie está mirando el PC | |

**A3, decidido (2026-09-26):** el historial busca en **todas** las ventas, en el servidor, no dentro de
las últimas 50. Por defecto muestra las de hoy; se cambia el día o el rango de fechas, y el buscador
(folio, cliente o RUT) recorre todo sin importar la fecha, para encontrar la venta que se quiere devolver
aunque sea de hace un mes. Resultados paginados.

## 0.2 Alertas por correo (decidido 2026-09-26)

Un revisor diario que manda correo solo cuando hay algo que hacer:

| Alerta | Va a |
|---|---|
| Documentos que el SII no ha aceptado después de 24 horas (RECHAZADO, ERROR o sin respuesta) | El **cliente**, al correo registrado de la empresa |
| El respaldo de la noche falló | El administrador de Factureando (el usuario) |
| Disco sobre 80% | El administrador |
| Pocos folios (`DTE_FOLIO_UMBRAL_ALERTA`) | El administrador |

**Por decidir:** desde qué casilla salen los correos (en el piloto, ¿la de JCB?; en Factureando, una del
dominio propio) y dónde corre el revisor (el scheduler de dte-torn ya revisa folios y certificados).
Depende del respaldo (1.4) para la alerta de respaldo.

## 1. Piloto en el local

### 1.1 Paso a producción ante el SII

- [ ] Declaración de cumplimiento de factura (#48), la hace la representante en maullín
      (https://maullin.sii.cl/cvc_cgi/dte/pe_avance7).
- [ ] Emisor de JCB en modo PROD con la **Res. 80 del 22-08-2014** (la de certificación era la 0 de 2020).
- [ ] CAF de producción pedidos en palena, cargados en dte-torn. Pantalla de folios que avise si el CAF
      no es del ambiente del emisor (#54). Alerta de pocos folios en el dashboard (#51).
- [ ] Correos de contacto de la empresa en el SII: hoy apuntan a Haulmer (dte.haulmer.com). Cambiarlos
      (lo hace el usuario en el SII).
- [ ] Una venta real de cada tipo que se vaya a usar, verificada ACEPTADO en el SII (#47, adaptado a palena).
- [ ] Retirar las tablas DTE locales del backend (#52) una vez confirmados los CAF en dte-torn.

### 1.2 Datos reales de JCB

- [ ] Vaciar el tenant 35 de los datos de demostración que cargó `seed_jcb.py` (conservar la empresa,
      el emisor y su enlace con dte-torn: **nunca cambiar su id en dte-torn**).
- [ ] Productos, clientes y proveedores: los carga el usuario por su cuenta (decidido 2026-09-25).
- [ ] Toma de inventario inicial el día del corte.
- [ ] Cuentas para la madre del usuario y la otra vendedora, con su rol. Borrar del `.env` las
      credenciales de admin de desarrollo (`TORN_ADMIN_EMAIL`/`TORN_ADMIN_PASSWORD`).

### 1.3 Instalación en el PC del local

- [ ] Ubuntu Desktop LTS con Docker Engine (no Docker Desktop), actualizaciones de seguridad automáticas
      (`unattended-upgrades`) y la impresora térmica por CUPS.
- [ ] Una sola red de Docker para los dos compose (Torn y dte-torn): el backend habla con dte-torn por el
      nombre del servicio y no por `host.docker.internal:8001`.
- [ ] Frontend en modo producción: el compose usa `target: dev`; el `Dockerfile.frontend` ya tiene el
      target `runner`. Un compose (o override) de producción para el local.
- [ ] Todo arranca solo al encender: Docker al iniciar sesión, `restart` en los servicios (ya existe) y
      el navegador abriendo el POS a pantalla completa. Inicio de sesión del sistema sin pasos extra
      para el personal, sin dejar el PC sin contraseña.
- [ ] Apagado diario: comprobar que apagar a mitad de un envío al SII no pierde nada (el scheduler de
      dte-torn reconcilia contra Postgres al arrancar: probarlo apagando con documentos en cola).
- [ ] **Sin internet**: comprobar qué pasa si se cae la conexión. dte-torn es local, así que la venta
      debería firmarse y quedar en cola hasta que vuelva la red. Verificarlo y que la pantalla lo diga
      en palabras simples.
- [ ] Hora del PC en Chile (los contenedores corren en UTC; dte-torn ya usa `hoy_chile()`).
- [ ] Impresora térmica: ancho real (57 u 80 mm), impresión sin el diálogo del navegador (modo kiosco),
      y calibrar el timbre leyéndolo con un lector de verdad (`COLUMNAS_TIMBRE`, pendiente en `claude.md`).
- [ ] Lector de código de barras probado con productos reales (`useBarcodeScanner`).
- [ ] UPS o al menos regleta con protección: un corte de luz a mitad de venta es el caso más probable.

### 1.4 Respaldo (no existe nada hoy)

- [ ] Servidor de respaldo (lo consigue el usuario antes de pasar a producción).
- [ ] Respaldo diario automático de las **dos** bases (Torn y dte-torn) y del bucket de MinIO (XML
      firmados, write-once), fuera del PC. Diseño propuesto el 2026-09-25: `restic`, cifrado en el PC antes de
      salir, **un repositorio por empresa** (`/respaldos/<RUT>/`). Si el servidor es un VPS propio, con
      `rest-server --append-only`: el PC agrega pero no puede borrar (un PC comprometido no se lleva los
      respaldos) y la limpieza (`forget --prune`) corre en el servidor. Si es solo una cuenta SFTP, restic
      funciona igual pero sin esa protección. Los XML ya van por empresa en MinIO
      (`{tenant_id}/dte/{tipo}/{folio}/...`, `dte-torn/app/core/almacen.py`).
- [ ] Bases de datos en el **mismo** respaldo: `pg_dump` de Torn y de dte-torn entra a restic por
      `--stdin`, en la misma pasada que los XML, para que cada foto tenga bases y XML del mismo momento.
      Retención (`restic forget`): 14 diarias, 8 semanales, 12 mensuales y 6 anuales (plazo del SII). **Plan aprobado por el usuario (2026-09-25).**
- [ ] Los XML de los DTE hay que guardarlos por años (plazo del SII): el respaldo no es opcional.
- [ ] La llave maestra de dte-torn (`DTE_MASTER_KEY`) respaldada **aparte** de los datos: sin ella los
      certificados y CAF cifrados no se pueden leer (ver "La llave maestra" en `dte-torn/README.md`).
- [ ] Probar una restauración completa en otra máquina antes de empezar el piloto.

### 1.5 Seguridad del piloto (con la skill `security-audit`)

- [ ] Auditoría con `security-audit` sobre backend, frontend y dte-torn (modo completo, pedirlo así).
- [ ] Puertos: el compose de Torn publica `5432`, `8000` y `3000` en todas las interfaces, así que son
      visibles en la red del local (y en el wifi, si lo hay). Todo corre en el mismo PC: las bases,
      MinIO, Redis y dte-torn sin puertos publicados (solo red interna de Docker); el frontend y el
      backend solo en `127.0.0.1`, porque el navegador llama al backend directo (`NEXT_PUBLIC_API_URL`).
- [ ] `TORN_ENV=production`, `SECRET_KEY` nueva, contraseñas nuevas de Postgres y MinIO (hoy
      `minioadmin` por defecto en dte-torn).
- [ ] Cifrado del disco (LUKS): el PC guarda el certificado digital de la empresa y la llave que lo
      descifra. **Decidido (2026-09-25): desbloqueo por TPM**, el PC arranca solo sin teclear nada. Protege
      si sacan el disco; si se roban el PC entero, la barrera es la contraseña de inicio de Linux.
- [ ] Acceso remoto sin abrir puertos en el router del local: una VPN tipo Tailscale o un túnel, con
      SSH solo por llave (sin contraseña).
- [ ] Actualizaciones del sistema operativo y de Docker fuera del horario de atención.
- [ ] Sesiones: cerrar sesión o bloquear al rato de inactividad, para que no quede el POS abierto con
      el usuario administrador.

### 1.6 Facilidad de uso para personas mayores

Revisar cada flujo que ellas usan (vender, cobrar, boleta o factura, devolución, abrir y cerrar caja,
buscar un producto, ver el día) con la skill `ui-ux-pro-max` y estos criterios:

- [ ] Letra grande y alto contraste por defecto; botones grandes, con texto y no solo íconos.
- [ ] Nada de jerga: "folio", "CAF", "DTE", "track" no aparecen en las pantallas del personal.
- [ ] Mensajes de error que dicen qué hacer ("Revise la conexión a internet y vuelva a intentar"),
      nunca códigos.
- [ ] Confirmación antes de lo que no se deshace (anular, devolver, cerrar caja).
- [ ] Menú del personal reducido a lo que usa; lo de administración queda para el usuario.
- [ ] Una hoja impresa de una página por tarea, junto al PC ("Cómo vender", "Cómo cerrar la caja").
- [ ] Capacitación en el local antes del primer día y acompañamiento el primer día de uso real.

### 1.7 Durante el piloto (30 a 45 días)

- [ ] Registro de opiniones y problemas: un archivo `tasks/piloto_jcb.md` con fecha, quién, qué pasó
      y qué se decidió. Revisarlo cada semana con ellas.
- [ ] Cómo se actualiza el PC: respaldo primero, luego `git pull` y `docker compose up -d --build` por
      SSH fuera del horario, y verificar una venta de prueba en modo Desarrollador.
- [ ] Revisar cada día los documentos RECHAZADO o en ERROR (el historial ya los muestra).
- [ ] Al cierre del piloto: decidir qué cambia antes de abrir a otros clientes.

## 2. Lanzamiento de Factureando (después del piloto)

Ya estaba acordado: seguridad, luego servidor y release. Lo que agrega el lanzamiento comercial:

- [ ] Marca: renombrar "Torn" en la interfaz, impresos y correos a Factureando.
- [ ] Dominio `factureando.cl` en nic.cl.
- [ ] Empresa propia constituida, con su RUT, e inscripción como proveedor de software en el SII
      (hoy JCB está certificada como software propio). Averiguar qué exige el SII para que otras
      empresas usen el sistema.
- [ ] Servidor: TLS, backups, monitoreo, despliegue repetible, dte-torn sin puertos expuestos.
- [ ] Intercambio con correo propio del dominio ([`intercambio.md`](intercambio.md)).
- [ ] Alta de clientes nuevos: empresa, certificado, CAF, usuarios, en un flujo guiado.
- [ ] Cobro: $33.333 mensual, packs de 6 y 12 meses con impresora (precio ya decidido).
- [ ] **Administración del negocio de Factureando** (surgió el 2026-09-26, sin diseñar). Hoy saas-admin
      solo crea empresas. Hace falta:
      - suscripciones: plan, pack, fecha de inicio y de vencimiento de cada empresa;
      - cobro con pasarela de pago (12 cuotas sin interés en los packs, ya considerado en el precio);
      - cobranza: aviso antes del vencimiento, qué pasa si no paga (¿solo lectura?, ¿plazo de gracia?);
      - facturación de Factureando a sus clientes, emitida por el mismo sistema como una empresa más,
        con el RUT de la empresa propia (arriba).
      No bloquea el piloto (JCB no paga), pero sí la venta al primer cliente externo. Merece su propio
      plan en `tasks/`.
- [ ] Términos de servicio y política de privacidad (datos de clientes finales de cada empresa).
- [ ] Canal de soporte y horario.
- [ ] Autocompletar por RUT ([`autocompletar_rut_sii.md`](autocompletar_rut_sii.md), #50).
