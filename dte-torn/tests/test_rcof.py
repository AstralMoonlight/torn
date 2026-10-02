"""RCOF: resumen por tipo, rangos de folios, esquema oficial y firma.

Los montos son los del set de boletas (ver `test_set_pruebas.ESPERADOS_BOLETAS`),
sumados a mano: neto 25.042 + 1.714 + 3.445 + 10.689 + 2.941 = 43.831; IVA
4.758 + 326 + 655 + 2.031 + 559 = 8.329; exento 2.000; total 54.160.
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

from lxml import etree

from app.core.certificados import parsear_pfx
from app.dte.builder import NS
from app.dte.rcof import Consumido, construir_rcof, firmar_rcof, rangos
from app.dte.signer import ZONA_CHILE
from tests.factories import CLAVE_PFX, pfx
from tests.test_set_pruebas import ESPERADOS_BOLETAS

XSD = Path(__file__).resolve().parent.parent / "app" / "dte" / "xsd" / "rcof" / "ConsumoFolio_v10.xsd"
DIA = date(2026, 10, 2)
BOLETAS_DEL_SET = [
    Consumido(39, int(caso), neto, iva, exento, total)
    for caso, (neto, exento, iva, total) in ESPERADOS_BOLETAS.items()
]


def _rcof(documentos=BOLETAS_DEL_SET, **kw) -> etree._Element:
    return construir_rcof(
        "76543210-3", "11111111-1", date(2020, 11, 30), 0, DIA, documentos,
        momento=datetime(2026, 10, 2, 2, 30, tzinfo=ZONA_CHILE), **kw,
    )


def _texto(nodo: etree._Element, tag: str) -> str | None:
    return nodo.findtext(f"{{{NS}}}{tag}")


def test_rangos_consecutivos() -> None:
    assert rangos([3, 1, 2, 7, 9, 8, 12]) == [(1, 3), (7, 9), (12, 12)]
    assert rangos([]) == []


def test_resumen_del_set_de_boletas() -> None:
    resumenes = _rcof().findall(f".//{{{NS}}}Resumen")
    assert len(resumenes) == 1  # solo se emitieron boletas afectas
    r = resumenes[0]
    assert [(e.tag.split("}")[1], e.text) for e in r if not len(e)] == [
        ("TipoDocumento", "39"), ("MntNeto", "43831"), ("MntIva", "8329"), ("TasaIVA", "19"),
        ("MntExento", "2000"), ("MntTotal", "54160"), ("FoliosEmitidos", "5"), ("FoliosAnulados", "0"),
        ("FoliosUtilizados", "5"),
    ]
    rango = r.find(f"{{{NS}}}RangoUtilizados")
    assert (_texto(rango, "Inicial"), _texto(rango, "Final")) == ("1", "5")


def test_caratula_del_dia() -> None:
    c = _rcof(sec_envio=2).find(f".//{{{NS}}}Caratula")
    assert (_texto(c, "FchInicio"), _texto(c, "FchFinal")) == ("2026-10-02", "2026-10-02")
    assert (_texto(c, "FchResol"), _texto(c, "NroResol")) == ("2020-11-30", "0")
    assert _texto(c, "SecEnvio") == "2"
    assert _texto(c, "TmstFirmaEnv") == "2026-10-02T02:30:00"


def test_boleta_exenta_sin_neto_ni_iva() -> None:
    r = _rcof([Consumido(41, 10, 0, 0, 5000, 5000)]).find(f".//{{{NS}}}Resumen")
    assert _texto(r, "MntNeto") is None and _texto(r, "TasaIVA") is None
    assert (_texto(r, "MntExento"), _texto(r, "MntTotal")) == ("5000", "5000")


def test_firmado_cumple_el_esquema_oficial() -> None:
    cert = parsear_pfx(pfx(rut="11111111-1"), CLAVE_PFX)
    xml = firmar_rcof(_rcof(), cert)  # verifica la firma por dentro
    esquema = etree.XMLSchema(etree.parse(str(XSD)))
    arbol = etree.fromstring(xml)
    assert esquema.validate(arbol), "\n".join(str(e) for e in esquema.error_log)
    assert xml.startswith(b'<?xml version="1.0" encoding="ISO-8859-1"?>')
