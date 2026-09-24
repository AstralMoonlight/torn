"""Libros electrónicos del SII: compra/venta (IECV) y guías de despacho.

Mismo enfoque que `builder.py`: funciones puras que devuelven el árbol en el
orden exacto del XSD (`app/dte/xsd/libros/`), y una sola firma al final.

Fuentes, además de los XSD:

- "Instrucciones para la construcción de documentos tributarios electrónicos con
  los datos del set de pruebas" (sii.cl/factura_electronica/inst_set_pruebas.pdf):
  en certificación el libro es ESPECIAL, el envío TOTAL, y el folio de
  notificación es 1 en ventas y 2 en compras.
- "Formato de información electrónica de compras y ventas" v3.0 (formato_iecv.pdf)
  y "Formato libro de guías de despacho electrónicas" v1.0 (formato_lgd.pdf).

Los montos llegan ya calculados por documento; acá solo se totalizan. Así el
resumen sale siempre de lo mismo que el detalle y no pueden diferir.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from lxml import etree
import xmlsec  # noqa: E402  (lxml primero; ver app/__init__.py)

from app.core.certificados import CertificadoCargado
from app.dte.builder import NS, XSI, serializar, texto_sii
from app.dte.signer import ZONA_CHILE, FirmaInvalidaError, _firmar, _verificar, hora_sii

#: ID del `<EnvioLibro>`: lo referencia la firma.
ID_ENVIO = "EnvioLibro"

VENTA, COMPRA = "VENTA", "COMPRA"
#: Código de impuesto de la retención total del IVA (tabla 7 del formato).
RETENCION_TOTAL = 15
#: CodIVANoRec: 4 = entregas gratuitas (premios, bonificaciones) recibidas.
IVA_NO_REC_ENTREGA_GRATUITA = 4
#: Anulado en el libro de guías: 2 = anulada después de enviarla al SII.
GUIA_ANULADA = 2


@dataclass(frozen=True, slots=True)
class Caratula:
    rut_emisor: str
    rut_envia: str
    #: AAAA-MM.
    periodo: str
    fecha_resolucion: date
    numero_resolucion: int
    folio_notificacion: int
    tipo_libro: str = "ESPECIAL"
    tipo_envio: str = "TOTAL"


@dataclass(slots=True)
class DetalleCV:
    """Una línea del libro de compra o venta. Montos en pesos enteros."""

    tipo_doc: int
    folio: int
    fecha: date
    rut: str
    total: int
    razon_social: str | None = None
    exento: int = 0
    neto: int = 0
    #: IVA recuperable (compras) o débito (ventas).
    iva: int = 0
    tasa_iva: Decimal | None = None
    #: (CodIVANoRec, monto).
    iva_no_recuperable: tuple[int, int] | None = None
    iva_uso_comun: int = 0
    #: (CodImp, tasa, monto).
    otros_impuestos: list[tuple[int, Decimal, int]] = field(default_factory=list)
    #: Solo libro de ventas.
    tipo_doc_ref: int | None = None
    folio_ref: int | None = None


@dataclass(slots=True)
class DetalleGuia:
    folio: int
    fecha: date
    rut: str
    razon_social: str
    #: IndTraslado de la guía (TpoOper).
    tipo_operacion: int
    neto: int = 0
    iva: int = 0
    total: int = 0
    tasa_iva: Decimal | None = None
    anulado: int | None = None
    #: Factura que ampara la guía (tipo, folio, fecha).
    factura: tuple[int, int, date] | None = None


def _q(tag: str) -> str:
    return f"{{{NS}}}{tag}"


def _sub(padre: etree._Element, tag: str, valor) -> None:
    """Agrega el hijo solo si hay valor: los opcionales ausentes no se escriben."""
    if valor is None:
        return
    etree.SubElement(padre, _q(tag)).text = str(valor)


def _raiz(nombre: str, xsd: str, caratula: Caratula, tipo_operacion: str | None) -> tuple[etree._Element, etree._Element]:
    raiz = etree.Element(_q(nombre), nsmap={None: NS, "xsi": XSI}, version="1.0")
    raiz.set(f"{{{XSI}}}schemaLocation", f"{NS} {xsd}")
    envio = etree.SubElement(raiz, _q("EnvioLibro"), ID=ID_ENVIO)
    c = etree.SubElement(envio, _q("Caratula"))
    _sub(c, "RutEmisorLibro", caratula.rut_emisor)
    _sub(c, "RutEnvia", caratula.rut_envia)
    _sub(c, "PeriodoTributario", caratula.periodo)
    _sub(c, "FchResol", caratula.fecha_resolucion.isoformat())
    _sub(c, "NroResol", caratula.numero_resolucion)
    _sub(c, "TipoOperacion", tipo_operacion)
    _sub(c, "TipoLibro", caratula.tipo_libro)
    _sub(c, "TipoEnvio", caratula.tipo_envio)
    _sub(c, "FolioNotificacion", caratula.folio_notificacion)
    return raiz, envio


def _cuenta(n: int) -> int | None:
    return n or None


# ----------------------------------------------------------- compra/venta ---


def construir_libro_cv(
    caratula: Caratula,
    tipo_operacion: str,
    detalles: list[DetalleCV],
    factor_proporcionalidad: Decimal | None = None,
) -> etree._Element:
    """`<LibroCompraVenta>` sin firmar: carátula, resumen del período y detalle.

    Args:
        factor_proporcionalidad: Del IVA de uso común (solo compras). El crédito
            es el factor por el IVA de uso común de cada tipo de documento.
    """
    if tipo_operacion not in (VENTA, COMPRA):
        raise ValueError(f"Tipo de operación desconocido: {tipo_operacion!r}")
    raiz, envio = _raiz("LibroCompraVenta", "LibroCV_v10.xsd", caratula, tipo_operacion)

    por_tipo: dict[int, list[DetalleCV]] = defaultdict(list)
    for d in detalles:
        por_tipo[d.tipo_doc].append(d)
    resumen = etree.SubElement(envio, _q("ResumenPeriodo"))
    for tipo, docs in por_tipo.items():
        t = etree.SubElement(resumen, _q("TotalesPeriodo"))
        _sub(t, "TpoDoc", tipo)
        _sub(t, "TotDoc", len(docs))
        _sub(t, "TotOpExe", _cuenta(sum(1 for d in docs if d.exento)))
        _sub(t, "TotMntExe", sum(d.exento for d in docs))
        _sub(t, "TotMntNeto", sum(d.neto for d in docs))
        if tipo_operacion == COMPRA:
            _sub(t, "TotOpIVARec", _cuenta(sum(1 for d in docs if d.iva)))
        _sub(t, "TotMntIVA", sum(d.iva for d in docs))
        no_rec: dict[int, list[int]] = defaultdict(list)
        for d in docs:
            if d.iva_no_recuperable:
                no_rec[d.iva_no_recuperable[0]].append(d.iva_no_recuperable[1])
        for codigo, montos in sorted(no_rec.items()):
            n = etree.SubElement(t, _q("TotIVANoRec"))
            _sub(n, "CodIVANoRec", codigo)
            _sub(n, "TotOpIVANoRec", len(montos))
            _sub(n, "TotMntIVANoRec", sum(montos))
        uso_comun = [d.iva_uso_comun for d in docs if d.iva_uso_comun]
        if uso_comun:
            if factor_proporcionalidad is None:
                raise ValueError("Hay IVA de uso común: falta el factor de proporcionalidad")
            _sub(t, "TotOpIVAUsoComun", len(uso_comun))
            _sub(t, "TotIVAUsoComun", sum(uso_comun))
            _sub(t, "FctProp", format(factor_proporcionalidad, "f"))
            credito = (sum(uso_comun) * factor_proporcionalidad).quantize(Decimal(1), rounding=ROUND_HALF_UP)
            _sub(t, "TotCredIVAUsoComun", int(credito))
        otros: dict[int, int] = defaultdict(int)
        for d in docs:
            for codigo, _, monto in d.otros_impuestos:
                otros[codigo] += monto
        for codigo, monto in sorted(otros.items()):
            o = etree.SubElement(t, _q("TotOtrosImp"))
            _sub(o, "CodImp", codigo)
            _sub(o, "TotMntImp", monto)
        _sub(t, "TotMntTotal", sum(d.total for d in docs))

    for d in detalles:
        e = etree.SubElement(envio, _q("Detalle"))
        _sub(e, "TpoDoc", d.tipo_doc)
        _sub(e, "NroDoc", d.folio)
        _sub(e, "TasaImp", format(d.tasa_iva, "f") if d.tasa_iva is not None else None)
        _sub(e, "FchDoc", d.fecha.isoformat())
        _sub(e, "RUTDoc", d.rut)
        _sub(e, "RznSoc", texto_sii(d.razon_social, 50))
        _sub(e, "TpoDocRef", d.tipo_doc_ref)
        _sub(e, "FolioDocRef", d.folio_ref)
        _sub(e, "MntExe", d.exento or None)
        _sub(e, "MntNeto", d.neto or None)
        _sub(e, "MntIVA", d.iva if d.neto else None)
        if d.iva_no_recuperable:
            n = etree.SubElement(e, _q("IVANoRec"))
            _sub(n, "CodIVANoRec", d.iva_no_recuperable[0])
            _sub(n, "MntIVANoRec", d.iva_no_recuperable[1])
        _sub(e, "IVAUsoComun", d.iva_uso_comun or None)
        for codigo, tasa, monto in d.otros_impuestos:
            o = etree.SubElement(e, _q("OtrosImp"))
            _sub(o, "CodImp", codigo)
            _sub(o, "TasaImp", format(tasa, "f"))
            _sub(o, "MntImp", monto)
        _sub(e, "MntTotal", d.total)
    return raiz


# ----------------------------------------------------------------- guías ---


def construir_libro_guias(caratula: Caratula, detalles: list[DetalleGuia]) -> etree._Element:
    """`<LibroGuia>` sin firmar.

    En el resumen, "guías de venta" son las de traslado 1 que no están anuladas;
    las demás no anuladas se totalizan por tipo de traslado (formato_lgd.pdf).
    """
    raiz, envio = _raiz("LibroGuia", "LibroGuia_v10.xsd", caratula, None)

    vigentes = [d for d in detalles if d.anulado is None]
    ventas = [d for d in vigentes if d.tipo_operacion == 1]
    resumen = etree.SubElement(envio, _q("ResumenPeriodo"))
    _sub(resumen, "TotFolAnulado", _cuenta(sum(1 for d in detalles if d.anulado == 1)))
    _sub(resumen, "TotGuiaAnulada", _cuenta(sum(1 for d in detalles if d.anulado == GUIA_ANULADA)))
    _sub(resumen, "TotGuiaVenta", len(ventas))
    _sub(resumen, "TotMntGuiaVta", sum(d.total for d in ventas))
    no_venta: dict[int, list[DetalleGuia]] = defaultdict(list)
    for d in vigentes:
        if d.tipo_operacion != 1:
            no_venta[d.tipo_operacion].append(d)
    for tipo, docs in sorted(no_venta.items()):
        t = etree.SubElement(resumen, _q("TotTraslado"))
        _sub(t, "TpoTraslado", tipo)
        _sub(t, "CantGuia", len(docs))
        _sub(t, "MntGuia", sum(d.total for d in docs) or None)

    for d in detalles:
        e = etree.SubElement(envio, _q("Detalle"))
        _sub(e, "Folio", d.folio)
        _sub(e, "Anulado", d.anulado)
        _sub(e, "TpoOper", d.tipo_operacion)
        _sub(e, "FchDoc", d.fecha.isoformat())
        _sub(e, "RUTDoc", d.rut)
        _sub(e, "RznSoc", texto_sii(d.razon_social, 50))
        _sub(e, "MntNeto", d.neto or None)
        _sub(e, "TasaImp", format(d.tasa_iva, "f") if d.neto and d.tasa_iva is not None else None)
        _sub(e, "IVA", d.iva if d.neto else None)
        _sub(e, "MntTotal", d.total)
        if d.factura:
            _sub(e, "TpoDocRef", d.factura[0])
            _sub(e, "FolioDocRef", d.factura[1])
            _sub(e, "FchDocRef", d.factura[2].isoformat())
    return raiz


# ------------------------------------------------------------------ firma ---


def firmar_libro(raiz: etree._Element, cert: CertificadoCargado, momento: datetime | None = None) -> bytes:
    """Agrega `TmstFirma`, firma el `<EnvioLibro>` y verifica la firma.

    La firma va como hija de la raíz, después del `<EnvioLibro>`, igual que en
    el sobre de DTE.

    Raises:
        FirmaInvalidaError: El libro firmado no verifica.
    """
    envio = raiz.find(_q("EnvioLibro"))
    _sub(envio, "TmstFirma", hora_sii(momento or datetime.now(ZONA_CHILE)))
    _firmar(raiz, cert, f"#{ID_ENVIO}", nodo_id=envio)
    xml = serializar(raiz)
    verificar_libro(etree.fromstring(xml), cert.cert_pem)
    return xml


def verificar_libro(libro: etree._Element, cert_pem: bytes) -> None:
    envio = libro.find(_q("EnvioLibro"))
    firma = libro.find(f"{{{xmlsec.constants.DSigNs}}}Signature")
    if envio is None or firma is None:
        raise FirmaInvalidaError("El libro no tiene <EnvioLibro> o <Signature>")
    _verificar(firma, envio, cert_pem, "del libro")
