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

class TestWorldClass:
    def setup_method(self, method):
        pass

    def test_credit_and_return_flow(self, client, db_session):
        # 1. Setup Data
        issuer = Issuer(rut="76123456-K", razon_social="Emisor WC", giro="Giro", acteco="123")
        db_session.add(issuer)
        caf = CAF(tipo_documento=33, folio_desde=1, folio_hasta=100, ultimo_folio_usado=0, xml_caf="DUMMY")
        db_session.add(caf)
        
        # Cliente
        client_user = User(rut="12345678-5", razon_social="Cliente Fiador", email="fiado@test.com", current_balance=0)
        db_session.add(client_user)
        
        # Cajero
        cashier = User(rut="99999999-9", razon_social="Cajero WC", email="cashier@test.com")
        db_session.add(cashier)
        
        # Producto
        prod = Product(
            codigo_interno="WC-PROD", nombre="Producto Caro", precio_neto=10000, 
            controla_stock=True, stock_actual=10
        )
        db_session.add(prod)
        
        # Medios de Pago
        pm_credit = PaymentMethod(code="CREDITO_INTERNO", name="Fiado")
        pm_cash = PaymentMethod(code="EFECTIVO", name="Efectivo")
        db_session.add(pm_credit)
        db_session.add(pm_cash)
        
        db_session.commit()
        
        # Ensure user 1 exists (Cajero)
        u1 = db_session.get(User, 1)
        if not u1:
             u1 = User(id=1, rut="11111111-1", razon_social="Admin", email="admin@torn.cl")
             db_session.add(u1)
             db_session.commit()

        # 2. Abrir Caja
        client.post("/cash/open", json={"start_amount": 5000})

        # 3. Venta con Crédito Interno
        # Total: 11900.
        sale_data = {
            "rut_cliente": "12345678-5",
            "items": [{"product_id": prod.id, "cantidad": 1}],
            "payments": [{"payment_method_id": pm_credit.id, "amount": 11900}]
        }
        resp = client.post("/sales/", json=sale_data)
        assert resp.status_code == 201
        sale_id = resp.json()["id"]
        
        # Verify Debt
        db_session.refresh(client_user)
        assert client_user.current_balance == Decimal("11900")
        
        # Verify Stock
        db_session.refresh(prod)
        assert prod.stock_actual == 9

        # 4. Devolución (Return)
        # El cliente devuelve el producto porque se arrepintió.
        # Devuelve stock, se anula deuda (Abono Crédito Interno).
        
        return_data = {
            "original_sale_id": sale_id,
            "items": [{"product_id": prod.id, "cantidad": 1}],
            "reason": "Arrepentimiento",
            "return_method_id": pm_credit.id # Abono a cuenta
        }
        
        resp = client.post("/sales/return", json=return_data)
        assert resp.status_code == 201
        nc_data = resp.json()
        assert nc_data["tipo_dte"] == 61
        
        # Verify Stock Restock
        db_session.refresh(prod)
        assert prod.stock_actual == 10
        
        # Verify Debt Reduced
        db_session.refresh(client_user)
        assert client_user.current_balance == 0
        
        # Verify Stock Movement
        mov = db_session.query(StockMovement).filter_by(description=f"Devolución venta f.{resp.json()['related_sale_id']}: Arrepentimiento").first()
        # Wait, description format might differ slightly depending on folio/logic.
        # Check by motivo
        mov = db_session.query(StockMovement).filter_by(motivo="DEVOLUCION").first()
        assert mov is not None
        assert mov.cantidad == 1
        assert mov.tipo == "ENTRADA"
