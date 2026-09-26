# Certificación de boletas electrónicas (39 y 41)

Issue: [#49](https://github.com/AstralMoonlight/torn/issues/49). Empresa: DISTRIBUIDORA JCB SPA
(76.398.956-9), la misma que certificó factura. JCB emite **sobre todo boletas**, así que sin esta
certificación el piloto en el local cubre solo una parte de las ventas (ver [`lanzamiento.md`](lanzamiento.md)).

> **Estado (2026-09-25):** se llegó a la pantalla de generación del set, pero **todavía no se pide**. Se
> retoma la semana del 2026-09-28.

## Dónde está en el SII (verificado 2026-09-25)

La boleta **no** se certifica en el menú de postulantes de maullín (ese es el de factura). Tiene su propia
aplicación, `certBolElectDteInternet`, con login de RUT y clave:

| Paso | URL | Qué muestra |
|---|---|---|
| Pedir el set | https://www4.sii.cl/certBolElectDteInternet/?SET=1 | "Generación de nuevo set de pruebas" |
| Declaración de cumplimiento | https://www4.sii.cl/certBolElectDteInternet/ | Pide el RUT de la empresa |

- Sin `?SET=1` abre la declaración, y con 76398956-9 responde "La empresa no se encuentra en estado
  autorizada para efectuar Declaración de Cumplimiento de Requisitos". Es lo esperado: esa página solo
  sirve después del visto bueno del set.
- Navegando desde sii.cl (Servicios online > Boleta de ventas y servicios electrónica > Boleta electrónica
  de mercado > Menú postulantes > Ambiente de certificación y prueba) se llega al menú de maullín de
  factura, donde no hay nada propio de boletas. Ir directo a las URL de arriba.
- La pantalla de `?SET=1` confirma que JCB "se encuentra autorizada en el SII como emisor de documentos
  electrónicos en ambiente de certificación", así que no hace falta esperar a #48 para pedir el set.
- Ofrece **un solo set: "SET DE BOLETA ELECTRÓNICA AFECTA"** (tipo 39). No aparece la boleta exenta (41).

## Lo que dice el SII (fuentes leídas el 2026-09-25)

- [Instructivo técnico de boleta electrónica](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf)
  (28-10-2021): mismo modelo que la factura, pero **otros servidores y servicios REST** (semilla, token,
  envío, estado del envío y consulta de boleta). El token de factura no sirve para boletas. Máximo
  **500 boletas por envío**. El diagnóstico del envío se consulta por REST con el track id, que tiene
  **15 dígitos** (el de factura tiene 10). Documentación de la API: https://www4c.sii.cl/bolcoreinternetui/api/
- [Instructivo de certificación de boletas](https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm):
  el representante legal pide el set, el SII lo revisa (10 a 15 días hábiles según la página), se
  envían los casos, el SII da el visto bueno y el representante hace la declaración de cumplimiento. La
  representación impresa **debe indicar el sitio web donde se consulta la boleta**. Esta página es
  antigua (habla de enviar por correo): **confirmar el procedimiento vigente en maullín al pedir el set.**
- [RVD eliminado](https://www.sii.cl/noticias/2022/160622noti01rp.htm): desde el 01-08-2022 ya no se
  envía el Resumen de Ventas Diarias (ex RCOF) en producción (Res. Ex. SII N° 53 de 2022). **Por
  confirmar:** si el set de certificación todavía lo pide. Si no lo pide, el RCOF pendiente de dte-torn
  se descarta.

## Lo que ya existe en dte-torn

- `builder.py` arma boletas 39 y 41, validadas contra `EnvioBOLETA_v11.xsd`.
- `sii_client.py` tiene los endpoints REST de boleta (apicert / pangal). El 2026-09-23 el SII entregó
  token por el canal de boletas con el certificado real.
- `POST /boletas` en la API, y el backend ya distingue `BOLETAS` en `routers/sales.py`.
- Ticket 57/80 mm con timbre en el backend (`backend/app/services/dte_impreso.py`).

**Falta:**
- `set_pruebas.py` solo entiende 33, 34, 52, 56 y 61: no lee un set de boletas.
- Verificación por folio de una boleta tras una subida ambigua (hoy va a revisión manual).
- Nunca se ha enviado una boleta real a certificación.

## Tareas

### Fase 1: pedir el set (lo hace el usuario o la representante)

- [x] Ubicar dónde se pide el set (ver "Dónde está en el SII").
- [ ] Pedir el set en `?SET=1` **una sola vez**:
      - marcar "SET DE BOLETA ELECTRÓNICA AFECTA";
      - en "Correo electrónico Proveedor de Software Boleta Electrónica" poner un correo que se lea
        seguido (JCB es su propio proveedor): llegan ahí las instrucciones y el visto bueno;
      - bajar el archivo con el enlace de la misma página.
- [ ] Guardar el archivo en `setDePruebas/` (fuera de git) y anotar aquí el N° de atención de cada caso.
- [ ] Leer las instrucciones del set: casos, si pide RVD, si pide muestras impresas y en qué formato.

### Fase 2: emitir el set

- [ ] `set_pruebas.py` lee el set de boletas (tipo 39, montos IVA incluido; 41 solo si el set lo trae).
- [ ] Modo `certificacion set` para boletas: un solo envío por el canal REST, con el track de 15 dígitos
      y el estado consultado por REST.
- [ ] Pedir CAF de certificación 39 (y 41 si el set lo trae) en maullín.
- [ ] Enviar, revisar el estado y dejar la tabla de tracks aquí, como en `todo.md`.
- [ ] Si el set pide RVD: generarlo (mismo schema del ex RCOF, sin detalle de folios) y enviarlo.

### Fase 3: impreso y declaración

- [ ] El ticket 57/80 mm de la boleta lleva timbre, la resolución y el sitio de verificación
      (el que indique el SII para boletas). Revisar también la boleta en carta.
- [ ] Muestras impresas, si el SII las pide (upload en https://www4.sii.cl/pdfdteInternet/).
- [ ] Declarar el avance en maullín con el track del set.
- [ ] Visto bueno del SII y declaración de cumplimiento de la representante, en
      https://www4.sii.cl/certBolElectDteInternet/ (sin `?SET=1`).

### Fase 4: después de certificar

- [ ] CAF de producción de boletas en palena.
- [ ] Verificación por folio de boletas ambiguas (antes de emitir boletas reales en volumen).
- [ ] Cierre de #49.

## Riesgos

- Pedir el set otra vez **anula el anterior**, aunque ya esté enviado (pasó con la factura el 2026-09-24).
- El servidor de certificación de boletas se llama distinto al de facturas: no mezclar URLs ni tokens.
- Una boleta de consumidor final va sin receptor; una NC de esa boleta hoy falla en dte-torn, que exige
  giro, dirección y comuna del receptor en todo tipo no-boleta (pendiente conocido).
