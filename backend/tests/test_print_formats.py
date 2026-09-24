"""Formatos de impresión: el ticket térmico se adapta al ancho del rollo."""

from datetime import datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.routers.sales import _html_env
from app.schemas import SettingsUpdate
from app.utils.print_settings import PAPEL_TICKET_MM


def _render(template, tipo_dte=39, papel_mm=None):
    sale = SimpleNamespace(
        tipo_dte=tipo_dte, folio=1, fecha_emision=datetime(2026, 9, 24), details=[],
        monto_neto=1000, iva=190, monto_total=1190, ajuste_redondeo=0, vuelto=0,
    )
    return _html_env.get_template(template).render(
        papel_mm=papel_mm, sale=sale,
        issuer=SimpleNamespace(razon_social="X", rut="1-9", direccion="", comuna="", ciudad="", telefono=None),
        customer=SimpleNamespace(razon_social="Y", rut="1-9"),
    )


@pytest.mark.parametrize("formato, ancho", [("80mm", "72mm"), ("57mm", "49mm")])
def test_ticket_usa_ancho_del_rollo(formato, ancho):
    html = _render("factura_ticket.html", papel_mm=PAPEL_TICKET_MM[formato])
    assert f"size: {formato} auto" in html
    assert f"width: {ancho};" in html


@pytest.mark.parametrize("template", ["factura_ticket.html", "factura_carta.html"])
def test_documento_exento_no_imprime_iva(template):
    html = _render(template, tipo_dte=41, papel_mm=80)
    assert "BOLETA EXENTA ELECTRÓNICA" in html
    assert "IVA (19%)" not in html
    assert "Exento" in html or "EXENTO:" in html


def test_nota_de_credito_no_lleva_copia_cedible():
    assert "CEDIBLE" not in _render("factura_carta.html", tipo_dte=61)
    assert "CEDIBLE" in _render("factura_carta.html", tipo_dte=33)


def test_formato_desconocido_se_rechaza():
    SettingsUpdate(print_formats={"39": "57mm"})
    with pytest.raises(ValidationError):
        SettingsUpdate(print_formats={"39": "58mm"})
