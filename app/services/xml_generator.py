"""Servicio de generación de XML DTE usando Jinja2."""

import os
from pathlib import Path

from jinja2 import Environment, FileSystemLoader


# Directorio de plantillas — relativo al paquete app/
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "xml"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=False,  # XML, no HTML
    trim_blocks=True,
    lstrip_blocks=True,
)


def render_factura_xml(sale, issuer, customer) -> str:
    """
    Renderiza el XML de una factura electrónica.

    Args:
        sale: Objeto Sale (con details cargados).
        issuer: Objeto Issuer (datos del emisor).
        customer: Objeto User (datos del receptor).

    Returns:
        String con el XML del DTE.
    """
    template = _env.get_template("factura_template.xml")
    xml_str = template.render(
        sale=sale,
        issuer=issuer,
        customer=customer,
    )
    return xml_str
