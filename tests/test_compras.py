"""Tests de compras, centrados en el cálculo del IVA.

El impuesto se tomaba de una constante (`total_neto * Decimal("0.19")` cuando el
documento era FACTURA), ignorando el `Tax` configurado en cada producto. Un
producto exento sumaba IVA igual.
"""

from decimal import Decimal

import pytest

from app.models.product import Product
from app.models.provider import Provider
from app.models.tax import Tax


@pytest.fixture
def proveedor(db_session):
    p = Provider(rut="76123456-0", razon_social="Proveedor Test")
    db_session.add(p)
    db_session.commit()
    return p


def _comprar(client, provider_id, product_id, tipo_documento, costo, cantidad=1):
    return client.post("/purchases/", json={
        "provider_id": provider_id,
        "folio": "1",
        "tipo_documento": tipo_documento,
        "items": [{
            "product_id": product_id,
            "cantidad": str(cantidad),
            "precio_costo_unitario": str(costo),
        }],
    })


class TestIvaDeCompras:
    def test_factura_aplica_el_iva_del_producto(self, client, db_session, proveedor):
        prod = Product(codigo_interno="C-1", nombre="Insumo", precio_neto=1000)
        db_session.add(prod)
        db_session.commit()

        resp = _comprar(client, proveedor.id, prod.id, "FACTURA", 1000)
        assert resp.status_code == 201, resp.text
        compra = resp.json()
        assert Decimal(compra["iva"]) == Decimal("190.00")
        assert Decimal(compra["monto_total"]) == Decimal("1190.00")

    def test_producto_exento_no_suma_iva_en_factura(self, client, db_session, proveedor):
        exento = Tax(name="Exento", rate=Decimal("0"))
        db_session.add(exento)
        db_session.flush()
        prod = Product(
            codigo_interno="C-EX", nombre="Insumo Exento",
            precio_neto=1000, tax_id=exento.id,
        )
        db_session.add(prod)
        db_session.commit()

        resp = _comprar(client, proveedor.id, prod.id, "FACTURA", 1000)
        assert resp.status_code == 201, resp.text
        compra = resp.json()
        assert Decimal(compra["iva"]) == Decimal("0")
        assert Decimal(compra["monto_total"]) == Decimal("1000.00")

    def test_boleta_no_registra_iva(self, client, db_session, proveedor):
        prod = Product(codigo_interno="C-2", nombre="Insumo", precio_neto=1000)
        db_session.add(prod)
        db_session.commit()

        resp = _comprar(client, proveedor.id, prod.id, "BOLETA", 1000)
        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["iva"]) == Decimal("0")

    def test_sin_documento_no_registra_iva(self, client, db_session, proveedor):
        prod = Product(codigo_interno="C-3", nombre="Insumo", precio_neto=1000)
        db_session.add(prod)
        db_session.commit()

        resp = _comprar(client, proveedor.id, prod.id, "SIN_DOCUMENTO", 1000)
        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["iva"]) == Decimal("0")

    def test_compra_mixta_suma_solo_el_impuesto_de_lo_afecto(self, client, db_session, proveedor):
        exento = Tax(name="Exento", rate=Decimal("0"))
        db_session.add(exento)
        db_session.flush()
        afecto = Product(codigo_interno="C-A", nombre="Afecto", precio_neto=1000)
        libre = Product(
            codigo_interno="C-B", nombre="Exento",
            precio_neto=1000, tax_id=exento.id,
        )
        db_session.add_all([afecto, libre])
        db_session.commit()

        resp = client.post("/purchases/", json={
            "provider_id": proveedor.id,
            "folio": "2",
            "tipo_documento": "FACTURA",
            "items": [
                {"product_id": afecto.id, "cantidad": "1", "precio_costo_unitario": "1000"},
                {"product_id": libre.id, "cantidad": "1", "precio_costo_unitario": "1000"},
            ],
        })
        assert resp.status_code == 201, resp.text
        compra = resp.json()
        # Sólo la línea afecta paga impuesto.
        assert Decimal(compra["monto_neto"]) == Decimal("2000.00")
        assert Decimal(compra["iva"]) == Decimal("190.00")
        assert Decimal(compra["monto_total"]) == Decimal("2190.00")
