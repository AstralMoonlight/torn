"""Tests de integración para el flujo completo de ventas."""

from decimal import Decimal




def _seed_caf(db_session, client):
    """Inserta un CAF de prueba tipo 33 directamente en la BD y abre caja."""
    from app.models.dte import CAF
    from app.models.payment import PaymentMethod
    from app.models.user import User

    # Seed User 1 (Admin/Cashier) for Cash Session
    if not db_session.get(User, 1):
        admin = User(id=1, rut="11111111-1", razon_social="Admin", email="admin@torn.cl")
        db_session.add(admin)
        db_session.commit()

    # Seed CAF
    caf = CAF(
        tipo_documento=33,
        folio_desde=1,
        folio_hasta=100,
        ultimo_folio_usado=0,
        xml_caf="<CAF_TEST>",
    )
    db_session.add(caf)
    
    # Seed Payment Methods
    pm = PaymentMethod(code="EFECTIVO", name="Efectivo")
    db_session.add(pm)
    
    db_session.commit()

    # Open Cash Session
    client.post("/cash/open", json={"start_amount": 10000})


class TestSalesFlow:
    """Flujo completo: Cliente → Producto → Venta → Verificación."""

    def test_full_sale_flow(self, client, db_session):
        """
        Prueba de integración end-to-end:
        1. Crear cliente
        2. Crear producto
        3. Insertar CAF
        4. Realizar venta
        5. Verificar totales e IVA exactos
        """

        # ── 1. Crear cliente ─────────────────────────────────────────
        customer_data = {
            "rut": "12345678-5",
            "razon_social": "Empresa Test SpA",
            "giro": "Desarrollo de Software",
            "direccion": "Av. Principal 100",
            "comuna": "Santiago",
        }
        resp = client.post("/customers/", json=customer_data)
        assert resp.status_code == 201, f"Error creando cliente: {resp.text}"
        customer = resp.json()
        assert customer["rut"] == "12345678-5"

        # ── 2. Crear productos ───────────────────────────────────────
        product_a = {
            "codigo_interno": "TEST-001",
            "nombre": "Producto A",
            "descripcion": "Producto de prueba A",
            "precio_neto": "10000.00",
            "unidad_medida": "unidad",
        }
        product_b = {
            "codigo_interno": "TEST-002",
            "nombre": "Producto B",
            "precio_neto": "5000.00",
        }

        resp_a = client.post("/products/", json=product_a)
        assert resp_a.status_code == 201, f"Error creando producto A: {resp_a.text}"
        prod_a = resp_a.json()

        resp_b = client.post("/products/", json=product_b)
        assert resp_b.status_code == 201, f"Error creando producto B: {resp_b.text}"
        prod_b = resp_b.json()

        # ── 3. Insertar CAF y Abrir Caja ─────────────────────────────
        _seed_caf(db_session, client)

        # ── 4. Realizar venta ────────────────────────────────────────
        sale_data = {
            "rut_cliente": "12345678-5",
            "tipo_dte": 33,
            "items": [
                {"product_id": prod_a["id"], "cantidad": "3"},
                {"product_id": prod_b["id"], "cantidad": "2"},
            ],
            "descripcion": "Venta de prueba integración",
            "payments": [
                {"payment_method_id": 1, "amount": "47600", "transaction_code": "TEST"}
            ]
        }
        resp_sale = client.post("/sales/", json=sale_data)
        assert resp_sale.status_code == 201, f"Error creando venta: {resp_sale.text}"
        sale = resp_sale.json()

        # ── 5. Verificar totales ─────────────────────────────────────
        # Producto A: 10000 × 3 = 30000
        # Producto B: 5000 × 2  = 10000
        # Neto total = 40000
        expected_neto = Decimal("40000.00")
        expected_iva = (expected_neto * Decimal("0.19")).quantize(Decimal("0.01"))
        expected_total = expected_neto + expected_iva

        assert Decimal(sale["monto_neto"]) == expected_neto, \
            f"Neto: {sale['monto_neto']} != {expected_neto}"
        assert Decimal(sale["iva"]) == expected_iva, \
            f"IVA: {sale['iva']} != {expected_iva}"
        assert Decimal(sale["monto_total"]) == expected_total, \
            f"Total: {sale['monto_total']} != {expected_total}"

        # Verificar folio asignado
        assert sale["folio"] == 1
        assert sale["tipo_dte"] == 33

        # Verificar detalles
        assert len(sale["details"]) == 2

    def test_invalid_rut_rejected(self, client):
        """Verifica que un RUT inválido es rechazado por el validador."""
        bad_customer = {
            "rut": "12345678-0",  # DV incorrecto
            "razon_social": "Bad Corp",
        }
        resp = client.post("/customers/", json=bad_customer)
        assert resp.status_code == 422, "Debería rechazar RUT inválido"

    def test_sale_without_caf_fails(self, client, db_session):
        """Verifica que una venta falla si no hay CAF disponible."""
        # Setup Cash Session manually because _seed_caf is not called here (it inserts caf)
        # We need Cash Open but NO CAF.
        from app.models.user import User
        if not db_session.get(User, 1):
            admin = User(id=1, rut="11111111-1", razon_social="Admin", email="admin@torn.cl")
            db_session.add(admin)
            db_session.commit()
        client.post("/cash/open", json={"start_amount": 10000})

        # Crear cliente y producto
        client.post("/customers/", json={
            "rut": "12345678-5",
            "razon_social": "Test",
        })
        resp_p = client.post("/products/", json={
            "codigo_interno": "X-001",
            "nombre": "Widget",
            "precio_neto": "1000.00",
        })
        prod = resp_p.json()

        # Intentar venta sin CAF
        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": prod["id"], "cantidad": "1"}],
            "payments": [{"payment_method_id": 1, "amount": "1190", "transaction_code": "TEST"}]
        })
        assert resp.status_code == 409, "Debería fallar sin CAF"
