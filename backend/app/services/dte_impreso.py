"""Tickets de 57/80 mm armados desde el XML firmado que entrega dte-torn.

Lo impreso tiene que ser exactamente lo que recibió el SII, así que los datos
salen del `<DTE>` firmado y no de la venta, y el PDF417 lleva el `<TED>`
recortado byte a byte del XML. Misma regla que `dte-torn/app/dte/pdf.py`, que
arma la versión carta.
"""

import re
import xml.etree.ElementTree as ET

import pdf417gen

NS = {"s": "http://www.sii.cl/SiiDte"}
_TED = re.compile(rb"<TED[ >].*?</TED>", re.S)

NOMBRES = {
    33: "FACTURA ELECTRÓNICA",
    34: "FACTURA NO AFECTA O EXENTA ELECTRÓNICA",
    39: "BOLETA ELECTRÓNICA",
    41: "BOLETA NO AFECTA O EXENTA ELECTRÓNICA",
    56: "NOTA DE DÉBITO ELECTRÓNICA",
    61: "NOTA DE CRÉDITO ELECTRÓNICA",
}
#: Facturas: llevan copia cedible con acuse de recibo (Ley 19.983).
CEDIBLES = frozenset({33, 34})
CODIGOS_REFERENCIA = {"1": "Anula documento", "2": "Corrige texto", "3": "Corrige montos"}

#: Nivel de corrección de errores del PDF417 que pide el SII.
NIVEL_CORRECCION_TIMBRE = 5
#: Timbre por ancho de rollo: (columnas de datos del PDF417, alto en mm). Ocupa
#: todo el ancho imprimible y siempre el mismo alto, en la copia cliente y en la
#: cedible. Con un TED típico (~1 KB) queda cada módulo de ~0,21-0,23 mm de ancho
#: y cada fila de 2,2-2,5 veces eso: más columnas = más bajo, pero barras más
#: finas para una térmica de 203 dpi (0,125 mm por punto).
# ponytail: calibrado leyendo en pantalla; confirmar con un lector sobre papel real.
TIMBRE = {80: (14, 28), 57: (10, 30)}

#: Firma del software al final del documento impreso.
LEYENDA_PIE = "Factureando.cl: Hazla simple!"


def _hijos(nodo) -> dict[str, str]:
    if nodo is None:
        return {}
    return {hijo.tag.split("}", 1)[1]: (hijo.text or "").strip() for hijo in nodo if len(hijo) == 0}


def leer_dte(xml: bytes) -> dict:
    """Lo que va impreso, leído del XML firmado."""
    raiz = ET.fromstring(xml)
    doc = raiz.find(".//s:Documento", NS)
    if doc is None:
        raise ValueError("El XML no trae un <Documento>")
    id_doc = _hijos(doc.find("s:Encabezado/s:IdDoc", NS))
    emisor = _hijos(doc.find("s:Encabezado/s:Emisor", NS))
    # Boletas y facturas nombran distinto la razón social y el giro del emisor.
    emisor.setdefault("RznSoc", emisor.get("RznSocEmisor", ""))
    emisor.setdefault("GiroEmis", emisor.get("GiroEmisor", ""))
    ted = _TED.search(xml)
    if ted is None:
        raise ValueError("El XML no trae el timbre <TED>")
    tipo = int(id_doc["TipoDTE"])
    return {
        "tipo": tipo,
        "nombre": NOMBRES.get(tipo, f"DOCUMENTO {tipo}"),
        "folio": int(id_doc["Folio"]),
        "fecha": id_doc.get("FchEmis", ""),
        "emisor": emisor,
        "receptor": _hijos(doc.find("s:Encabezado/s:Receptor", NS)),
        "totales": _hijos(doc.find("s:Encabezado/s:Totales", NS)),
        "lineas": [
            {**_hijos(det), "codigo": det.findtext("s:CdgItem/s:VlrCodigo", "", NS)}
            for det in doc.findall("s:Detalle", NS)
        ],
        "descuentos": [_hijos(n) for n in doc.findall("s:DscRcgGlobal", NS)],
        "referencias": [
            {**r, "motivo": CODIGOS_REFERENCIA.get(r.get("CodRef", ""), "")}
            for r in (_hijos(n) for n in doc.findall("s:Referencia", NS))
        ],
        "ted": ted.group(0),
    }


def codigos_timbre(ted: bytes, papel_mm: int) -> list[list[int]]:
    """PDF417 del TED. Si el timbre no cabe en 90 filas, se agregan columnas."""
    columnas = TIMBRE.get(papel_mm, TIMBRE[80])[0]
    while True:
        try:
            return pdf417gen.encode(ted, columns=columnas, security_level=NIVEL_CORRECCION_TIMBRE)
        except ValueError:
            if columnas >= 30:
                raise
            columnas += 2


def timbre_svg(ted: bytes, papel_mm: int) -> str:
    """El PDF417 como SVG vectorial: una barra por tramo de módulos contiguos.

    Todo el ancho disponible y alto fijo (`TIMBRE`): el SVG se estira sin
    conservar la proporción, así que el alto no depende del largo del TED."""
    codigos = codigos_timbre(ted, papel_mm)
    filas = ["".join(format(valor, "b") for valor in fila) for fila in codigos]
    barras = "".join(
        f'<rect x="{m.start()}" y="{n}" width="{m.end() - m.start()}" height="1"/>'
        for n, bits in enumerate(filas)
        for m in re.finditer("1+", bits)
    )
    alto_mm = TIMBRE.get(papel_mm, TIMBRE[80])[1]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {len(filas[0])} {len(filas)}" '
        f'width="100%" height="{alto_mm}mm" preserveAspectRatio="none" '
        f'shape-rendering="crispEdges">{barras}</svg>'
    )


def formatear_rut(rut: str) -> str:
    """`76398956-9` -> `76.398.956-9`."""
    cuerpo, _, dv = rut.replace(".", "").partition("-")
    return f"{int(cuerpo):,}".replace(",", ".") + f"-{dv}" if cuerpo.isdigit() else rut


def formatear_fecha(iso: str) -> str:
    """`2026-09-23` -> `23-09-2026`, como pide el SII."""
    partes = iso.split("-")
    return "-".join(reversed(partes)) if len(partes) == 3 else iso
