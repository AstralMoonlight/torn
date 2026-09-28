"""Historial: `GET /sales/` filtra por día o rango y busca en todas las fechas.

Antes traía solo las últimas 50 ventas y buscaba dentro de esas: una venta de
la semana pasada no aparecía para devolverla.
"""

from datetime import datetime

import pytest

from app.models.customer import Customer
from app.models.sale import Sale
from app.utils.dates import CHILE_TZ


@pytest.fixture
def ventas(db_session, admin_local_user):
    ana = Customer(rut="12345678-5", razon_social="Ana Pérez")
    ferre = Customer(rut="76398956-9", razon_social="Ferretería Sur")
    db_session.add_all([ana, ferre])
    db_session.flush()

    def venta(folio, cliente, dia, hora=12):
        db_session.add(Sale(
            folio=folio, tipo_dte=39, customer_id=cliente.id, user_id=admin_local_user.id,
            monto_total=1000, fecha_emision=datetime(2026, 9, dia, hora, tzinfo=CHILE_TZ),
        ))

    venta(101, ana, 1)
    venta(102, ferre, 20)
    venta(103, ana, 27, hora=23)  # tarde en Chile: ya es el 28 en UTC
    venta(104, ferre, 28, hora=1)
    db_session.commit()


def _folios(client, **params):
    resp = client.get("/sales/", params=params)
    assert resp.status_code == 200, resp.text
    return [v["folio"] for v in resp.json()]


def test_un_dia_en_hora_de_chile(client, ventas):
    assert _folios(client, desde="2026-09-27", hasta="2026-09-27") == [103]
    assert _folios(client, desde="2026-09-28", hasta="2026-09-28") == [104]


def test_rango_de_fechas(client, ventas):
    assert _folios(client, desde="2026-09-20", hasta="2026-09-28") == [104, 103, 102]


def test_la_busqueda_ignora_las_fechas(client, ventas):
    assert _folios(client, q="101", desde="2026-09-28", hasta="2026-09-28") == [101]
    assert _folios(client, q="ana") == [103, 101]
    assert _folios(client, q="76.398.956") == [104, 102]


def test_paginado(client, ventas):
    assert _folios(client, limit=2) == [104, 103]
    assert _folios(client, limit=2, skip=2) == [102, 101]
