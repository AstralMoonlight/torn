import pytest
from decimal import Decimal
from app.models.product import Product
from app.models.inventory import StockMovement
from app.models.user import User
from app.models.dte import CAF, DTE
from app.models.issuer import Issuer

class TestInventory:
    def setup_method(self, method):
        """Preparar datos básicos para cada test."""
        pass

    def test_inventory_list(self, client, db_session):
        # Crear producto
        prod = Product(
            codigo_interno="TEST-INV-1",
            nombre="Producto Test Inventario",
            precio_neto=1000,
            controla_stock=True,
            stock_actual=10,
            stock_minimo=5
        )
        db_session.add(prod)
        db_session.commit()

        resp = client.get("/inventory/")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        found = next(p for p in data if p["codigo_interno"] == "TEST-INV-1")
        assert Decimal(found["stock_actual"]) == Decimal(10)
        assert found["controla_stock"] is True

    def test_sale_deducts_stock(self, client, db_session):
        # 1. Setup Datos
        # Emisor
        issuer = Issuer(rut="76123456-K", razon_social="Emisor Test", giro="Giro", acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce")
        db_session.add(issuer)
        # CAF
        caf = CAF(tipo_documento=33, folio_desde=1, folio_hasta=100, ultimo_folio_usado=0, xml_caf="DUMMY")
        db_session.add(caf)
        # Cliente
        user = User(rut="12345678-5", razon_social="Cliente Test", email="c@test.com")
        db_session.add(user)
        # Producto (Stock 10)
        prod = Product(
            codigo_interno="PROD-STOCK",
            nombre="Con Stock",
            precio_neto=1000,
            controla_stock=True,
            stock_actual=10
        )
        db_session.add(prod)
        db_session.commit()

        # 2. Venta de 3 unidades
        sale_data = {
            "rut_cliente": "12345678-5",
            "tipo_dte": 33,
            "items": [
                {"product_id": prod.id, "cantidad": 3}
            ],
            "descripcion": "Venta con descuento de stock"
        }
        resp = client.post("/sales/", json=sale_data)
        assert resp.status_code == 201

        # 3. Verificar Stock
        db_session.refresh(prod)
        assert prod.stock_actual == 7

        # 4. Verificar Movimiento
        movement = db_session.query(StockMovement).filter_by(product_id=prod.id).first()
        assert movement is not None
        assert movement.tipo == "SALIDA"
        assert movement.motivo == "VENTA"
        assert movement.cantidad == 3

    def test_sale_insufficient_stock(self, client, db_session):
        # 1. Setup
        user = User(rut="12345678-5", razon_social="Cliente Test", email="c@test.com")
        db_session.add(user)
        prod = Product(
            codigo_interno="PROD-LOW",
            nombre="Poco Stock",
            precio_neto=1000,
            controla_stock=True,
            stock_actual=2
        )
        db_session.add(prod)
        db_session.commit()

        # 2. Intentar vender 3 unidades (hay 2)
        sale_data = {
            "rut_cliente": "12345678-5",
            "tipo_dte": 33,
            "items": [
                {"product_id": prod.id, "cantidad": 3}
            ],
        }
        resp = client.post("/sales/", json=sale_data)
        
        # 3. Validar Error
        assert resp.status_code == 409
        assert "Stock insuficiente" in resp.json()["detail"]

        # 4. Verificar que stock no cambió
        db_session.refresh(prod)
        assert prod.stock_actual == 2
        
        # 5. Verificar que NO hubo movimiento
        mov = db_session.query(StockMovement).filter_by(product_id=prod.id).first()
        assert mov is None
