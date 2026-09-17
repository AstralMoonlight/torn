"""Parseo de archivos CAF (Código de Autorización de Folios) del SII.

El CAF es el XML que el SII entrega al autorizar un rango de folios para un
tipo de documento; hoy se carga a mano (`scripts/setup_caf.py`,
`scripts/inject_folios.py`, ambos con contenido de relleno). Este módulo
extrae los datos reales de un archivo CAF genuino para el endpoint de carga
(`POST /folios/upload`).
"""

from dataclasses import dataclass
from datetime import date, timedelta
from xml.etree import ElementTree as ET


class CAFParseError(ValueError):
    """El contenido no es un CAF válido o le faltan campos obligatorios."""


@dataclass
class ParsedCAF:
    rut_emisor: str
    tipo_documento: int
    folio_desde: int
    folio_hasta: int
    fecha_autorizacion: date
    fecha_vencimiento: date


#: El SII no declara un vencimiento explícito dentro del CAF: en la práctica
#: el rango autorizado deja de emitirse válidamente a los 6 meses de la
#: fecha de autorización (`CAF.fecha_vencimiento`, ver `app/models/dte.py`).
VIGENCIA_DIAS = 180


def _require_text(element: ET.Element | None, campo: str) -> str:
    if element is None or not (element.text or "").strip():
        raise CAFParseError(f"El CAF no trae el campo <{campo}>")
    return element.text.strip()


def parse_caf_xml(xml_content: str) -> ParsedCAF:
    """Extrae los datos de un archivo CAF entregado por el SII.

    Args:
        xml_content: Contenido del archivo XML tal como lo entrega el SII
            (nodo raíz típicamente `<AUTORIZACION><CAF version="1.0">...`).

    Returns:
        Los datos ya tipados, con la vigencia calculada a partir de la
        fecha de autorización.

    Raises:
        CAFParseError: XML mal formado, o le faltan campos obligatorios
            (RE, TD, RNG/D, RNG/H, FA) o tienen un valor inválido.
    """
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as e:
        raise CAFParseError(f"El archivo no es un XML válido: {e}") from e

    rut_emisor = _require_text(root.find(".//RE"), "RE")
    tipo_documento_raw = _require_text(root.find(".//TD"), "TD")
    fecha_autorizacion_raw = _require_text(root.find(".//FA"), "FA")

    rng = root.find(".//RNG")
    if rng is None:
        raise CAFParseError("El CAF no trae el rango de folios (<RNG>)")
    folio_desde_raw = _require_text(rng.find("D"), "RNG/D")
    folio_hasta_raw = _require_text(rng.find("H"), "RNG/H")

    try:
        tipo_documento = int(tipo_documento_raw)
        folio_desde = int(folio_desde_raw)
        folio_hasta = int(folio_hasta_raw)
    except ValueError as e:
        raise CAFParseError(f"Valor numérico inválido en el CAF: {e}") from e

    if folio_hasta < folio_desde:
        raise CAFParseError(
            f"Rango de folios inválido en el CAF: {folio_desde}-{folio_hasta}"
        )

    try:
        fecha_autorizacion = date.fromisoformat(fecha_autorizacion_raw)
    except ValueError as e:
        raise CAFParseError(
            f"Fecha de autorización inválida en el CAF: '{fecha_autorizacion_raw}'"
        ) from e

    return ParsedCAF(
        rut_emisor=rut_emisor,
        tipo_documento=tipo_documento,
        folio_desde=folio_desde,
        folio_hasta=folio_hasta,
        fecha_autorizacion=fecha_autorizacion,
        fecha_vencimiento=fecha_autorizacion + timedelta(days=VIGENCIA_DIAS),
    )
