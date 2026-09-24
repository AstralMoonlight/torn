"""Formatos de impresión: el ticket térmico se adapta al ancho del rollo."""

from datetime import datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.routers.sales import _html_env
from app.schemas import SettingsUpdate
from app.utils.print_settings import PAPEL_TICKET_MM


@pytest.mark.parametrize("formato, ancho", [("80mm", "72mm"), ("57mm", "49mm")])
def test_ticket_usa_ancho_del_rollo(formato, ancho):
    sale = SimpleNamespace(
        tipo_dte=39, folio=1, fecha_emision=datetime(2026, 9, 24), details=[],
        monto_neto=1000, iva=190, monto_total=1190, ajuste_redondeo=0, vuelto=0,
    )
    html = _html_env.get_template("factura_ticket.html").render(
        papel_mm=PAPEL_TICKET_MM[formato], sale=sale,
        issuer=SimpleNamespace(razon_social="X", rut="1-9", direccion="", comuna="", ciudad="", telefono=None),
        customer=SimpleNamespace(razon_social="Y", rut="1-9"),
    )
    assert f"size: {formato} auto" in html
    assert f"width: {ancho};" in html


def test_formato_desconocido_se_rechaza():
    SettingsUpdate(print_formats={"39": "57mm"})
    with pytest.raises(ValidationError):
        SettingsUpdate(print_formats={"39": "58mm"})
