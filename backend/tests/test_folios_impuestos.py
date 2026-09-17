"""Regresiones de folios (rango CAF) e IVA (DTE exento / impuesto por producto).

Cubren tres defectos que estaban en producción:

* El folio emitido se calculaba como `ultimo_folio_usado + 1`, ignorando
  `folio_desde`. Un CAF autorizado de 1000 a 1100 emitía su primer documento con
  folio 1, fuera del rango autorizado por el SII.
* `GET /folios/status` informaba `available = folio_hasta - ultimo_folio_usado`,
  por lo que un CAF recién cargado declaraba muchos más folios de los reales.
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
from app.models.dte import CAF
from app.models.issuer import Issuer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.tax import Tax


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


class TestRangoDeFolios:
    """El folio emitido debe caer siempre dentro del rango del CAF."""

    def test_primer_folio_respeta_folio_desde(self, client, entorno_venta):
        db = entorno_venta
        db.add(CAF(
            tipo_documento=33, folio_desde=1000, folio_hasta=1100,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
        prod = Product(codigo_interno="P-1", nombre="Producto", precio_neto=1000)
        db.add(prod)
        db.commit()

        resp = _vender(client, prod.id, 33, 1190)
        assert resp.status_code == 201, resp.text
        assert resp.json()["folio"] == 1000, "El primer folio debe ser folio_desde"

    def test_folios_correlativos_dentro_del_rango(self, client, entorno_venta):
        db = entorno_venta
        db.add(CAF(
            tipo_documento=33, folio_desde=1000, folio_hasta=1100,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
        prod = Product(codigo_interno="P-2", nombre="Producto", precio_neto=1000)
        db.add(prod)
        db.commit()

        folios = [_vender(client, prod.id, 33, 1190).json()["folio"] for _ in range(3)]
        assert folios == [1000, 1001, 1002]

    def test_status_no_infla_los_folios_disponibles(self, client, entorno_venta):
        db = entorno_venta
        db.add(CAF(
            tipo_documento=33, folio_desde=1000, folio_hasta=1100,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
        db.commit()

        resp = client.get("/folios/status")
        assert resp.status_code == 200, resp.text
        caf_33 = next(f for f in resp.json() if f["dte_type"] == 33)
        assert caf_33["total"] == 101
        assert caf_33["available"] == 101, "Un CAF sin usar tiene disponible == total"

    def test_venta_sin_caf_es_rechazada(self, client, entorno_venta):
        db = entorno_venta
        prod = Product(codigo_interno="P-3", nombre="Producto", precio_neto=1000)
        db.add(prod)
        db.commit()

        resp = _vender(client, prod.id, 33, 1190)
        assert resp.status_code == 409
        assert "folios disponibles" in resp.json()["detail"]


class TestIvaPorDocumentoYProducto:
    """El IVA depende del tipo de DTE y del impuesto del producto."""

    def test_boleta_exenta_no_lleva_iva(self, client, entorno_venta):
        db = entorno_venta
        db.add(CAF(
            tipo_documento=41, folio_desde=1, folio_hasta=100,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
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
        db.add(CAF(
            tipo_documento=33, folio_desde=1, folio_hasta=100,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
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
        db.add(CAF(
            tipo_documento=33, folio_desde=1, folio_hasta=100,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
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


class TestMultiplesCafPorTipo:
    """Un inquilino acumula varios CAF del mismo tipo conforme el SII autoriza folios."""

    def test_la_emision_salta_al_siguiente_caf_al_agotarse(self, client, entorno_venta):
        db = entorno_venta
        db.add(CAF(
            tipo_documento=33, folio_desde=10, folio_hasta=11,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
        db.add(CAF(
            tipo_documento=33, folio_desde=900, folio_hasta=910,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
        prod = Product(codigo_interno="P-MULTI", nombre="Producto", precio_neto=1000)
        db.add(prod)
        db.commit()

        folios = [_vender(client, prod.id, 33, 1190).json()["folio"] for _ in range(3)]
        assert folios == [10, 11, 900], "Agotado el primer CAF debe continuar en el segundo"

    def test_el_status_suma_todos_los_caf_del_tipo(self, client, entorno_venta):
        db = entorno_venta
        db.add(CAF(
            tipo_documento=33, folio_desde=10, folio_hasta=11,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
        db.add(CAF(
            tipo_documento=33, folio_desde=900, folio_hasta=910,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
        db.commit()

        caf_33 = next(f for f in client.get("/folios/status").json() if f["dte_type"] == 33)
        assert caf_33["total"] == 13          # 2 + 11
        assert caf_33["available"] == 13
        assert caf_33["latest_folio_desde"] == 900
        assert caf_33["latest_folio_hasta"] == 910


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
        db.add(CAF(
            tipo_documento=39, folio_desde=1, folio_hasta=100,
            ultimo_folio_usado=0, xml_caf="DUMMY",
        ))
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
