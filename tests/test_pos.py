import pytest
import time
from decimal import Decimal
from app.models.product import Product
from app.models.cash import CashSession
from app.models.payment import PaymentMethod, SalePayment
from app.models.sale import Sale
from app.models.inventory import StockMovement
from app.models.user import User
from app.models.dte import CAF
from app.models.issuer import Issuer

class TestPOS:
    def setup_method(self, method):
        pass

    def test_pos_flow(self, client, db_session):
        # 1. Setup Data
        # Emisor, CAF, Cliente
        issuer = Issuer(rut="76123456-K", razon_social="Emisor Test", giro="Giro", acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce")
        db_session.add(issuer)
        caf = CAF(tipo_documento=33, folio_desde=1, folio_hasta=100, ultimo_folio_usado=0, xml_caf="DUMMY")
        db_session.add(caf)
        client_user = User(rut="12345678-5", razon_social="Cliente Test", email="c@test.com")
        db_session.add(client_user)
        
        # Cajero (Simulado ID 1 en router, pero necesitamos que exista en DB)
        cashier = User(rut="99999999-9", razon_social="Cajero 1", email="cashier@test.com")
        db_session.add(cashier)
        db_session.flush() # ID 2 probably? Router said DEFAULT_USER_ID = 1.
        # If seed ran, ID 1 might be Issuer? No, Issuer is checking Issuer table. 
        # User table? Seed created Customer (User). 
        # Wait, seed creates Customer. ID could be anything.
        # Let's force ID 1 for cashier if possible or update router to look for specific ID.
        # Router hardcodes user_id=1.
        # So we must ensure User with ID 1 exists.
        
        # In test DB, it starts empty.
        # Let's create User ID 1 specifically.
        # If autoincrement starts at 1.
        
        # Product
        prod = Product(
            codigo_interno="POS-PROD",
            nombre="Producto POS",
            precio_neto=1000,
            controla_stock=True,
            stock_actual=10
        )
        db_session.add(prod)
        
        # Payment Methods
        pm_cash = PaymentMethod(code="EFECTIVO", name="Efectivo")
        pm_card = PaymentMethod(code="DEBITO", name="Debito")
        db_session.add(pm_cash)
        db_session.add(pm_card)
        db_session.commit()
        
        # Ensure user 1 exists.
        u1 = db_session.get(User, 1)
        if not u1:
             # Create dummy
             u1 = User(id=1, rut="11111111-1", razon_social="Admin", email="admin@torn.cl")
             db_session.add(u1)
             db_session.commit()

        # 2. Intentar vender con caja cerrada -> Error
        sale_data = {
            "rut_cliente": "12345678-5",
            "items": [{"product_id": prod.id, "cantidad": 1}],
            "payments": [{"payment_method_id": pm_cash.id, "amount": 1190}]
        }
        resp = client.post("/sales/", json=sale_data)
        assert resp.status_code == 409
        assert "No hay turno" in resp.json()["detail"]

        # 3. Abrir Caja
        resp = client.post("/cash/open", json={"start_amount": 10000})
        assert resp.status_code == 200
        assert resp.json()["status"] == "OPEN"
        
        time.sleep(1) # Fix for SQLite timestamp equality precision
        
        # 4. Venta con Pago Mixto (Efectivo + Debito)
        # Total: 2 items * 1000 + IVA = 2000 + 380 = 2380
        sale_data_2 = {
            "rut_cliente": "12345678-5",
            "items": [{"product_id": prod.id, "cantidad": 2}],
            "payments": [
                {"payment_method_id": pm_cash.id, "amount": 1000},
                {"payment_method_id": pm_card.id, "amount": 1380}
            ]
        }
        resp = client.post("/sales/", json=sale_data_2)
        assert resp.status_code == 201
        sale_id = resp.json()["id"]

        # 5. Verificar Stock y Movimiento vinculado
        db_session.refresh(prod)
        assert prod.stock_actual == 8
        
        mov = db_session.query(StockMovement).filter_by(sale_id=sale_id).first()
        assert mov is not None
        assert mov.cantidad == 2
        assert mov.user_id == 1  # Cajero

        # 6. Consultar Estado Caja
        resp = client.get("/cash/status")
        assert resp.status_code == 200
        
        # 7. Cerrar Caja
        # Esperado Sistema: 10000 (inicio) + 1000 (ventas efectivo) = 11000
        # Declarado: 11000 (Cuadra)
        resp = client.post("/cash/close", json={"final_cash_declared": 11000})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "CLOSED"
        assert Decimal(data["final_cash_system"]) == Decimal(11000)
        assert Decimal(data["difference"]) == 0
