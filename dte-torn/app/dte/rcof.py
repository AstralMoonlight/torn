"""Reporte de Consumo de Folios (RCOF) de boletas: `<ConsumoFolios>`.

Resume por tipo (39, 41, 61) lo emitido en un día: montos, cantidad de folios y
los rangos usados. Se sube por el mismo canal que los DTE (maullin/palena).

En producción el SII dejó de exigirlo el 01-08-2022 (Res. Ex. SII N° 53), pero
la certificación de boletas lo sigue pidiendo junto con el set, dentro de 24
horas desde que se bajan los folios.

Esquema: `app/dte/xsd/rcof/ConsumoFolio_v10.xsd` (sii.cl/factura_electronica).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from lxml import etree
import xmlsec  # noqa: E402  (lxml primero; ver app/__init__.py)

from app.core.certificados import CertificadoCargado
from app.dte.builder import NS, TASA_IVA, XSI, serializar
from app.dte.signer import ZONA_CHILE, FirmaInvalidaError, _firmar, _verificar, hora_sii

#: Tipos que admite el RCOF (`TipoConsumoType`).
TIPOS_RCOF = (39, 41, 61)


@dataclass(frozen=True, slots=True)
class Consumido:
    """Un documento emitido en el día. Montos en pesos enteros."""

    tipo_dte: int
    folio: int
    neto: int
    iva: int
    exento: int
    total: int


def rangos(folios: list[int]) -> list[tuple[int, int]]:
    """Folios agrupados en tramos consecutivos: [1, 2, 3, 7] -> [(1, 3), (7, 7)]."""
    tramos: list[tuple[int, int]] = []
    for f in sorted(set(folios)):
        if tramos and f == tramos[-1][1] + 1:
            tramos[-1] = (tramos[-1][0], f)
        else:
            tramos.append((f, f))
    return tramos


def _q(tag: str) -> str:
    return f"{{{NS}}}{tag}"


def _sub(padre: etree._Element, tag: str, valor) -> etree._Element:
    nodo = etree.SubElement(padre, _q(tag))
    if valor is not None:
        nodo.text = str(valor)
    return nodo


def construir_rcof(
    rut_emisor: str,
    rut_envia: str,
    fecha_resolucion: date,
    numero_resolucion: int,
    dia: date,
    documentos: list[Consumido],
    sec_envio: int = 1,
    momento: datetime | None = None,
) -> etree._Element:
    """`<ConsumoFolios>` sin firmar, con un `Resumen` por cada tipo emitido.

    Args:
        sec_envio: 1 la primera vez; para corregir se reenvía el día completo con
            el número siguiente.
    """
    raiz = etree.Element(_q("ConsumoFolios"), nsmap={None: NS, "xsi": XSI}, version="1.0")
    raiz.set(f"{{{XSI}}}schemaLocation", f"{NS} ConsumoFolio_v10.xsd")
    doc = etree.SubElement(raiz, _q("DocumentoConsumoFolios"), ID=f"RCOF{dia:%Y%m%d}")

    c = _sub(doc, "Caratula", None)
    c.set("version", "1.0")
    _sub(c, "RutEmisor", rut_emisor)
    _sub(c, "RutEnvia", rut_envia)
    _sub(c, "FchResol", fecha_resolucion.isoformat())
    _sub(c, "NroResol", numero_resolucion)
    _sub(c, "FchInicio", dia.isoformat())
    _sub(c, "FchFinal", dia.isoformat())
    _sub(c, "SecEnvio", sec_envio)
    _sub(c, "TmstFirmaEnv", hora_sii(momento or datetime.now(ZONA_CHILE)))

    for tipo in TIPOS_RCOF:
        del_tipo = [d for d in documentos if d.tipo_dte == tipo]
        if not del_tipo:
            continue
        neto = sum(d.neto for d in del_tipo)
        r = _sub(doc, "Resumen", None)
        _sub(r, "TipoDocumento", tipo)
        if neto:
            _sub(r, "MntNeto", neto)
            _sub(r, "MntIva", sum(d.iva for d in del_tipo))
            _sub(r, "TasaIVA", TASA_IVA)
        exento = sum(d.exento for d in del_tipo)
        if exento:
            _sub(r, "MntExento", exento)
        _sub(r, "MntTotal", sum(d.total for d in del_tipo))
        _sub(r, "FoliosEmitidos", len(del_tipo))
        _sub(r, "FoliosAnulados", 0)
        _sub(r, "FoliosUtilizados", len(del_tipo))
        for inicial, final in rangos([d.folio for d in del_tipo]):
            u = _sub(r, "RangoUtilizados", None)
            _sub(u, "Inicial", inicial)
            _sub(u, "Final", final)
    return raiz


def firmar_rcof(raiz: etree._Element, cert: CertificadoCargado) -> bytes:
    """Firma el `<DocumentoConsumoFolios>` y verifica la firma.

    Raises:
        FirmaInvalidaError: El RCOF firmado no verifica.
    """
    doc = raiz.find(_q("DocumentoConsumoFolios"))
    _firmar(raiz, cert, f"#{doc.get('ID')}", nodo_id=doc)
    xml = serializar(raiz)
    releido = etree.fromstring(xml)
    firma = releido.find(f"{{{xmlsec.constants.DSigNs}}}Signature")
    if firma is None:
        raise FirmaInvalidaError("El RCOF no tiene <Signature>")
    _verificar(firma, releido.find(_q("DocumentoConsumoFolios")), cert.cert_pem, "del RCOF")
    return xml
