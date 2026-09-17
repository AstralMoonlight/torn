# Informe Técnico As-Built: Torn POS Engine

**Fecha:** 14/02/2026
**Rol:** Chief Architect
**Versión:** 1.0 (World-Class Core)

---

## 1. Mapa del Sistema (Arquitectura)
El núcleo de "Torn" ha evolucionado de un simple facturador a un **Motor POS/ERP** completo.

### Módulos Principales
1.  **Core / Catálogo**: Gestión de Productos, Variantes y Precios.
2.  **Motor de Ventas**: Orquestador transaccional que coordina Inventario, Pagos y DTEs.
3.  **Caja (Cash Management)**: Control de sesiones, turnos y arqueos ciegos.
4.  **Tesorería & Crédito**: Gestión de múltiples medios de pago y **Cuentas Corrientes de Clientes** ("Fiado").
5.  **Logística Inversa**: Motor de devoluciones y Notas de Crédito automatizadas.

### Diagrama Conceptual
```
[Frontend POS (React)] -> [API Gateway (FastAPI)]
                                |
        ---------------------------------------------------
        |               |               |                 |
   [Ventas] <---> [Inventario] <---> [Caja] <---> [Clientes/Crédito]
        |               |
      [DTE]       [StockMovement]
        |               |
   [SII Chile]     [Auditoría]
```

---

## 2. Flujos de Negocio Críticos (Deep Dive)

### A. La Venta (Atomicidad Absoluta)
Cuando se procesa una venta, el sistema ejecuta en una sola transacción:
1.  **Verificación**: Stock disponible y Caja abierta.
2.  **Bloqueo**: Reserva de recursos.
3.  **Ejecución**:
    -   Descuento de inventario (FIFO/LIFO según config DB).
    -   Registro de movimientos de kardex (`StockMovement`).
    -   Generación de deuda si es venta a crédito (`User.current_balance`).
    -   Creación del DTE (XML).
4.  **Commit**: Si todo es correcto, se persiste. Si falla algo (incluso la generación del XML), se hace Rollback total.

### B. Ciclo de Caja (Blind Cash)
-   **Apertura**: Cajero declara monto inicial.
-   **Operación**: El sistema acumula "Lo que debería haber" (`final_cash_system`).
-   **Cierre**: El cajero declara "Lo que tiene" (`final_cash_declared`).
-   **Resultado**: El backend calcula la diferencia (`difference`) y cierra el turno. El cajero nunca ve el esperado antes de declarar.

### C. Logística Inversa (Devoluciones)
Nuevo motor implementado. Permite:
-   Anular ventas parciales o totales.
-   Reingresar stock automáticamente con motivo "DEVOLUCION".
-   Generar Nota de Crédito (DTE 61).
-   Reversar deuda de cliente (Abono) o entregar efectivo.

---

## 3. World-Class Upgrade (Novedades)
En esta última iteración, elevamos el estándar con:

1.  **Cuentas Corrientes de Clientes ("Fiado")**:
    -   Ahora cada cliente tiene un `current_balance`.
    -   Nuevo medio de pago `CREDITO_INTERNO`.
    -   Permite gestionar deuda y pagos futuros de forma nativa.

2.  **Motor de Devoluciones (Refunds)**:
    -   Endpoint `POST /sales/return`.
    -   Vincula la Nota de Crédito con la Factura original (`related_sale_id`).
    -   Cierra el ciclo de inventario y financiero.

---

## 4. Roadmap del CTO (Siguientes Pasos)

### Frontend (La Cara del Cliente)
Recomiendo una arquitectura **Headless** desacoplada:
*   **Tecnología**: **Next.js (React)** + **Tailwind CSS**.
*   **Enfoque**: "Touch-First". Botones grandes, flujos lineales.
*   **Offline-First**: Usar `IndexedDB` en el navegador para seguir vendiendo si se cae internet, y sincronizar (Sync) cuando vuelva.

### Hardware Sugerido
*   **POS Terminal**: Tablet Android/iPad o PC All-in-One con pantalla táctil.
*   **Impresora**: Térmica 80mm ESC/POS (USB/Ethernet).
*   **Lector**: Código de Barras 2D (QR support).

### Infraestructura
*   **Docker**: Contenerizar la API y DB para despliegue fácil.
*   **Cloud**: Deploy en AWS/GCP o VPS local con backups automáticos a S3.

---

**Conclusión:**
Torn ya no es un prototipo. Es un Backend POS robusto, seguro y escalable, listo para procesar miles de transacciones diarias con integridad financiera total.
