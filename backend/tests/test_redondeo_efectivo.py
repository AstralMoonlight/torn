import time
from decimal import Decimal

from app.models.customer import Customer
from app.models.dte import CAF
from app.models.issuer import Issuer
from app.models.payment import PaymentMethod
from app.models.product import Product


class TestRedondeoEfectivo:
    """Issue #36: el redondeo a la decena en pagos en efectivo se aplica en el
    backend como un ajuste_redondeo, no como vuelto, y sólo sobre la porción
    pagada en efectivo."""

    def _setup(self, db_session, precio_neto):
        issuer = Issuer(
            rut="76123456-K", razon_social="Emisor Test", giro="Giro",
            acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce",
        )
        db_session.add(issuer)
        # tipo_dte 34 (Factura Exenta) para que total == precio_neto, sin IVA
        # de por medio, y así controlar el último dígito del total con precisión.
        db_session.add(CAF(tipo_documento=34, folio_desde=1, folio_hasta=1000, ultimo_folio_usado=0, xml_caf="DUMMY"))
        pm_cash = PaymentMethod(code="EFECTIVO", name="Efectivo")
        pm_card = PaymentMethod(code="DEBITO", name="Debito")
        db_session.add(pm_cash)
        db_session.add(pm_card)
        product = Product(codigo_interno="RED-PROD", nombre="Producto Redondeo", precio_neto=precio_neto, controla_stock=False)
        db_session.add(product)
        customer = Customer(rut="12345678-5", razon_social="Cliente Test")
        db_session.add(customer)
        db_session.commit()
        return product, pm_cash, pm_card

    def _open_cash(self, client, start_amount=0):
        resp = client.post("/cash/open", json={"start_amount": start_amount})
        assert resp.status_code == 200
        time.sleep(1)

    def _sell(self, client, product, pm, amount):
        return client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "tipo_dte": 34,
            "items": [{"product_id": product.id, "cantidad": 1}],
            "payments": [{"payment_method_id": pm.id, "amount": amount}],
        })

    def test_ultimo_digito_1_a_4_redondea_hacia_abajo(self, client, db_session):
        product, pm_cash, _ = self._setup(db_session, 1194)
        self._open_cash(client)
        resp = self._sell(client, product, pm_cash, 1190)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert Decimal(body["monto_total"]) == Decimal("1194")
        assert Decimal(body["ajuste_redondeo"]) == Decimal("-4")
        assert Decimal(body["vuelto"]) == Decimal("0")

    def test_ultimo_digito_5_redondea_hacia_arriba(self, client, db_session):
        product, pm_cash, _ = self._setup(db_session, 1195)
        self._open_cash(client)
        resp = self._sell(client, product, pm_cash, 1200)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert Decimal(body["ajuste_redondeo"]) == Decimal("5")
        assert Decimal(body["vuelto"]) == Decimal("0")

    def test_ultimo_digito_6_a_9_redondea_hacia_arriba(self, client, db_session):
        product, pm_cash, _ = self._setup(db_session, 1196)
        self._open_cash(client)
        resp = self._sell(client, product, pm_cash, 1200)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert Decimal(body["ajuste_redondeo"]) == Decimal("4")
        assert Decimal(body["vuelto"]) == Decimal("0")

    def test_monto_exacto_terminado_en_cero_no_ajusta(self, client, db_session):
        product, pm_cash, _ = self._setup(db_session, 1200)
        self._open_cash(client)
        resp = self._sell(client, product, pm_cash, 1200)
        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["ajuste_redondeo"]) == Decimal("0")

    def test_pago_100_por_ciento_tarjeta_no_redondea(self, client, db_session):
        product, _, pm_card = self._setup(db_session, 1194)
        self._open_cash(client)
        resp = self._sell(client, product, pm_card, 1194)
        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["ajuste_redondeo"]) == Decimal("0")

    def test_pago_mixto_solo_redondea_la_porcion_en_efectivo(self, client, db_session):
        product, pm_cash, pm_card = self._setup(db_session, 1194)
        self._open_cash(client)
        # Tarjeta cubre 1000 exacto; quedan 194 por cubrir en efectivo -> baja a 190.
        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "tipo_dte": 34,
            "items": [{"product_id": product.id, "cantidad": 1}],
            "payments": [
                {"payment_method_id": pm_card.id, "amount": 1000},
                {"payment_method_id": pm_cash.id, "amount": 190},
            ],
        })
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert Decimal(body["ajuste_redondeo"]) == Decimal("-4")
        assert Decimal(body["vuelto"]) == Decimal("0")

    def test_monto_redondeado_ya_no_es_rechazado(self, client, db_session):
        """Antes de este fix, el monto sugerido por el frontend (redondeado)
        quedaba por debajo del total exacto y el backend lo rechazaba con 400."""
        product, pm_cash, _ = self._setup(db_session, 1194)
        self._open_cash(client)
        resp = self._sell(client, product, pm_cash, 1190)
        assert resp.status_code == 201

    def test_arqueo_de_caja_cuadra_tras_varias_ventas_en_efectivo(self, client, db_session):
        product, pm_cash, _ = self._setup(db_session, 1194)
        self._open_cash(client, start_amount=5000)

        # 3 ventas idénticas, cada una paga el monto sugerido (redondeado a la baja).
        for _ in range(3):
            resp = self._sell(client, product, pm_cash, 1190)
            assert resp.status_code == 201, resp.text

        # Sistema esperado: 5000 + 3*1190 (cobrado) - 0 (sin vuelto) = 8570
        resp = client.post("/cash/close", json={"final_cash_declared": 8570})
        assert resp.status_code == 200
        data = resp.json()
        assert Decimal(data["final_cash_system"]) == Decimal("8570")
        assert Decimal(data["difference"]) == Decimal("0")
