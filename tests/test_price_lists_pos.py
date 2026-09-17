import time
from decimal import Decimal

from app.models.customer import Customer
from app.models.dte import CAF
from app.models.issuer import Issuer
from app.models.payment import PaymentMethod
from app.models.price_list import PriceList, PriceListProduct
from app.models.product import Product


class TestPrecioPorListaEnVenta:
    """Issue #24: create_sale debe cobrar el precio de la lista del cliente,
    no `product.precio_neto`, cuando el producto tiene un precio fijo asignado."""

    def _setup_base(self, db_session):
        issuer = Issuer(
            rut="76123456-K", razon_social="Emisor Test", giro="Giro",
            acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce",
        )
        db_session.add(issuer)
        db_session.add(CAF(tipo_documento=33, folio_desde=1, folio_hasta=100, ultimo_folio_usado=0, xml_caf="DUMMY"))
        pm_cash = PaymentMethod(code="EFECTIVO", name="Efectivo")
        db_session.add(pm_cash)

        product = Product(
            codigo_interno="LP-PROD", nombre="Producto con lista",
            precio_neto=1000, controla_stock=False,
        )
        db_session.add(product)
        db_session.flush()
        return product, pm_cash

    def test_cliente_con_lista_paga_precio_fijo_no_precio_base(self, client, db_session):
        product, pm_cash = self._setup_base(db_session)

        price_list = PriceList(name="Mayorista")
        db_session.add(price_list)
        db_session.flush()
        db_session.add(PriceListProduct(price_list_id=price_list.id, product_id=product.id, fixed_price=Decimal("700")))

        customer = Customer(rut="12345678-5", razon_social="Cliente Lista", price_list_id=price_list.id)
        db_session.add(customer)
        db_session.commit()

        resp = client.post("/cash/open", json={"start_amount": 0})
        assert resp.status_code == 200
        time.sleep(1)

        # Total esperado: 700 neto + 19% IVA = 833, NO 1190 (precio base)
        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": product.id, "cantidad": 1}],
            "payments": [{"payment_method_id": pm_cash.id, "amount": 833}],
        })
        assert resp.status_code == 201, resp.text
        detail = resp.json()["details"][0]
        assert Decimal(detail["precio_unitario"]) == Decimal("700")
        assert Decimal(resp.json()["monto_total"]) == Decimal("833")

    def test_cliente_sin_lista_paga_precio_base(self, client, db_session):
        product, pm_cash = self._setup_base(db_session)
        customer = Customer(rut="12345678-5", razon_social="Cliente Sin Lista")
        db_session.add(customer)
        db_session.commit()

        resp = client.post("/cash/open", json={"start_amount": 0})
        assert resp.status_code == 200
        time.sleep(1)

        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": product.id, "cantidad": 1}],
            "payments": [{"payment_method_id": pm_cash.id, "amount": 1190}],
        })
        assert resp.status_code == 201, resp.text
        detail = resp.json()["details"][0]
        assert Decimal(detail["precio_unitario"]) == Decimal("1000")

    def test_producto_fuera_de_la_lista_cae_a_precio_base(self, client, db_session):
        product, pm_cash = self._setup_base(db_session)

        price_list = PriceList(name="Mayorista sin este producto")
        db_session.add(price_list)
        db_session.flush()

        customer = Customer(rut="12345678-5", razon_social="Cliente Lista Vacia", price_list_id=price_list.id)
        db_session.add(customer)
        db_session.commit()

        resp = client.post("/cash/open", json={"start_amount": 0})
        assert resp.status_code == 200
        time.sleep(1)

        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "items": [{"product_id": product.id, "cantidad": 1}],
            "payments": [{"payment_method_id": pm_cash.id, "amount": 1190}],
        })
        assert resp.status_code == 201, resp.text
        detail = resp.json()["details"][0]
        assert Decimal(detail["precio_unitario"]) == Decimal("1000")
