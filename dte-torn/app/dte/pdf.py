"""Representación impresa del DTE: PDF tamaño carta con el timbre en PDF417.

Se arma **desde el XML firmado** que está en S3, nunca desde el payload: lo que
se imprime tiene que ser exactamente lo que recibió el SII. Por eso este módulo
lee el `<DTE>` y no `DatosDocumento`, y el código de barras lleva el `<TED>`
recortado byte a byte del XML.

Funciones puras: entran los bytes del XML, salen los bytes del PDF.

Lo que pide el SII de la representación impresa y está resuelto acá:

- Recuadro en rojo arriba a la derecha con el RUT del emisor, el nombre del
  documento y el folio; bajo él, la unidad del SII del emisor.
- Timbre electrónico en PDF417 con nivel de corrección 5 y, bajo él, la leyenda
  "Timbre Electrónico SII" con la resolución y el sitio de verificación.
- Montos en pesos con punto de miles, fechas dd-mm-aaaa.
- Copia cedible de facturas: recuadro de acuse de recibo (Ley 19.983) y la
  leyenda CEDIBLE.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from io import BytesIO

import pdf417gen
from lxml import etree
from pdf417gen.rendering import barcode_size
from reportlab.lib.colors import black, red, whitesmoke
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen.canvas import Canvas

from app.dte.builder import BOLETAS, NS
from app.dte.rut import RUT_CONSUMIDOR_FINAL

NOMBRES = {
    33: "FACTURA ELECTRONICA",
    34: "FACTURA NO AFECTA O EXENTA ELECTRONICA",
    39: "BOLETA ELECTRONICA",
    41: "BOLETA NO AFECTA O EXENTA ELECTRONICA",
    52: "GUIA DE DESPACHO ELECTRONICA",
    56: "NOTA DE DEBITO ELECTRONICA",
    61: "NOTA DE CREDITO ELECTRONICA",
}
#: Documentos con copia cedible (se pueden ceder a un factoring).
CEDIBLES = frozenset({33, 34})
_CODIGOS_REFERENCIA = {"1": "Anula documento", "2": "Corrige texto", "3": "Corrige montos"}
_FORMAS_PAGO = {"1": "Contado", "2": "Crédito", "3": "Sin costo"}

#: Texto del acuse de recibo de la copia cedible (Ley 19.983).
ACUSE_RECIBO = (
    "El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la "
    "letra b) del Art. 4°, y la letra c) del Art. 5° de la Ley 19.983, acredita que la "
    "entrega de mercaderías o servicio(s) prestado(s) ha(n) sido recibido(s)."
)

#: Nivel de corrección de errores del PDF417 que pide el SII.
NIVEL_CORRECCION_TIMBRE = 5
#: Columnas de datos del PDF417. Con un TED típico (~1 KB, CAF incluido) quedan
#: unas 45 filas: ~7 x 2,5 cm impreso. Calibrable si la revisión de las muestras
#: impresas pide otra proporción; más columnas = más ancho y menos alto.
COLUMNAS_TIMBRE = 18
ANCHO_TIMBRE = 70 * mm

ANCHO, ALTO = letter
MARGEN = 12 * mm

_NSX = {"s": NS}
_TED = re.compile(rb"<TED[ >].*?</TED>", re.S)


# ---------------------------------------------------------------- formato ---


def pesos(monto: int | str) -> str:
    """`1234567` → `$ 1.234.567`."""
    return "$ " + f"{int(monto):,}".replace(",", ".")


def numero(texto: str) -> str:
    """Cantidad o precio con punto de miles y coma decimal: `1234.50` → `1.234,5`."""
    entero, _, decimales = format(Decimal(texto).normalize(), "f").partition(".")
    return f"{int(entero):,}".replace(",", ".") + ("," + decimales if decimales else "")


def formatear_rut(rut: str) -> str:
    """`76543210-3` → `76.543.210-3`."""
    cuerpo, _, dv = rut.partition("-")
    return f"{int(cuerpo):,}".replace(",", ".") + "-" + dv


def fecha(iso: str) -> str:
    """`2026-09-23` → `23-09-2026`."""
    return "-".join(reversed(iso.split("-"))) if iso else ""


# ---------------------------------------------------------------- lectura ---


@dataclass(slots=True)
class Linea:
    nombre: str
    descripcion: str
    codigo: str
    cantidad: str
    unidad: str
    precio: str
    descuento_pct: str
    descuento: str
    monto: str
    exento: bool


@dataclass(slots=True)
class Documento:
    """Lo que se imprime, leído del `<DTE>` firmado."""

    tipo: int
    folio: int
    fecha_emision: str
    forma_pago: str
    fecha_vencimiento: str
    emisor: dict[str, str]
    receptor: dict[str, str]
    totales: dict[str, str]
    lineas: list[Linea]
    descuentos: list[dict[str, str]]
    referencias: list[dict[str, str]]
    #: El `<TED>` tal cual está en el XML: el contenido del PDF417.
    ted: bytes


def _hijos(nodo: etree._Element | None) -> dict[str, str]:
    """Hijos simples de un nodo como `{etiqueta: texto}`, sin namespace."""
    if nodo is None:
        return {}
    return {etree.QName(h).localname: (h.text or "").strip() for h in nodo if h.text and h.text.strip()}


def leer_dte(xml: bytes) -> Documento:
    """Lee del XML firmado todo lo que va impreso."""
    raiz = etree.fromstring(xml)
    doc = raiz.find("s:Documento", _NSX)
    if doc is None:
        raise ValueError("El XML no trae un <Documento>")
    id_doc = _hijos(doc.find("s:Encabezado/s:IdDoc", _NSX))
    emisor = _hijos(doc.find("s:Encabezado/s:Emisor", _NSX))
    # Boletas y facturas nombran distinto la razón social y el giro del emisor.
    emisor.setdefault("RznSoc", emisor.get("RznSocEmisor", ""))
    emisor.setdefault("GiroEmis", emisor.get("GiroEmisor", ""))

    lineas = []
    for det in doc.findall("s:Detalle", _NSX):
        d = _hijos(det)
        lineas.append(
            Linea(
                nombre=d.get("NmbItem", ""),
                descripcion=d.get("DscItem", ""),
                codigo=det.findtext("s:CdgItem/s:VlrCodigo", "", _NSX),
                cantidad=d.get("QtyItem", ""),
                unidad=d.get("UnmdItem", ""),
                precio=d.get("PrcItem", ""),
                descuento_pct=d.get("DescuentoPct", ""),
                descuento=d.get("DescuentoMonto", ""),
                monto=d.get("MontoItem", "0"),
                exento=d.get("IndExe") == "1",
            )
        )

    ted = _TED.search(xml)
    if ted is None:
        raise ValueError("El XML no trae el timbre <TED>")
    return Documento(
        tipo=int(id_doc["TipoDTE"]),
        folio=int(id_doc["Folio"]),
        fecha_emision=id_doc.get("FchEmis", ""),
        forma_pago=id_doc.get("FmaPago", ""),
        fecha_vencimiento=id_doc.get("FchVenc", ""),
        emisor=emisor,
        receptor=_hijos(doc.find("s:Encabezado/s:Receptor", _NSX)),
        totales=_hijos(doc.find("s:Encabezado/s:Totales", _NSX)),
        lineas=lineas,
        descuentos=[_hijos(n) for n in doc.findall("s:DscRcgGlobal", _NSX)],
        referencias=[_hijos(n) for n in doc.findall("s:Referencia", _NSX)],
        ted=ted.group(0),
    )


# ----------------------------------------------------------------- timbre ---


def codigos_timbre(ted: bytes) -> list[list[int]]:
    """Codifica el TED en PDF417. Los bytes van tal cual: son latin-1."""
    return pdf417gen.encode(ted, columns=COLUMNAS_TIMBRE, security_level=NIVEL_CORRECCION_TIMBRE)


def _dibujar_timbre(c: Canvas, ted: bytes, x: float, arriba: float) -> float:
    """Dibuja el PDF417 como vectores (nítido a cualquier escala). Devuelve el alto."""
    codigos = codigos_timbre(ted)
    columnas, filas = barcode_size(codigos)
    modulo = ANCHO_TIMBRE / columnas
    alto_fila = modulo * 3  # proporción alto/ancho del módulo del estándar
    c.setFillColor(black)
    for n, fila in enumerate(codigos):
        bits = "".join(format(valor, "b") for valor in fila)
        y = arriba - (n + 1) * alto_fila
        # Una barra por tramo de unos contiguos, no un rectángulo por módulo.
        for barra in re.finditer("1+", bits):
            c.rect(x + barra.start() * modulo, y, (barra.end() - barra.start()) * modulo, alto_fila, stroke=0, fill=1)
    return filas * alto_fila


# ------------------------------------------------------------------ PDF -----


@dataclass(frozen=True, slots=True)
class DatosImpresion:
    """Lo que va impreso y no está en el XML del documento."""

    resolucion_numero: int
    resolucion_fecha: date
    #: `S.I.I. - CONCEPCION`. Sin ella no se imprime la línea (mejor que inventarla).
    oficina_sii: str | None = None
    cedible: bool = False


@dataclass
class _Hoja:
    c: Canvas
    doc: Documento
    y: float = 0.0
    pagina: int = 1
    columnas: list[tuple[str, float, str]] = field(default_factory=list)


def _lineas(texto: str, fuente: str, tam: float, ancho: float) -> list[str]:
    return simpleSplit(texto, fuente, tam, ancho) if texto else []


def _encabezado(h: _Hoja, imp: DatosImpresion) -> None:
    c, d = h.c, h.doc
    ancho_caja, alto_caja = 72 * mm, 30 * mm
    x_caja, y_caja = ANCHO - MARGEN - ancho_caja, ALTO - MARGEN - alto_caja

    c.setStrokeColor(red)
    c.setFillColor(red)
    c.setLineWidth(1.5)
    c.rect(x_caja, y_caja, ancho_caja, alto_caja)
    textos = [
        f"R.U.T.: {formatear_rut(d.emisor.get('RUTEmisor', ''))}",
        *_lineas(NOMBRES.get(d.tipo, f"DOCUMENTO {d.tipo}"), "Helvetica-Bold", 11, ancho_caja - 8 * mm),
        f"N° {d.folio}",
    ]
    y = y_caja + alto_caja / 2 + (len(textos) - 1) * 6.5 - 4
    c.setFont("Helvetica-Bold", 11)
    for texto in textos:
        c.drawCentredString(x_caja + ancho_caja / 2, y, texto)
        y -= 13
    if imp.oficina_sii:
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(x_caja + ancho_caja / 2, y_caja - 11, imp.oficina_sii.upper())
    c.setStrokeColor(black)
    c.setFillColor(black)
    c.setLineWidth(0.5)

    ancho = x_caja - MARGEN - 6 * mm
    y = ALTO - MARGEN - 10
    c.setFont("Helvetica-Bold", 12)
    for texto in _lineas(d.emisor.get("RznSoc", ""), "Helvetica-Bold", 12, ancho):
        c.drawString(MARGEN, y, texto)
        y -= 14
    e = d.emisor
    datos = [
        e.get("GiroEmis", ""),
        e.get("DirOrigen", ""),
        ", ".join(v for v in (e.get("CmnaOrigen"), e.get("CiudadOrigen")) if v),
        "  ".join(v for v in (e.get("Telefono"), e.get("CorreoEmisor")) if v),
    ]
    c.setFont("Helvetica", 9)
    for dato in datos:
        for texto in _lineas(dato, "Helvetica", 9, ancho):
            c.drawString(MARGEN, y, texto)
            y -= 11
    h.y = min(y, y_caja - 16) - 4 * mm


def _receptor(h: _Hoja) -> None:
    c, d, r = h.c, h.doc, h.doc.receptor
    pares = [("Fecha de emisión", fecha(d.fecha_emision))]
    if r.get("RUTRecep") and r["RUTRecep"] != RUT_CONSUMIDOR_FINAL:
        pares = [
            ("Señor(es)", r.get("RznSocRecep", "")),
            ("R.U.T.", formatear_rut(r["RUTRecep"])),
            ("Giro", r.get("GiroRecep", "")),
            *pares,
            ("Dirección", r.get("DirRecep", "")),
            ("Comuna", r.get("CmnaRecep", "")),
            ("Ciudad", r.get("CiudadRecep", "")),
        ]
    pares += [
        ("Forma de pago", _FORMAS_PAGO.get(d.forma_pago, "")),
        ("Vencimiento", fecha(d.fecha_vencimiento)),
    ]
    pares = [(k, v) for k, v in pares if v]

    ancho_col = (ANCHO - 2 * MARGEN) / 2
    filas = (len(pares) + 1) // 2
    alto = filas * 12 + 8
    c.rect(MARGEN, h.y - alto, ANCHO - 2 * MARGEN, alto)
    for i, (etiqueta, valor) in enumerate(pares):
        x = MARGEN + 4 + (i % 2) * ancho_col
        y = h.y - 13 - (i // 2) * 12
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(x, y, f"{etiqueta}:")
        ancho_etiqueta = c.stringWidth(f"{etiqueta}: ", "Helvetica-Bold", 8.5)
        c.setFont("Helvetica", 8.5)
        recorte = _lineas(valor, "Helvetica", 8.5, ancho_col - ancho_etiqueta - 8)
        c.drawString(x + ancho_etiqueta, y, recorte[0] if recorte else "")
    h.y -= alto + 5 * mm


def _columnas() -> list[tuple[str, float, str]]:
    fijas = [("Código", 22 * mm, "L"), ("Cantidad", 20 * mm, "R"), ("Precio", 26 * mm, "R"),
             ("Desc.", 22 * mm, "R"), ("Valor", 26 * mm, "R")]
    descripcion = ANCHO - 2 * MARGEN - sum(a for _, a, _ in fijas)
    return [fijas[0], ("Descripción", descripcion, "L"), *fijas[1:]]


def _cabecera_tabla(h: _Hoja) -> None:
    c = h.c
    c.setFillColor(whitesmoke)
    c.rect(MARGEN, h.y - 14, ANCHO - 2 * MARGEN, 14, stroke=1, fill=1)
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 8)
    x = MARGEN
    for titulo, ancho, alineado in h.columnas:
        if alineado == "R":
            c.drawRightString(x + ancho - 3, h.y - 10, titulo)
        else:
            c.drawString(x + 3, h.y - 10, titulo)
        x += ancho
    h.y -= 14


def _nueva_pagina(h: _Hoja) -> None:
    h.c.showPage()
    h.pagina += 1
    h.c.setFont("Helvetica", 8)
    h.c.drawString(
        MARGEN, ALTO - MARGEN,
        f"{NOMBRES.get(h.doc.tipo, h.doc.tipo)} N° {h.doc.folio} - continuación, página {h.pagina}",
    )
    h.y = ALTO - MARGEN - 8 * mm


def _detalle(h: _Hoja) -> None:
    c = h.c
    h.columnas = _columnas()
    ancho_desc = h.columnas[1][1] - 6
    _cabecera_tabla(h)
    for linea in h.doc.lineas:
        nombre = _lineas(linea.nombre + (" (exento)" if linea.exento else ""), "Helvetica", 8, ancho_desc)
        extra = _lineas(linea.descripcion, "Helvetica-Oblique", 7, ancho_desc)
        alto = max(1, len(nombre) + len(extra)) * 9.5 + 5
        if h.y - alto < MARGEN + 8 * mm:
            _nueva_pagina(h)
            _cabecera_tabla(h)
        cantidad = numero(linea.cantidad) + (f" {linea.unidad}" if linea.unidad else "") if linea.cantidad else ""
        descuento = f"{numero(linea.descuento_pct)}%" if linea.descuento_pct else (pesos(linea.descuento) if linea.descuento else "")
        valores = [linea.codigo, "", cantidad, numero(linea.precio) if linea.precio else "", descuento, pesos(linea.monto)]
        x = MARGEN
        c.setFont("Helvetica", 8)
        for (_, ancho, alineado), valor in zip(h.columnas, valores):
            if alineado == "R":
                c.drawRightString(x + ancho - 3, h.y - 10, valor)
            elif valor:
                c.drawString(x + 3, h.y - 10, _lineas(valor, "Helvetica", 8, ancho - 6)[0])
            x += ancho
        y = h.y - 10
        x_desc = MARGEN + h.columnas[0][1] + 3
        for texto in nombre:
            c.drawString(x_desc, y, texto)
            y -= 9.5
        c.setFont("Helvetica-Oblique", 7)
        for texto in extra:
            c.drawString(x_desc, y, texto)
            y -= 9.5
        h.y -= alto
        c.setStrokeColorRGB(0.8, 0.8, 0.8)
        c.line(MARGEN, h.y, ANCHO - MARGEN, h.y)
        c.setStrokeColor(black)
    h.y -= 4 * mm


def _textos_pie(d: Documento) -> list[tuple[str, str]]:
    """Descuentos globales y referencias, como (fuente, texto) ya cortados."""
    ancho = ANCHO - 2 * MARGEN
    salida: list[tuple[str, str]] = []
    for desc in d.descuentos:
        valor = f"{numero(desc['ValorDR'])}%" if desc.get("TpoValor") == "%" else pesos(desc.get("ValorDR", "0"))
        tipo = "Descuento" if desc.get("TpoMov", "D") == "D" else "Recargo"
        glosa = f" ({desc['GlosaDR']})" if desc.get("GlosaDR") else ""
        salida.append(("Helvetica", f"{tipo} global{glosa}: {valor}"))
    if d.referencias:
        salida.append(("Helvetica-Bold", "Referencias"))
        for ref in d.referencias:
            tipo = ref.get("TpoDocRef", "")
            nombre = "Set de pruebas" if tipo == "SET" else NOMBRES.get(int(tipo), f"Documento {tipo}") if tipo.isdigit() else tipo
            partes = [f"{nombre} N° {ref.get('FolioRef', '')} del {fecha(ref.get('FchRef', ''))}"]
            if ref.get("CodRef"):
                partes.append(_CODIGOS_REFERENCIA.get(ref["CodRef"], ref["CodRef"]))
            if ref.get("RazonRef"):
                partes.append(ref["RazonRef"])
            for texto in _lineas(" - ".join(partes), "Helvetica", 8, ancho):
                salida.append(("Helvetica", texto))
    return salida


def _filas_totales(d: Documento) -> list[tuple[str, str]]:
    t = d.totales
    if d.tipo in BOLETAS:
        filas = [("Total", pesos(t.get("MntTotal", 0)))]
        if t.get("IVA") and int(t["IVA"]):
            filas.append(("IVA incluido", pesos(t["IVA"])))
        return filas
    filas = []
    if "MntNeto" in t:
        filas.append(("Monto neto", pesos(t["MntNeto"])))
    if "MntExe" in t:
        filas.append(("Monto exento", pesos(t["MntExe"])))
    if "IVA" in t:
        filas.append((f"IVA {numero(t.get('TasaIVA', '19'))}%", pesos(t["IVA"])))
    filas.append(("Total", pesos(t.get("MntTotal", 0))))
    return filas


_ALTO_ACUSE = 78


def _pie(h: _Hoja, imp: DatosImpresion) -> None:
    c, d = h.c, h.doc
    textos = _textos_pie(d)
    totales = _filas_totales(d)
    cedible = imp.cedible and d.tipo in CEDIBLES
    columnas, filas = barcode_size(codigos_timbre(d.ted))
    alto_timbre = filas * (ANCHO_TIMBRE / columnas) * 3
    alto_derecha = len(totales) * 13 + 8 + (_ALTO_ACUSE + 30 if cedible else 0)
    necesario = len(textos) * 10.5 + max(alto_timbre + 26, alto_derecha) + 4 * mm
    if h.y - necesario < MARGEN:
        _nueva_pagina(h)

    for fuente, texto in textos:
        c.setFont(fuente, 8)
        c.drawString(MARGEN, h.y - 8, texto)
        h.y -= 10.5
    h.y -= 3 * mm

    # Totales, a la derecha.
    ancho_tot = 70 * mm
    x_tot = ANCHO - MARGEN - ancho_tot
    alto_tot = len(totales) * 13 + 8
    c.rect(x_tot, h.y - alto_tot, ancho_tot, alto_tot)
    y = h.y - 13
    for i, (etiqueta, valor) in enumerate(totales):
        negrita = etiqueta == "Total"
        c.setFont("Helvetica-Bold" if negrita else "Helvetica", 9.5 if negrita else 9)
        c.drawString(x_tot + 5, y, etiqueta)
        c.drawRightString(x_tot + ancho_tot - 5, y, valor)
        y -= 13

    # Timbre, a la izquierda.
    alto = _dibujar_timbre(c, d.ted, MARGEN, h.y)
    centro = MARGEN + ANCHO_TIMBRE / 2
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(centro, h.y - alto - 10, "Timbre Electrónico SII")
    c.setFont("Helvetica", 7)
    c.drawCentredString(
        centro, h.y - alto - 19,
        f"Res. N° {imp.resolucion_numero} de {imp.resolucion_fecha.year} - Verifique documento: www.sii.cl",
    )

    if cedible:
        _acuse(c, x_tot - 25 * mm, h.y - alto_tot - 6 * mm, ancho_tot + 25 * mm)


def _acuse(c: Canvas, x: float, arriba: float, ancho: float) -> None:
    """Recuadro de acuse de recibo y leyenda CEDIBLE de la copia cedible."""
    c.rect(x, arriba - _ALTO_ACUSE, ancho, _ALTO_ACUSE)
    c.setFont("Helvetica", 8)
    mitad = ancho / 2
    campos = [("Nombre:", 0, 0), ("R.U.T.:", 0, 1), ("Fecha:", mitad, 1), ("Recinto:", 0, 2), ("Firma:", mitad, 2)]
    for etiqueta, dx, fila in campos:
        y = arriba - 12 - fila * 13
        c.drawString(x + 5 + dx, y, etiqueta)
        fin = x + (ancho if dx or fila == 0 else mitad) - 8
        c.line(x + 5 + dx + c.stringWidth(etiqueta, "Helvetica", 8) + 3, y - 1, fin, y - 1)
    c.setFont("Helvetica", 6)
    y = arriba - 12 - 3 * 13
    for texto in _lineas(ACUSE_RECIBO, "Helvetica", 6, ancho - 10):
        c.drawString(x + 5, y, texto)
        y -= 7
    c.setFont("Helvetica-Bold", 14)
    c.drawRightString(x + ancho, arriba - _ALTO_ACUSE - 18, "CEDIBLE")


def generar_pdf(xml: bytes, imp: DatosImpresion) -> bytes:
    """PDF tamaño carta del DTE firmado."""
    d = leer_dte(xml)
    salida = BytesIO()
    c = Canvas(salida, pagesize=letter, pageCompression=1)
    nombre = NOMBRES.get(d.tipo, f"DTE {d.tipo}")
    c.setTitle(f"{nombre} N° {d.folio}" + (" - CEDIBLE" if imp.cedible and d.tipo in CEDIBLES else ""))
    c.setAuthor(d.emisor.get("RznSoc", ""))

    h = _Hoja(c=c, doc=d)
    _encabezado(h, imp)
    _receptor(h)
    _detalle(h)
    _pie(h, imp)
    c.showPage()
    c.save()
    return salida.getvalue()
