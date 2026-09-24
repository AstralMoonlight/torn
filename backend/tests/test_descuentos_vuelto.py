import time
from decimal import Decimal

from app.models.customer import Customer
from app.models.issuer import Issuer
from app.models.payment import PaymentMethod
from app.models.product import Product


class TestDescuentoPorLinea:
    """Issue #27: SaleDetail.descuento debe poder recibirse y refleja el total."""

    def _setup_base(self, db_session):
        issuer = Issuer(
            rut="76123456-K", razon_social="Emisor Test", giro="Giro",
            acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce",
        )
        db_session.add(issuer)
        pm_cash = PaymentMethod(code="EFECTIVO", name="Efectivo")
        db_session.add(pm_cash)
        product = Product(codigo_interno="DESC-PROD", nombre="Producto Descuento", precio_neto=1000, controla_stock=False)
        db_session.add(product)
        customer = Customer(rut="12345678-5", razon_social="Cliente Test")
        db_session.add(customer)
        db_session.commit()
        return product, pm_cash

    def _open_cash(self, client, start_amount=0):
        resp = client.post("/cash/open", json={"start_amount": start_amount})
        assert resp.status_code == 200
        time.sleep(1)

    def test_descuento_se_resta_del_total(self, client, db_session):
        product, pm_cash = self._setup_base(db_session)
        self._open_cash(client)

        # Neto: 1000 - 200 = 800; IVA 19% = 152; total = 952
        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": product.id, "cantidad": 1, "descuento": 200}],
            "payments": [{"payment_method_id": pm_cash.id, "amount": 952}],
        })
        assert resp.status_code == 201, resp.text
        body = resp.json()
        detail = body["details"][0]
        assert Decimal(detail["descuento"]) == Decimal("200")
        assert Decimal(detail["subtotal"]) == Decimal("800")
        assert Decimal(body["monto_total"]) == Decimal("952")

    def test_descuento_mayor_al_subtotal_es_rechazado(self, client, db_session):
        product, pm_cash = self._setup_base(db_session)
        self._open_cash(client)

        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": product.id, "cantidad": 1, "descuento": 5000}],
            "payments": [{"payment_method_id": pm_cash.id, "amount": 0}],
        })
        assert resp.status_code == 400
        assert "descuento" in resp.json()["detail"].lower()

    def test_descuento_negativo_es_rechazado_por_schema(self, client, db_session):
        product, pm_cash = self._setup_base(db_session)
        self._open_cash(client)

        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": product.id, "cantidad": 1, "descuento": -1}],
            "payments": [{"payment_method_id": pm_cash.id, "amount": 1190}],
        })
        assert resp.status_code == 422


class TestVuelto:
    """Issue #27 / #36: el vuelto se registra y descuenta del efectivo esperado en caja."""

    def _setup_base(self, db_session):
        issuer = Issuer(
            rut="76123456-K", razon_social="Emisor Test", giro="Giro",
            acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce",
        )
        db_session.add(issuer)
        pm_cash = PaymentMethod(code="EFECTIVO", name="Efectivo")
        pm_card = PaymentMethod(code="DEBITO", name="Debito")
        db_session.add(pm_cash)
        db_session.add(pm_card)
        product = Product(codigo_interno="VUELTO-PROD", nombre="Producto Vuelto", precio_neto=1000, controla_stock=False)
        db_session.add(product)
        customer = Customer(rut="12345678-5", razon_social="Cliente Test")
        db_session.add(customer)
        db_session.commit()
        return product, pm_cash, pm_card

    def test_pago_en_exceso_registra_vuelto(self, client, db_session):
        product, pm_cash, _ = self._setup_base(db_session)
        resp = client.post("/cash/open", json={"start_amount": 10000})
        assert resp.status_code == 200
        time.sleep(1)

        # Total = 1190. Paga 2000 en efectivo -> vuelto 810.
        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": product.id, "cantidad": 1}],
            "payments": [{"payment_method_id": pm_cash.id, "amount": 2000}],
        })
        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["vuelto"]) == Decimal("810")

        # Arqueo: 10000 (inicio) + 2000 (cobrado) - 810 (vuelto) = 11190
        resp = client.post("/cash/close", json={"final_cash_declared": 11190})
        assert resp.status_code == 200
        data = resp.json()
        assert Decimal(data["final_cash_system"]) == Decimal(11190)
        assert Decimal(data["difference"]) == 0

    def test_vuelto_sin_efectivo_suficiente_es_rechazado(self, client, db_session):
        product, pm_cash, pm_card = self._setup_base(db_session)
        resp = client.post("/cash/open", json={"start_amount": 0})
        assert resp.status_code == 200
        time.sleep(1)

        # Total 1190, paga 100 en efectivo + 2000 en tarjeta = 2100 (excede en 910)
        # pero sólo hay 100 en efectivo: no se puede dar 910 de vuelto.
        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": product.id, "cantidad": 1}],
            "payments": [
                {"payment_method_id": pm_cash.id, "amount": 100},
                {"payment_method_id": pm_card.id, "amount": 2000},
            ],
        })
        assert resp.status_code == 400
        assert "vuelto" in resp.json()["detail"].lower()

    def test_pago_exacto_no_registra_vuelto(self, client, db_session):
        product, pm_cash, _ = self._setup_base(db_session)
        resp = client.post("/cash/open", json={"start_amount": 0})
        assert resp.status_code == 200
        time.sleep(1)

        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": product.id, "cantidad": 1}],
            "payments": [{"payment_method_id": pm_cash.id, "amount": 1190}],
        })
        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["vuelto"]) == Decimal("0")
