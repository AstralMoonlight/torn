"""Emisión en dte-torn e IVA (DTE exento / impuesto por producto).

La aritmética de folios y CAF vive en dte-torn y se prueba allá. Acá:

* La venta toma el folio que asigna dte-torn y se revierte si no lo hay.
* El IVA era `Decimal("0.19")` fijo, así que una Boleta/Factura Exenta o un
  producto exento salían con 19% de impuesto.
* `quantize_money` redondeaba a centavos (2 decimales) en vez de al peso
  entero: un IVA por línea que no cerraba en un peso exacto (950 * 0.19 =
  180.50) dejaba el total con una fracción de peso que el frontend —que
  siempre trabaja en pesos enteros— nunca podía igualar. Con efectivo el
  redondeo a la decena lo disimulaba; con cualquier otro medio de pago,
  que exige el monto exacto, la venta se rechazaba con un vuelto fantasma
  de unos centavos ("El vuelto ($0.50) no puede superar el efectivo
  recibido ($0)").
"""

from decimal import Decimal

import pytest

from app.models.customer import Customer
from app.models.issuer import Issuer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.sale import Sale
from app.models.tax import Tax
from app.services import dte_client


@pytest.fixture
def entorno_venta(client, db_session):
    """Emisor, cliente, medio de pago y caja abierta."""
    db_session.add(
        Issuer(
            rut="76123456-K", razon_social="Emisor Test", giro="Giro",
            acteco="123", direccion="Dir", comuna="Conce", ciudad="Conce",
        )
    )
    db_session.add(
        Customer(rut="12345678-5", razon_social="Cliente Test", email="c@test.com")
    )
    db_session.add(PaymentMethod(code="EFECTIVO", name="Efectivo"))
    db_session.commit()

    resp = client.post("/cash/open", json={"start_amount": 10000})
    assert resp.status_code == 200, resp.text
    return db_session


def _vender(client, product_id, tipo_dte, monto, cantidad=1):
    return client.post("/sales/", json={
        "rut_cliente": "12345678-5",
        "tipo_dte": tipo_dte,
        "items": [{"product_id": product_id, "cantidad": str(cantidad)}],
        "payments": [{"payment_method_id": 1, "amount": str(monto)}],
    })


class TestEmisionEnDte:
    """El folio lo asigna dte-torn; si rechaza o no responde, la venta no existe."""

    def test_el_folio_viene_de_dte_torn(self, client, entorno_venta, fake_dte):
        db = entorno_venta
        prod = Product(codigo_interno="P-1", nombre="Producto", precio_neto=1000)
        db.add(prod)
        db.commit()

        folios = [_vender(client, prod.id, 33, 1190).json()["folio"] for _ in range(2)]
        assert folios == [1, 2]
        assert fake_dte.documentos[0]["external_id"] != fake_dte.documentos[1]["external_id"]
        assert fake_dte.documentos[0]["receptor"]["rut"] == "12345678-5"

    @pytest.mark.parametrize("error, codigo", [
        (dte_client.DteError(409, "Sin folios disponibles para el tipo 33"), 409),
        (dte_client.DteNoDisponible("no respondió"), 503),
    ])
    def test_rechazo_de_dte_torn_revierte_la_venta(self, client, entorno_venta, fake_dte, error, codigo):
        db = entorno_venta
        prod = Product(codigo_interno="P-2", nombre="Producto", precio_neto=1000,
                       controla_stock=True, stock_actual=5)
        db.add(prod)
        db.commit()
        fake_dte.error = error

        resp = _vender(client, prod.id, 33, 1190)
        assert resp.status_code == codigo, resp.text
        db.expire_all()
        assert db.query(Sale).count() == 0
        assert db.get(Product, prod.id).stock_actual == 5

    def test_boleta_manda_precio_bruto_y_cobra_la_suma_de_lineas(self, client, entorno_venta, fake_dte):
        """950 neto -> 1.131 bruto por unidad (1.130,5 redondeado). Dos unidades
        en líneas distintas suman 2.262, que es lo que declara el DTE; el cálculo
        antiguo (IVA sobre el neto total) daba 2.261."""
        db = entorno_venta
        a = Product(codigo_interno="B-1", nombre="A", precio_neto=950)
        b = Product(codigo_interno="B-2", nombre="B", precio_neto=950)
        db.add_all([a, b])
        db.commit()

        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5", "tipo_dte": 39,
            "items": [{"product_id": a.id, "cantidad": "1"}, {"product_id": b.id, "cantidad": "1"}],
            "payments": [{"payment_method_id": 1, "amount": "2270"}],
        })
        assert resp.status_code == 201, resp.text
        assert [i["precio"] for i in fake_dte.documentos[0]["items"]] == ["1131", "1131"]
        assert "receptor" not in fake_dte.documentos[0]
        venta = resp.json()
        assert Decimal(venta["monto_total"]) == 2262
        assert Decimal(venta["iva"]) == 361        # 2262 - round(2262 / 1,19)

    def test_producto_con_impuesto_no_soportado_se_rechaza_sin_emitir(self, client, entorno_venta, fake_dte):
        db = entorno_venta
        ila = Tax(name="ILA", rate=Decimal("0.315"))
        db.add(ila)
        db.flush()
        prod = Product(codigo_interno="P-ILA", nombre="Destilado", precio_neto=1000, tax_id=ila.id)
        db.add(prod)
        db.commit()

        resp = _vender(client, prod.id, 33, 2000)
        assert resp.status_code == 422, resp.text
        assert fake_dte.documentos == []


