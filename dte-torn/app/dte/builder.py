"""Construcción del XML del DTE según el esquema del SII (issue #14).

Funciones puras: reciben datos, devuelven un árbol `lxml`. Nada de base de
datos, nada de colas, nada de firma. El timbre (`<TED>`) y `<TmstFirma>` los
agrega `signer.py` al final del `<Documento>`, que es donde el esquema los pone.

Reglas que no son obvias y que el SII hace cumplir:

- **Orden de los elementos.** El esquema usa `xs:sequence`: un elemento fuera de
  lugar invalida el documento aunque el contenido sea correcto. El orden de este
  archivo es el del XSD, no el alfabético ni el "lógico".
- **ISO-8859-1.** El texto se sanea antes de entrar al árbol: comillas tipográficas,
  guiones largos y emojis no existen en latin-1. Si llegan al serializador salen
  como referencias numéricas (`&#8212;`), y el SII las rechaza o, peor, las
  acepta en el documento pero no en el timbre.
- **Montos enteros.** El peso no tiene centavos. Todos los montos se redondean
  al peso con redondeo comercial (0,5 sube), igual que `quantize_money` en el
  backend.
- **Boletas y facturas no son iguales.** En boletas (39/41) el precio de cada
  línea incluye IVA y el neto se despeja del total; en facturas el precio es
  neto y el IVA se suma. También cambian nombres de etiquetas del emisor.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING

from lxml import etree
from pydantic import BaseModel, Field, field_validator, model_validator

from app.dte.rut import RUT_CONSUMIDOR_FINAL, validar_rut

if TYPE_CHECKING:
    from app.models import Tenant

NS = "http://www.sii.cl/SiiDte"
XSI = "http://www.w3.org/2001/XMLSchema-instance"

#: Namespaces del `<DTE>`. `xsi` no se usa en el DTE, pero se declara igual: la
#: firma usa C14N inclusivo, que arrastra los namespaces de los ancestros, y
#: el `<EnvioDTE>` que envuelve al documento declara `xsi`. Si el DTE no lo
#: declarara, su forma canónica cambiaría al meterlo en el sobre y la firma
#: dejaría de verificar. Ver `tests/test_signer.py`.
NSMAP_DTE = {None: NS, "xsi": XSI}

#: Declaración con comillas dobles. `lxml` las emite simples y no tiene opción
#: para cambiarlo; ver `tests/test_xmlsec_compat.py`.
DECLARACION = b'<?xml version="1.0" encoding="ISO-8859-1"?>\n'

TASA_IVA = Decimal("19")

#: Documentos que nunca llevan IVA. Misma lista que `EXEMPT_DTES` en
#: `backend/app/utils/taxes.py`: si una cambia, la otra también.
DTE_EXENTOS = frozenset({34, 41, 110, 111, 112})
BOLETAS = frozenset({39, 41})
#: Notas de débito y crédito: sin referencia al documento que modifican, el SII
#: las rechaza.
REQUIEREN_REFERENCIA = frozenset({56, 61})
GUIA_DESPACHO = 52
TIPOS_SOPORTADOS = frozenset({33, 34, 39, 41, GUIA_DESPACHO, 56, 61})

#: Máximo de líneas de detalle en un DTE que no es boleta.
MAX_LINEAS = 60

#: Boletas de venta y servicios. Es el único `IndServicio` que usa un POS.
IND_SERVICIO_BOLETA = 3

_PESO = Decimal("1")
_SEIS_DECIMALES = Decimal("0.000001")


# --------------------------------------------------------------- entrada ----


class Item(BaseModel):
    """Una línea de detalle.

    `precio` es **neto** en facturas y notas, y **bruto (IVA incluido)** en
    boletas. Es la convención del SII para cada tipo, y también la que usa el POS
    al cobrar.
    """

    nombre: str = Field(min_length=1)
    cantidad: Decimal = Field(default=Decimal("1"), gt=0)
    precio: Decimal = Field(ge=0)
    unidad: str | None = None
    descripcion: str | None = None
    codigo: str | None = None
    #: Descuento de la línea en pesos.
    descuento: int = Field(default=0, ge=0)
    #: Descuento de la línea en porcentaje. Se informa `DescuentoPct` y el monto
    #: que resulta, que es lo que el SII usa para cuadrar `MontoItem`.
    descuento_pct: Decimal | None = Field(default=None, gt=0, le=100)
    exento: bool = False

    @model_validator(mode="after")
    def _un_solo_descuento(self) -> Item:
        if self.descuento and self.descuento_pct:
            raise ValueError(f"{self.nombre!r}: descuento en pesos o en porcentaje, no ambos")
        return self


class DescuentoGlobal(BaseModel):
    """Descuento sobre el total del documento (`DscRcgGlobal`).

    Se aplica sobre la suma de las líneas afectas o, con `exento=True`, sobre la
    de las exentas. Nunca sobre las dos a la vez: el SII las lleva por separado.
    """

    valor: Decimal = Field(gt=0)
    #: True: `valor` es un porcentaje. False: es un monto en pesos.
    porcentaje: bool = True
    glosa: str | None = None
    exento: bool = False


class Receptor(BaseModel):
    """Quien recibe el documento."""

    rut: str
    razon_social: str = Field(min_length=1)
    giro: str | None = None
    direccion: str | None = None
    comuna: str | None = None
    ciudad: str | None = None
    correo: str | None = None

    @field_validator("rut")
    @classmethod
    def _rut_valido(cls, v: str) -> str:
        return validar_rut(v)


class Referencia(BaseModel):
    """Documento al que se hace referencia (obligatorio en notas de crédito/débito).

    `tipo_doc` es texto y no número porque el SII acepta códigos como `SET`,
    que es como se identifican los casos del set de pruebas de certificación.
    """

    tipo_doc: str = Field(min_length=1, max_length=3)
    folio: str = Field(min_length=1, max_length=18)
    fecha: date
    #: 1 = anula, 2 = corrige texto, 3 = corrige montos.
    codigo: int | None = Field(default=None, ge=1, le=3)
    razon: str | None = None


class DatosDocumento(BaseModel):
    """Todo lo que el llamador manda para emitir un documento.

    Es también el `payload` que se congela en `documents`: el XML se construye
    de acá una sola vez.
    """

    tipo_dte: int
    fecha_emision: date
    receptor: Receptor | None = None
    items: list[Item] = Field(min_length=1)
    referencias: list[Referencia] = Field(default_factory=list)
    descuentos_globales: list[DescuentoGlobal] = Field(default_factory=list, max_length=20)
    #: 1 = contado, 2 = crédito, 3 = sin costo. Solo facturas.
    forma_pago: int | None = Field(default=None, ge=1, le=3)
    fecha_vencimiento: date | None = None
    #: Solo guías (`IndTraslado`): 1 venta, 2 venta por efectuar, 3 consignación,
    #: 4 promoción o donación, 5 traslado interno, 6 otros sin venta, 7 devolución.
    ind_traslado: int | None = Field(default=None, ge=1, le=9)
    #: Solo guías (`TipoDespacho`): 1 por cuenta del comprador, 2 del emisor a
    #: instalaciones del comprador, 3 del emisor a otras instalaciones.
    tipo_despacho: int | None = Field(default=None, ge=1, le=3)

    @model_validator(mode="after")
    def _reglas_por_tipo(self) -> DatosDocumento:
        if self.tipo_dte not in TIPOS_SOPORTADOS:
            raise ValueError(f"Tipo de documento no soportado: {self.tipo_dte}")

        if self.tipo_dte == GUIA_DESPACHO and self.ind_traslado is None:
            raise ValueError("La guía de despacho requiere el tipo de traslado (IndTraslado)")
        if self.tipo_dte != GUIA_DESPACHO and (self.ind_traslado or self.tipo_despacho):
            raise ValueError("El tipo de traslado y de despacho son solo para guías de despacho")

        if self.tipo_dte not in BOLETAS:
            if self.receptor is None:
                raise ValueError(f"El DTE {self.tipo_dte} requiere receptor")
            faltan = [
                campo
                for campo in ("giro", "direccion", "comuna")
                if not getattr(self.receptor, campo)
            ]
            if faltan:
                raise ValueError(
                    f"El DTE {self.tipo_dte} requiere del receptor: {', '.join(faltan)}"
                )
            if len(self.items) > MAX_LINEAS:
                raise ValueError(f"Máximo {MAX_LINEAS} líneas de detalle")

        if self.tipo_dte in REQUIEREN_REFERENCIA and not self.referencias:
            raise ValueError(
                f"El DTE {self.tipo_dte} requiere al menos una referencia al "
                "documento que modifica"
            )
        return self


@dataclass(slots=True, frozen=True)
class Emisor:
    """Datos del emisor, tal como van al `<Emisor>`."""

    rut: str
    razon_social: str
    giro: str
    acteco: str
    direccion: str | None = None
    comuna: str | None = None
    ciudad: str | None = None
    telefono: str | None = None
    correo: str | None = None

    @classmethod
    def desde_tenant(cls, tenant: Tenant) -> Emisor:
        """Arma el emisor a partir de la copia sincronizada del `Issuer`."""
        return cls(
            rut=validar_rut(tenant.rut_emisor),
            razon_social=tenant.razon_social,
            giro=tenant.giro,
            acteco=tenant.acteco,
            direccion=tenant.direccion,
            comuna=tenant.comuna,
            ciudad=tenant.ciudad,
            telefono=tenant.telefono,
            correo=tenant.email,
        )


@dataclass(slots=True, frozen=True)
class Totales:
    """Montos del documento, en pesos enteros."""

    neto: int
    exento: int
    iva: int
    total: int
    #: None en documentos sin IVA y en boletas (su esquema no lleva `TasaIVA`).
    tasa_iva: Decimal | None


# ----------------------------------------------------------------- montos ---


def _peso(valor: Decimal) -> int:
    return int(valor.quantize(_PESO, rounding=ROUND_HALF_UP))


def descuento_linea(item: Item) -> int:
    """`DescuentoMonto` de la línea, en pesos enteros.

    Con porcentaje, se calcula sobre cantidad por precio y se redondea al peso.
    """
    if item.descuento_pct:
        return _peso(_peso(item.cantidad * item.precio) * item.descuento_pct / 100)
    return item.descuento


def monto_linea(item: Item) -> int:
    """`MontoItem`: cantidad por precio, redondeado al peso, menos descuento."""
    monto = _peso(item.cantidad * item.precio) - descuento_linea(item)
    if monto < 0:
        raise ValueError(f"El descuento de {item.nombre!r} supera el monto de la línea")
    return monto


def monto_descuento_global(descuento: DescuentoGlobal, base: int) -> int:
    """Pesos que descuenta un descuento global sobre su base."""
    if descuento.porcentaje:
        return _peso(Decimal(base) * descuento.valor / 100)
    return _peso(descuento.valor)


def calcular_totales(
    tipo_dte: int,
    items: list[Item],
    descuentos_globales: list[DescuentoGlobal] = (),
) -> Totales:
    """Calcula los totales según las reglas del SII para cada tipo.

    Es la única fuente de los montos: la usa el builder para el XML y la API para
    llenar las columnas de `documents`. Si se calcularan en dos lados, tarde o
    temprano diferirían en un peso.

    Los descuentos globales se restan de la base que corresponde (afecta o
    exenta) **antes** de calcular el IVA: el impuesto va sobre lo que de verdad
    se cobra.
    """
    documento_exento = tipo_dte in DTE_EXENTOS
    afecto = sum(monto_linea(i) for i in items if not (i.exento or documento_exento))
    exento = sum(monto_linea(i) for i in items if i.exento or documento_exento)

    for descuento in descuentos_globales:
        if descuento.exento or documento_exento:
            exento -= monto_descuento_global(descuento, exento)
        else:
            afecto -= monto_descuento_global(descuento, afecto)
    if afecto < 0 or exento < 0:
        raise ValueError("Los descuentos globales superan el monto del documento")

    if tipo_dte in BOLETAS:
        # En boletas el precio ya trae IVA: el neto se despeja del bruto y el
        # IVA es la diferencia, para que neto + IVA cuadre exacto con lo cobrado.
        neto = _peso(Decimal(afecto) * 100 / (100 + TASA_IVA)) if afecto else 0
        iva = afecto - neto
        return Totales(neto=neto, exento=exento, iva=iva, total=afecto + exento, tasa_iva=None)

    iva = _peso(Decimal(afecto) * TASA_IVA / 100)
    return Totales(
        neto=afecto,
        exento=exento,
        iva=iva,
        total=afecto + exento + iva,
        tasa_iva=TASA_IVA if afecto else None,
    )


# ------------------------------------------------------------------ texto ---

#: Caracteres frecuentes en nombres de productos que no existen en latin-1 y
#: tienen un equivalente razonable. El resto de lo no representable se elimina.
_REEMPLAZOS = str.maketrans(
    {
        "‘": "'", "’": "'", "‚": "'",
        "“": '"', "”": '"', "„": '"',
        "–": "-", "—": "-", "−": "-",
        "…": "...",
        "•": "-",
        "€": "EUR",
        " ": " ",
    }
)
_ESPACIOS = re.compile(r"\s+")


def texto_sii(valor: str | None, largo: int) -> str | None:
    """Deja un texto listo para el XML del SII.

    Normaliza, reemplaza lo que tiene equivalente en latin-1, descarta lo que no
    (emojis, caracteres de control), colapsa espacios y corta al largo máximo
    del esquema. Corta en vez de rechazar porque el SII rechaza por largo, y un
    nombre de producto de 81 caracteres no debería frenar una venta.
    """
    if valor is None:
        return None
    limpio = unicodedata.normalize("NFC", valor).translate(_REEMPLAZOS)
    # Primero los saltos de línea y tabs a espacio, después fuera lo no
    # imprimible: al revés, "línea1\nlínea2" quedaría pegado.
    limpio = _ESPACIOS.sub(" ", limpio)
    limpio = "".join(c for c in limpio if c.isprintable())
    limpio = limpio.encode("latin-1", "ignore").decode("latin-1")
    limpio = _ESPACIOS.sub(" ", limpio).strip()
    return limpio[:largo] or None


def _decimal(valor: Decimal) -> str:
    """Formatea cantidades y precios sin notación científica ni ceros de más."""
    normal = valor.quantize(_SEIS_DECIMALES, rounding=ROUND_HALF_UP).normalize()
    return format(normal, "f")


# ------------------------------------------------------------------ árbol ---


def _q(tag: str) -> str:
    return f"{{{NS}}}{tag}"


def _sub(padre: etree._Element, tag: str, texto: str | int | None = None) -> etree._Element | None:
    """Agrega un hijo con texto; si el texto es None, no agrega nada.

    Así los opcionales del esquema se omiten en vez de salir vacíos, que el SII
    trata distinto de ausentes.
    """
    if texto is None:
        return None
    hijo = etree.SubElement(padre, _q(tag))
    hijo.text = str(texto)
    return hijo


def _nodo(padre: etree._Element, tag: str) -> etree._Element:
    return etree.SubElement(padre, _q(tag))


def _id_documento(tipo_dte: int, folio: int) -> str:
    """ID del `<Documento>`. Lo referencia la firma (`URI="#T33F1000"`)."""
    return f"T{tipo_dte}F{folio}"


def _id_doc(encabezado: etree._Element, datos: DatosDocumento, folio: int) -> None:
    nodo = _nodo(encabezado, "IdDoc")
    _sub(nodo, "TipoDTE", datos.tipo_dte)
    _sub(nodo, "Folio", folio)
    _sub(nodo, "FchEmis", datos.fecha_emision.isoformat())
    _sub(nodo, "TipoDespacho", datos.tipo_despacho)
    _sub(nodo, "IndTraslado", datos.ind_traslado)
    if datos.tipo_dte in BOLETAS:
        _sub(nodo, "IndServicio", IND_SERVICIO_BOLETA)
    else:
        _sub(nodo, "FmaPago", datos.forma_pago)
    if datos.fecha_vencimiento:
        _sub(nodo, "FchVenc", datos.fecha_vencimiento.isoformat())


def _emisor(encabezado: etree._Element, emisor: Emisor, tipo_dte: int) -> None:
    nodo = _nodo(encabezado, "Emisor")
    _sub(nodo, "RUTEmisor", emisor.rut)

    if tipo_dte in BOLETAS:
        # El esquema de boletas usa otros nombres y no lleva Acteco.
        _sub(nodo, "RznSocEmisor", texto_sii(emisor.razon_social, 100))
        _sub(nodo, "GiroEmisor", texto_sii(emisor.giro, 80))
    else:
        if not emisor.direccion or not emisor.comuna:
            raise ValueError(
                "El emisor necesita dirección y comuna para emitir facturas; "
                "revisar los datos sincronizados desde el backend"
            )
        _sub(nodo, "RznSoc", texto_sii(emisor.razon_social, 100))
        _sub(nodo, "GiroEmis", texto_sii(emisor.giro, 80))
        _sub(nodo, "Telefono", texto_sii(emisor.telefono, 20))
        _sub(nodo, "CorreoEmisor", texto_sii(emisor.correo, 80))
        _sub(nodo, "Acteco", emisor.acteco)

    _sub(nodo, "DirOrigen", texto_sii(emisor.direccion, 70))
    _sub(nodo, "CmnaOrigen", texto_sii(emisor.comuna, 20))
    _sub(nodo, "CiudadOrigen", texto_sii(emisor.ciudad, 20))


def _receptor(encabezado: etree._Element, receptor: Receptor | None, tipo_dte: int) -> None:
    nodo = _nodo(encabezado, "Receptor")

    if receptor is None:
        # Boleta sin identificar: el SII pide el RUT genérico de consumidor final.
        _sub(nodo, "RUTRecep", RUT_CONSUMIDOR_FINAL)
        return

    _sub(nodo, "RUTRecep", receptor.rut)
    _sub(nodo, "RznSocRecep", texto_sii(receptor.razon_social, 100))
    if tipo_dte not in BOLETAS:
        _sub(nodo, "GiroRecep", texto_sii(receptor.giro, 40))
        _sub(nodo, "CorreoRecep", texto_sii(receptor.correo, 80))
    _sub(nodo, "DirRecep", texto_sii(receptor.direccion, 70))
    _sub(nodo, "CmnaRecep", texto_sii(receptor.comuna, 20))
    _sub(nodo, "CiudadRecep", texto_sii(receptor.ciudad, 20))


def _totales(encabezado: etree._Element, totales: Totales) -> None:
    nodo = _nodo(encabezado, "Totales")
    if totales.neto or totales.iva:
        _sub(nodo, "MntNeto", totales.neto)
    if totales.exento:
        _sub(nodo, "MntExe", totales.exento)
    if totales.tasa_iva is not None:
        _sub(nodo, "TasaIVA", format(totales.tasa_iva, "f"))
    if totales.neto or totales.iva:
        _sub(nodo, "IVA", totales.iva)
    _sub(nodo, "MntTotal", totales.total)


def _detalle(documento: etree._Element, datos: DatosDocumento) -> None:
    documento_exento = datos.tipo_dte in DTE_EXENTOS
    for numero, item in enumerate(datos.items, start=1):
        nodo = _nodo(documento, "Detalle")
        _sub(nodo, "NroLinDet", numero)
        if item.codigo:
            codigo = _nodo(nodo, "CdgItem")
            _sub(codigo, "TpoCodigo", "INT1")
            _sub(codigo, "VlrCodigo", texto_sii(item.codigo, 35))
        # En un documento exento lo es todo; marcar línea por línea sobra.
        if item.exento and not documento_exento:
            _sub(nodo, "IndExe", 1)
        _sub(nodo, "NmbItem", texto_sii(item.nombre, 80))
        _sub(nodo, "DscItem", texto_sii(item.descripcion, 1000))
        # Sin precio, la cantidad solo tiene sentido en una guía (lo que se
        # traslada). En una nota que corrige texto el SII rechaza QtyItem sin
        # PrcItem: "Los Valores de la Linea 1 del Detalle No Cuadran".
        if item.precio > 0 or datos.tipo_dte == GUIA_DESPACHO:
            _sub(nodo, "QtyItem", _decimal(item.cantidad))
            _sub(nodo, "UnmdItem", texto_sii(item.unidad, 4))
        # El esquema exige PrcItem > 0: una línea sin precio (un regalo, o la
        # línea de una nota que solo corrige texto) lo omite, que es válido.
        if item.precio > 0:
            _sub(nodo, "PrcItem", _decimal(item.precio))
        if item.descuento_pct:
            _sub(nodo, "DescuentoPct", _decimal(item.descuento_pct))
        if item.descuento or item.descuento_pct:
            _sub(nodo, "DescuentoMonto", descuento_linea(item))
        _sub(nodo, "MontoItem", monto_linea(item))


def _descuentos_globales(documento: etree._Element, datos: DatosDocumento) -> None:
    """`DscRcgGlobal`: va después del último `Detalle` y antes de `Referencia`."""
    documento_exento = datos.tipo_dte in DTE_EXENTOS
    for numero, descuento in enumerate(datos.descuentos_globales, start=1):
        nodo = _nodo(documento, "DscRcgGlobal")
        _sub(nodo, "NroLinDR", numero)
        _sub(nodo, "TpoMov", "D")
        _sub(nodo, "GlosaDR", texto_sii(descuento.glosa, 45))
        _sub(nodo, "TpoValor", "%" if descuento.porcentaje else "$")
        _sub(nodo, "ValorDR", _decimal(descuento.valor))
        # IndExeDR = 1: el descuento es sobre lo exento. En un documento exento
        # todo lo es, y marcarlo sobra.
        if descuento.exento and not documento_exento:
            _sub(nodo, "IndExeDR", 1)


def _referencias(documento: etree._Element, referencias: list[Referencia]) -> None:
    for numero, ref in enumerate(referencias, start=1):
        nodo = _nodo(documento, "Referencia")
        _sub(nodo, "NroLinRef", numero)
        _sub(nodo, "TpoDocRef", ref.tipo_doc)
        _sub(nodo, "FolioRef", ref.folio)
        _sub(nodo, "FchRef", ref.fecha.isoformat())
        _sub(nodo, "CodRef", ref.codigo)
        _sub(nodo, "RazonRef", texto_sii(ref.razon, 90))


def construir_dte(emisor: Emisor, datos: DatosDocumento, folio: int) -> etree._Element:
    """Arma el `<DTE>` completo, sin timbre ni firma.

    Returns:
        El elemento raíz `<DTE>`. `signer.py` agrega `<TED>` y `<TmstFirma>` al
        final del `<Documento>` y después firma.
    """
    dte = etree.Element(_q("DTE"), nsmap=NSMAP_DTE, version="1.0")
    documento = etree.SubElement(
        dte, _q("Documento"), ID=_id_documento(datos.tipo_dte, folio)
    )

    encabezado = _nodo(documento, "Encabezado")
    _id_doc(encabezado, datos, folio)
    _emisor(encabezado, emisor, datos.tipo_dte)
    _receptor(encabezado, datos.receptor, datos.tipo_dte)
    _totales(encabezado, calcular_totales(datos.tipo_dte, datos.items, datos.descuentos_globales))

    _detalle(documento, datos)
    _descuentos_globales(documento, datos)
    _referencias(documento, datos.referencias)
    return dte


def serializar(elemento: etree._Element) -> bytes:
    """Serializa a ISO-8859-1 con la declaración que espera el SII.

    Es el único punto por donde el XML sale a bytes. Pasar por `str` en algún
    lado es la forma más fácil de invalidar una firma.
    """
    return DECLARACION + etree.tostring(
        elemento, encoding="ISO-8859-1", xml_declaration=False
    )
