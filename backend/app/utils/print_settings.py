"""Resolución del formato de impresión por tipo de documento.

Antes había un único `SystemSettings.print_format` global para todos los
documentos. Ahora cada tipo (los 6 DTE de venta más las compras) tiene su
propia entrada en `SystemSettings.print_formats`; `print_format` queda como
respaldo para cualquier tipo sin entrada explícita.
"""

from typing import Optional

#: Claves válidas para `SystemSettings.print_formats`, con su etiqueta legible.
#: "33".."61" son `Sale.tipo_dte`; "purchase" no es un DTE, es el comprobante
#: interno de `Purchase`.
DOCUMENT_TYPES: dict[str, str] = {
    "33": "Factura",
    "34": "Factura Exenta",
    "39": "Boleta",
    "41": "Boleta Exenta",
    "56": "Nota de Débito",
    "61": "Nota de Crédito",
    "purchase": "Compras (Comprobante Proveedor)",
}

DEFAULT_PRINT_FORMAT = "80mm"


def resolve_print_format(settings, doc_type_key: str) -> str:
    """Determina el formato de impresión a usar para un tipo de documento.

    Args:
        settings: Instancia de `SystemSettings` (puede ser `None`).
        doc_type_key: Clave en `DOCUMENT_TYPES` (p.ej. `str(sale.tipo_dte)` o `"purchase"`).

    Returns:
        `"80mm"` o `"carta"`.
    """
    if settings is None:
        return DEFAULT_PRINT_FORMAT

    formats = settings.print_formats or {}
    if doc_type_key in formats:
        return formats[doc_type_key]

    return settings.print_format or DEFAULT_PRINT_FORMAT
