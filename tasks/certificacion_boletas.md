# Certificación de boletas electrónicas (39 y 41)

Issue: [#49](https://github.com/AstralMoonlight/torn/issues/49). Empresa: DISTRIBUIDORA JCB SPA
(76.398.956-9), la misma que certificó factura. JCB emite **sobre todo boletas**, así que sin esta
certificación el piloto en el local cubre solo una parte de las ventas (ver [`lanzamiento.md`](lanzamiento.md)).

> **Estado (2026-10-02):** **V°B° del SII en la certificación de boletas.** Falta la Declaración de
> Cumplimiento de la representante (va junto con la de factura, #48).

## Dónde está en el SII (verificado 2026-09-25)

La boleta **no** se certifica en el menú de postulantes de maullín (ese es el de factura). Tiene su propia
aplicación, `certBolElectDteInternet`, con login de RUT y clave:

| Paso | URL | Qué muestra |
|---|---|---|
| Pedir el set | https://www4.sii.cl/certBolElectDteInternet/?SET=1 | "Generación de nuevo set de pruebas" |
| Pedir la revisión del set (con el track) | https://www4.sii.cl/certBolElectDteInternet/?SET=2 | "Solicitud de Revisión" |
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
- Ticket 58/80 mm con timbre en el backend (`backend/app/services/dte_impreso.py`).

**Falta:**
- `set_pruebas.py` solo entiende 33, 34, 52, 56 y 61: no lee un set de boletas.
- Verificación por folio de una boleta tras una subida ambigua (hoy va a revisión manual).
- Nunca se ha enviado una boleta real a certificación.

## Tareas

### Fase 1: pedir el set (lo hace el usuario o la representante)

- [x] Ubicar dónde se pide el set (ver "Dónde está en el SII").
- [x] Pedir el set en `?SET=1` **una sola vez** (2026-10-02):
      - marcar "SET DE BOLETA ELECTRÓNICA AFECTA";
      - en "Correo electrónico Proveedor de Software Boleta Electrónica" poner un correo que se lea
        seguido (JCB es su propio proveedor): llegan ahí las instrucciones y el visto bueno;
      - bajar el archivo con el enlace de la misma página.
- [x] Guardar el archivo en `setDePruebas/` (fuera de git): `Set Prueba BE.txt`. **No trae N° de
      atención**: es el mismo set para todos.
- [x] Leer las instrucciones del set. Lo que dice:
      - 5 casos, todos boleta afecta (39), precios con IVA. Caso 4: el item 2 es un servicio exento.
        Caso 5: unidad de medida `Kg` en el XML.
      - Cada boleta referencia su caso: `CodRef` = `SET`, `RazonRef` = `CASO-1` (con guion). En el
        esquema de boleta la `Referencia` no lleva `TpoDocRef`/`FolioRef`/`FchRef`.
      - "Informar las cifras con separador de miles" y los textos tal cual el set (p. ej. "Sandwic").
      - **No pide RVD** ni dice nada de muestras impresas.

### Fase 2: emitir el set

- [x] `set_pruebas.py` lee el set de boletas (rama `feat/set-boletas`). Una observación que no entiende
      detiene la lectura en vez de adivinar.
- [x] Modo `certificacion set` para boletas: un solo `EnvioBOLETA` por el canal REST, estado por REST.
      Las boletas del set van a consumidor final (66666666-6).
- [x] Pedir CAF de certificación 39 en maullín: folios 1-5 (2026-10-02 01:56, `dte-torn/folios/`).
      El SII autorizó los 5 de una vez.
- [x] Enviar y revisar el estado:

      | Set | Folios 39 | Track | Resultado |
      |---|---|---|---|
      | Boleta afecta | 1-5 (casos 1 a 5) | 32479202 (REST de boletas) | EPR 5/5, pero la revisión: **SRH**, "El Documento no está en el envío" en los 5 casos |
      | Boleta afecta | 1-5, el mismo sobre | **0261205238** (upload de maullín) | EPR 5/5, 0 reparos (02:38). Revisión: **V°B°** |

      **Lección:** el set se sube por el **upload de maullín** (canal DTE, track de 10 dígitos), como dice
      el correo del SII ("opción de UPLOAD"). El REST de boletas acepta el envío, pero el revisor del set
      no lo ve. `certificacion set` ya sube siempre por maullín.

      El track del envío de boletas tuvo **8 dígitos**, no los 15 que dice el instructivo. El SII
      respondió en unos 15 segundos (REC -> SOK -> EPR).
- [x] ~~Si el set pide RVD~~: el set no lo nombra, pero **el correo del SII sí pide el RCOF**, junto con
      el set y dentro de 24 horas desde que se bajan los folios (CAF bajado el 02-10 01:56, plazo 03-10
      ~01:56). Modo `certificacion rcof` (`app/dte/rcof.py`, XSD oficial `ConsumoFolio_v10.xsd`).
      - SecEnvio 1 (02:05): subida ambigua, maullín cortó la conexión sin track.
      - SecEnvio 2 (02:06): **track 0261203192, RPR "Aceptado con Reparos"**. El detalle del reparo
        llega por correo al buzón de contacto (cPanel), no en la consulta: **0 errores, 1 reparo, el
        250 "Envío de RVD no es obligatorio desde agosto 2022"**. Es solo un aviso; no se corrige.
- [x] Paso 4 del correo: pedir la revisión del set informando el track (**0261205238**) en el apartado
      de boletas del sitio del SII: https://www4.sii.cl/certBolElectDteInternet/?SET=2 (sin `?SET=2`
      abre la declaración de cumplimiento, que responde "no autorizada" hasta el V°B°).

### Fase 3: impreso y declaración

- [ ] El ticket 58/80 mm de la boleta lleva timbre, la resolución y el sitio de verificación
      (el que indique el SII para boletas). Revisar también la boleta en carta.
      El correo del SII exige que el sitio esté **en la boleta impresa y funcionando en la web**.
- [x] ~~Muestras impresas~~: el SII no las pidió; el V°B° llegó sin ellas.
- [x] ~~Declarar el avance en maullín~~: en boletas se reemplaza por la solicitud de revisión (`?SET=2`).
- [x] V°B° del SII (correo del 2026-10-02).
- [ ] Declaración de cumplimiento de la representante, en https://www4.sii.cl/certBolElectDteInternet/
      (sin parámetro). Se firma junto con la de factura (#48).

### Fase 4: después de certificar

- [ ] CAF de producción de boletas en palena.
- [ ] Verificación por folio de boletas ambiguas (antes de emitir boletas reales en volumen).
- [ ] Cierre de #49.

## Riesgos

- Pedir el set otra vez **anula el anterior**, aunque ya esté enviado (pasó con la factura el 2026-09-24).
- El servidor de certificación de boletas se llama distinto al de facturas: no mezclar URLs ni tokens.
- ~~Una NC de una boleta a consumidor final fallaba en dte-torn~~: resuelto (punto 4 de `checklist.md`).
