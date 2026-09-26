# Intercambio: casilla de correo, XML a los clientes y acuse de recibo

> **Casilla lista (2026-09-25):** `xml@distribuidorajcb.cl`, en el hosting cPanel de JCB. Servidor
> `mail.distribuidorajcb.cl`, IMAP 993 y SMTP 465, los dos con SSL/TLS y autenticación. La contraseña va
> solo en el `.env` de dte-torn, nunca en el repo.
>
> **Entra al piloto:** el piloto emite facturas (ver [`lanzamiento.md`](lanzamiento.md)), así que la parte
> a) es obligatoria antes de facturar a empresas. La parte b) puede esperar: si nadie responde, al octavo
> día la factura recibida queda aceptada por presunción legal, igual que hoy.

No existe nada: no hay correo (ni SMTP ni IMAP) en el repo, ni
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
- ~~El servicio de correo~~: el hosting de JCB (arriba). Para Factureando se verá un correo del dominio propio.
- Registrar `xml@distribuidorajcb.cl` como casilla de intercambio de JCB en el SII (hoy apunta a Haulmer,
  ver `plan.md`). Lo hace el usuario. **Ojo:** desde ese momento los XML de los proveedores de JCB llegan a
  la casilla nueva y no a Haulmer/Bsale; confirmar antes que JCB no dependa de recibirlos allá.
- El reparto entre servicios: el XML, la firma y el web service del registro en dte-torn, y los clientes,
  las compras y la UI en el backend.

**Tareas:**
- [x] Bajar del SII los XSD y el instructivo de intercambio (`RespuestaDTE`, `EnvioRecibos`), igual que se
      hizo con los libros (source-driven-development).
- [ ] Decidir el correo del cliente (el servicio ya está: la casilla de JCB).
- [ ] Probar SMTP e IMAP contra `mail.distribuidorajcb.cl` desde el contenedor de dte-torn.
- [ ] dte-torn: sobre `EnvioDTE` para el receptor y su envío al correo tras la aceptación del SII, con reintentos.
- [ ] Backend y frontend: estado del envío en la venta y botón de reenviar en el historial.
- [ ] Recepción: leer la casilla, validar y guardar los documentos recibidos.
- [ ] Acuse del envío firmado (`RespuestaDTE` con `RecepcionEnvio`), validado contra el XSD, enviado al proveedor.
- [ ] dte-torn: cliente del web service del Registro de Aceptación o Reclamo (registrar y consultar eventos).
- [ ] Frontend: bandeja de documentos recibidos con aceptar / reclamar (va al registro) y el plazo de 8 días a la vista.
