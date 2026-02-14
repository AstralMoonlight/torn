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
    """Genera el XML de un Documento Tributario Electrónico (DTE).

    Utiliza una plantilla Jinja2 para estructurar los datos de la venta,
    emisor y receptor en formato XML estándar del SII.

    Args:
        sale (Sale): Objeto de venta con sus detalles cargados.
        issuer (Issuer): Datos de la empresa emisora.
        customer (User): Datos del cliente receptor.

    Returns:
        str: Contenido XML renderizado (string).
    """
    template = _env.get_template("factura_template.xml")
    xml_str = template.render(
        sale=sale,
        issuer=issuer,
        customer=customer,
    )
    return xml_str