class TestIvaPorDocumentoYProducto:
    """El IVA depende del tipo de DTE y del impuesto del producto."""

    def test_boleta_exenta_no_lleva_iva(self, client, entorno_venta):
        db = entorno_venta
        prod = Product(codigo_interno="P-EX", nombre="Producto", precio_neto=1000)
        db.add(prod)
        db.commit()

        resp = _vender(client, prod.id, 41, 1000)
        assert resp.status_code == 201, resp.text
        venta = resp.json()
        assert Decimal(venta["iva"]) == Decimal("0")
        assert Decimal(venta["monto_total"]) == Decimal("1000.00")

    def test_factura_afecta_lleva_iva(self, client, entorno_venta):
        db = entorno_venta
        prod = Product(codigo_interno="P-AF", nombre="Producto", precio_neto=1000)
        db.add(prod)
        db.commit()

        resp = _vender(client, prod.id, 33, 1190)
        assert resp.status_code == 201, resp.text
        venta = resp.json()
        assert Decimal(venta["iva"]) == Decimal("190.00")
        assert Decimal(venta["monto_total"]) == Decimal("1190.00")

    def test_producto_exento_no_paga_iva_en_documento_afecto(self, client, entorno_venta):
        db = entorno_venta
        exento = Tax(name="Exento", rate=Decimal("0"))
        db.add(exento)
        db.flush()
        prod = Product(
            codigo_interno="P-TAX0", nombre="Producto Exento",
            precio_neto=1000, tax_id=exento.id,
        )
        db.add(prod)
        db.commit()

        resp = _vender(client, prod.id, 33, 1000)
        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["iva"]) == Decimal("0")


class TestRedondeoAPesoEntero:
    """quantize_money debe cerrar en pesos enteros, no en centavos (#42)."""

    def test_quantize_money_redondea_a_peso_no_a_centavo(self):
        from app.utils.taxes import quantize_money
        # 950 * 0.19 = 180.50: el caso exacto que rechazaba las ventas con
        # cualquier medio de pago que no fuera efectivo.
        assert quantize_money(Decimal("180.50")) == Decimal("181")
        assert quantize_money(Decimal("180.49")) == Decimal("180")
        assert quantize_money(Decimal("180.00")) == Decimal("180")

    def test_venta_con_iva_fraccionario_acepta_pago_exacto_no_efectivo(self, client, entorno_venta):
        """Un producto cuyo IVA por línea no cierra en un peso exacto debe
        poder pagarse con Débito por el monto justo, sin vuelto fantasma."""
        db = entorno_venta
        db.add(PaymentMethod(code="DEBITO", name="Débito"))
        # neto 950 -> iva 180.50 -> total exacto 1130.50, que antes del fix
        # quedaba en 1130.50 (centavos) en vez de 1131 (peso entero).
        prod = Product(codigo_interno="P-FRAC", nombre="Producto Fraccionario", precio_neto=950)
        db.add(prod)
        db.commit()

        debito_id = db.query(PaymentMethod).filter(PaymentMethod.code == "DEBITO").first().id

        resp = client.post("/sales/", json={
            "rut_cliente": "12345678-5",
            "tipo_dte": 39,
            "items": [{"product_id": prod.id, "cantidad": "1"}],
            "payments": [{"payment_method_id": debito_id, "amount": "1131"}],
        })
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert Decimal(body["monto_total"]) == Decimal("1131")
        assert Decimal(body["vuelto"]) == Decimal("0")
