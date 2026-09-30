# Dashboard: métricas que importan al iniciar sesión

Rama: `feat/dashboard-kpis` (sale de `main` en `5bddecd`).

El panel tiene que responder tres preguntas en cinco segundos, en este orden:

1. ¿Mis documentos están bien con el SII?
2. ¿Cuánto vendí y cuánto gané?
3. ¿Quién me debe plata?

Antes solo respondía la segunda.

## Alertas (franja superior, solo si hay algo que hacer)

| Alerta | Se dispara con | Dato |
|---|---|---|
| Documentos con problemas en el SII | `dte_estado` RECHAZADO, REPAROS o ERROR_VALIDACION, o sin estado final después de 24 h | `Sale.dte_estado`, `dte_glosa` |
| La emisión se va a detener | folios bajo el umbral de dte-torn (ya existía), CAF que vence en menos de 30 días o certificado que vence en menos de 30 días | `/folios/status`, `/folios/certificate` |
| Cobranza vencida | saldo de crédito interno con la venta impaga más antigua pasada de `dias_credito` | `current_balance` + ventas CREDITO_INTERNO |
| Guías sin facturar | guías de venta con `facturada_por_id` NULL (la factura va hasta el día 10 del mes siguiente) | `/sales/guias-pendientes` |

Sin alertas: una línea "Todo en orden con el SII".

## Tareas

- [x] 1. Plan en `tasks/dashboard.md`.
- [x] 2. `GET /reports/panel`: estados DTE del mes, documentos con problemas, IVA estimado del
      mes (débito menos crédito), guías por facturar, cuentas por cobrar por antigüedad y ventas
      de los últimos 30 días.
- [x] 3. `/stats/summary`: cada período trae `sales_total_prev`, el mismo tramo del período anterior
      (hoy hasta ahora contra ayer hasta la misma hora, etc.).
- [x] 4. Frontend: franja de alertas, tarjetas (Ventas con variación, Utilidad, IVA estimado del mes,
      Por cobrar), estado SII con folios, cuentas por cobrar con tramos y top vencidos, ventas de
      30 días en vez de ventas por hora.
- [x] 5. Test `backend/tests/test_panel.py`.

## Decisiones tomadas (revisar)

- **Antigüedad de la deuda**: los pagos se aplican a la venta fiada más antigua (FIFO). Se reparte
  el saldo actual desde la venta más nueva hacia atrás; cada tramo vence en `fecha + dias_credito`.
  Un cliente sin `dias_credito` y con saldo se toma como vencido desde la fecha de la venta.
- **IVA estimado**: débito = IVA de 33/34/39/41/56 menos NC (61) del mes calendario; crédito = IVA de
  las compras con `tipo_documento = FACTURA` del mes. No sabe de compras que no se registraron en
  Torn, por eso dice "estimado". El F29 de un facturador electrónico vence el día 20.
- **Umbral de 24 h** para un documento sin respuesta del SII, y solo se alertan los documentos
  de los últimos 30 días: un rechazo más viejo deja de aparecer aunque nadie lo haya corregido
  (no hay dato que diga "este rechazo ya se reemitió"). Ambos fijos en `reports.py`.
- **Saldo sin venta fiada que lo explique** (cargado a mano o anterior a Torn): cuenta como vencido
  de más de 60 días.
- **CAF y certificado**: aviso a 30 días del vencimiento, nunca en modo Desarrollador.
- **Colores del estado SII**: aceptados en el color principal, reparos en ámbar (la app no tiene token
  de advertencia), rechazados en rojo; cada tramo lleva etiqueta y número, no solo color.
- **Ventas por hora** salen del dashboard (siguen en el reporte diario).
- Las NC ya restaban en las tarjetas (`/stats/summary` usa `SIGNO`); no hubo que corregirlas.

## Fuera de alcance

- Proyección "folios para N días" según ritmo de venta: el umbral de dte-torn ya avisa.
- Botón de contacto por deudor: se enlaza a Clientes.
