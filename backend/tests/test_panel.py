"""Panel de inicio (`/reports/panel`) y variación de `/stats/summary`."""

from datetime import datetime, timedelta, timezone

from app.models.customer import Customer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.provider import Provider
from app.models.purchase import Purchase
from app.models.sale import Sale

EFECTIVO, CREDITO, TRANSFERENCIA = 1, 2, 3


def _vender(client, rut, medio=CREDITO):
    resp = client.post("/sales/", json={
        "rut_cliente": rut, "tipo_dte": 33,
        "items": [{"product_id": 1, "cantidad": "1"}],
        "payments": [{"payment_method_id": medio, "amount": "11900"}],
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _mover(db, sale_id, **delta):
    """SQLite guarda la fecha sin zona y en UTC, como `server_default=now()`."""
    db.get(Sale, sale_id).fecha_emision = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(**delta)


def test_panel(client, db_session):
    db_session.add_all([
        PaymentMethod(id=EFECTIVO, code="EFECTIVO", name="Efectivo"),
        PaymentMethod(id=CREDITO, code="CREDITO_INTERNO", name="Crédito interno"),
        PaymentMethod(id=TRANSFERENCIA, code="TRANSFERENCIA", name="Transferencia"),
        Customer(rut="12345678-5", razon_social="Al día", giro="G", direccion="D", comuna="C", dias_credito=30),
        Customer(rut="11111111-1", razon_social="Moroso", giro="G", direccion="D", comuna="C", dias_credito=30),
        Product(codigo_interno="P-1", nombre="Saco", precio_neto=10000),
        Provider(id=1, rut="76398956-9", razon_social="Proveedor"),
        Purchase(provider_id=1, tipo_documento="FACTURA", iva=500),
        Purchase(provider_id=1, tipo_documento="BOLETA", iva=300),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200

    # "Al día" debía una venta vieja y pagó una: lo que queda es la nueva, que no vence.
    vieja = _vender(client, "12345678-5")
    nueva = _vender(client, "12345678-5")
    _mover(db_session, vieja, days=45)
    assert client.post("/customers/12345678-5/pagos",
                       json={"amount": "11900", "payment_method_id": TRANSFERENCIA}).status_code == 201
    # "Moroso" fió hace 100 días con 30 de plazo: 70 días vencido.
    _mover(db_session, _vender(client, "11111111-1"), days=100)
    # Una venta al contado que el SII no contesta hace más de un día.
    sin_respuesta = _vender(client, "12345678-5", EFECTIVO)
    _mover(db_session, sin_respuesta, hours=30)  # holgura: SQLite compara UTC contra hora de Chile
    db_session.get(Sale, sin_respuesta).dte_estado = "ENVIADO"
    rechazada = db_session.get(Sale, nueva)
    rechazada.dte_estado, rechazada.dte_glosa = "RECHAZADO", "RUT receptor inválido"
    db_session.commit()

    panel = client.get("/reports/panel").json()

    assert panel["sii"]["estados"]["RECHAZADO"] == 1
    assert panel["sii"]["num_problemas"] == 2
    assert {(p["id"], p["estado"]) for p in panel["sii"]["problemas"]} == {
        (nueva, "RECHAZADO"), (sin_respuesta, "SIN_RESPUESTA")}

    iva = panel["iva"]
    assert iva["credito"] == 500  # la boleta de compra no da crédito
    assert iva["debito"] >= 1900
    assert iva["a_pagar"] == iva["debito"] - 500
    assert iva["vence"].endswith("-20")

    cobranza = panel["cobranza"]
    assert cobranza["total"] == 23800
    assert cobranza["vencido"] == 11900
    assert cobranza["tramos"] == {"al_dia": 11900, "1_30": 0, "31_60": 0, "61_mas": 11900}
    assert [(d["razon_social"], d["dias"]) for d in cobranza["deudores"]] == [("Moroso", 70)]
    assert cobranza["num_vencidos"] == 1

    assert len(panel["ventas_30_dias"]) == 30
    assert panel["ventas_30_dias"][-1]["total"] >= 11900

    # La venta de hace 45 días cae en el tramo anterior del período mensual.
    assert float(client.get("/stats/summary").json()["monthly"]["sales_total_prev"]) == 11900
