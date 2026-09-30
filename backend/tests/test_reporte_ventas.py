"""Reporte de ventas (`/stats/report`): margen con descuentos, lo cobrado por medio
de pago sin el vuelto, y la comparación con el periodo anterior."""

from datetime import datetime

from app.models.customer import Customer
from app.models.payment import PaymentMethod
from app.models.product import Product
from app.models.sale import Sale

EFECTIVO, DEBITO = 1, 2


def _vender(client, items, pagos, **extra):
    resp = client.post("/sales/", json={
        "rut_cliente": "12345678-5", "tipo_dte": 33, "items": items,
        "payments": [{"payment_method_id": m, "amount": a} for m, a in pagos], **extra,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_reporte_de_un_dia(client, db_session):
    db_session.add_all([
        PaymentMethod(id=EFECTIVO, code="EFECTIVO", name="Efectivo"),
        PaymentMethod(id=DEBITO, code="DEBITO", name="Débito"),
        Customer(rut="12345678-5", razon_social="Ferretería", giro="G", direccion="D", comuna="C"),
        Product(codigo_interno="S-1", nombre="Saco", precio_neto=1000, costo_unitario=600),
    ])
    db_session.commit()
    assert client.post("/cash/open", json={"start_amount": 0}).status_code == 200

    # 2 sacos: 2.000 - 200 en la línea - 180 al total = 1.620 neto, 1.928 con IVA.
    # En efectivo se cobra 1.930 (redondeo) y se paga con 2.000: 70 de vuelto.
    hoy = _vender(client, [{"product_id": 1, "cantidad": "2", "descuento": "200"}], [(EFECTIVO, "2000")],
                  descuento_global={"valor": "180", "porcentaje": False})
    ayer = _vender(client, [{"product_id": 1, "cantidad": "1"}], [(DEBITO, "1190")])
    # SQLite guarda la hora en UTC y sin zona: 15:00 UTC es media mañana en Chile.
    db_session.get(Sale, hoy).fecha_emision = datetime(2026, 8, 15, 15)
    db_session.get(Sale, ayer).fecha_emision = datetime(2026, 8, 14, 15)
    db_session.commit()

    r = client.get("/stats/report", params={"desde": "2026-08-15"}).json()
    assert (r["desde"], r["hasta"], r["agrupacion"]) == ("2026-08-15", "2026-08-15", "hora")
    res = r["resumen"]
    assert (res["neto"], res["venta_total"], res["num_ventas"]) == (1620, 1928, 1)
    assert (res["costo"], res["margen"], res["descuentos"]) == (1200, 420, 380)

    # El producto suma lo mismo que la venta: el descuento al total se reparte.
    [saco] = r["productos"]
    assert (saco["codigo"], saco["cantidad"], saco["venta"], saco["margen"]) == ("S-1", 2, 1620, 420)

    assert r["medios_pago"] == [{"codigo": "EFECTIVO", "nombre": "Efectivo", "num": 1, "total": 1930}]
    assert r["documentos"] == [{"tipo_dte": 33, "num": 1, "neto": 1620, "iva": 308, "total": 1928}]
    assert r["clientes"] == [{"rut": "12345678-5", "razon_social": "Ferretería", "num": 1, "total": 1928}]
    [vendedor] = r["vendedores"]
    assert (vendedor["num"], vendedor["margen"]) == (1, 420)
    assert sum(p["total"] for p in r["serie"]) == 1928

    # Se compara con el día anterior completo (ya pasó).
    ant = r["anterior"]
    assert (ant["desde"], ant["hasta"], ant["venta_total"], ant["num_ventas"]) == ("2026-08-14", "2026-08-14", 1190, 1)


def test_un_mes_se_compara_con_el_mes_anterior(client, db_session):
    r = client.get("/stats/report", params={"desde": "2026-03-01", "hasta": "2026-03-31"}).json()
    assert (r["anterior"]["desde"], r["anterior"]["hasta"]) == ("2026-02-01", "2026-02-28")
    assert r["agrupacion"] == "dia" and len(r["serie"]) == 31

    # Dos meses contra los dos anteriores; el año contra el mismo tramo del año pasado.
    r = client.get("/stats/report", params={"desde": "2026-03-01", "hasta": "2026-04-30"}).json()
    assert (r["anterior"]["desde"], r["anterior"]["hasta"]) == ("2026-01-01", "2026-02-28")
    r = client.get("/stats/report", params={"desde": "2026-01-01", "hasta": "2026-06-30"}).json()
    assert (r["anterior"]["desde"], r["anterior"]["hasta"]) == ("2025-01-01", "2025-06-30")
    assert r["agrupacion"] == "mes" and [p["clave"] for p in r["serie"]][::5] == ["2026-01", "2026-06"]
