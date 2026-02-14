# Guía de Desarrollo - Torn POS

Esta guía está diseñada para que cualquier desarrollador pueda entender la arquitectura y lógica del proyecto **Torn** (Sistema de Facturación y POS) rápidamente.

## 1. Mapa de Arquitectura

El proyecto sigue una estructura modular basada en **FastAPI** y **SQLAlchemy**.

```
torn/
├── app/
│   ├── models/       # Definición de Tablas (ORM)
│   │   ├── user.py       # Clientes y Usuarios
│   │   ├── sale.py       # Ventas (Encabezado/Detalle)
│   │   ├── product.py    # Catálogo e Inventario
│   │   ├── cash.py       # Sesiones de Caja
│   │   └── dte.py        # Documentos Tributarios y Folios
│   ├── routers/      # Endpoints de la API (Controladores)
│   │   ├── sales.py      # Lógica de Venta y Devolución (Core)
│   │   ├── cash.py       # Apertura y Cierre de Caja
│   │   └── ...
│   ├── services/     # Lógica de Negocio Compleja
│   │   └── xml_generator.py # Generación de XML para el SII
│   ├── utils/        # Utilidades Generales
│   │   └── validators.py # Validación de RUT, etc.
│   ├── schemas.py    # Modelos Pydantic (Request/Response)
│   ├── database.py   # Configuración de DB y Sesión
│   └── main.py       # Entrypoint de la aplicación
├── tests/            # Tests de Integración (Pytest)
├── DEVELOPER_GUIDE.md # Estás leyendo esto
└── INFORME_TECNICO.md # Reporte de alto nivel de arquitectura
```

## 2. Flujos Críticos

### A. Creación de Venta (`POST /sales/`)
Este es el proceso más complejo y crítico del sistema. Ocurre en una **transacción atómica**:

1.  **Validación**: Se verifica que haya una caja abierta (`CashSession`) y que los productos tengan stock.
2.  **Inventario**: Se descuenta el stock y se crea un registro en el Kardex (`StockMovement`).
3.  **Pagos**: Se registran los pagos. Si es `CREDITO_INTERNO`, se aumenta la deuda del cliente (`User.current_balance`).
4.  **DTE**: Se asigna un Folio Fiscal (CAF) y se genera el XML firmado.
5.  **Commit**: Si todo es exitoso, se guardan los cambios. Si falla algo, se hace `ROLLBACK` total.

### B. Logística Inversa / Devoluciones (`POST /sales/return`)
Permite anular una venta o devolver productos:

1.  **Validación**: Se busca la venta original.
2.  **Stock**: Se reingresa la mercadería al inventario.
3.  **DTE**: Se genera una **Nota de Crédito (Tipo 61)** referenciando a la venta original.
4.  **Dinero**: Se devuelve el dinero a la caja o se abona a la Cuenta Corriente del cliente (reduciendo su deuda).

## 3. Estándares de Código

### Documentación (Google Style)
Todo el código debe estar documentado usando el formato **Google Style Docstrings**.
-   **Clases (Modelos)**: Explicar qué entidad de negocio representa.
-   **Funciones**: Explicar qué hace, `Args`, `Returns` y `Raises` posibles.

### Type Hinting
El uso de tipos es obligatorio (`def funcion(a: int) -> str:`) para facilitar la lectura y el uso de herramientas de análisis estático.

## 4. Setup de Desarrollo

1.  **Entorno Virtual**:
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    ```

2.  **Base de Datos**:
    Asegúrate de tener PostgreSQL corriendo y configura `TORN_DB_URL` en `.env` (o usa el default local).

3.  **Ejecutar Servidor**:
    ```bash
    uvicorn app.main:app --reload
    ```

4.  **Correr Tests**:
    ```bash
    pytest
    ```

---
*Hecho con ❤️ por el equipo de ingeniería de Torn.*
