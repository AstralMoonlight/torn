"""Set de pruebas del SII: del archivo de texto a documentos listos para emitir.

El SII entrega el set como un `.txt` en latin-1, con columnas separadas por
tabulaciones. Cada caso dice qué documento emitir; las notas de crédito y débito
se refieren a casos anteriores y **no repiten** los precios: una devolución
parcial trae solo las cantidades, y "anula factura" no trae ninguna línea. Este
módulo resuelve eso a partir del caso referenciado, para que los montos salgan
del mismo lugar que los del documento original.

Los números se leen del archivo y nunca se transcriben a mano: un dígito mal
copiado es un caso rechazado en la certificación.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import date
from decimal import Decimal

from app.dte.builder import DTE_EXENTOS, DatosDocumento, DescuentoGlobal, Item, Receptor, Referencia

#: Documentos que el set nombra por texto.
TIPOS = {
    "FACTURA ELECTRONICA": 33,
    "FACTURA NO AFECTA O EXENTA ELECTRONICA": 34,
    "NOTA DE DEBITO ELECTRONICA": 56,
    "NOTA DE CREDITO ELECTRONICA": 61,
}

#: CodRef: 1 anula, 2 corrige texto, 3 corrige montos.
ANULA, CORRIGE_TEXTO, CORRIGE_MONTOS = 1, 2, 3

_CASO = re.compile(r"^CASO\s+(\d+-\d+)")
_ATENCION = re.compile(r"NUMERO DE ATENCI[OÓ]N:\s*(\d+)")
#: Línea que separa un set del siguiente cuando el archivo trae varios. Es
#: larga a propósito: el set de libro de compras trae una más corta adentro.
_SEPARADOR = re.compile(r"^-{40,}\s*$", re.MULTILINE)
_REF_CASO = re.compile(r"CASO\s+(\d+-\d+)")
#: Columnas del encabezado `ITEM ...` de cada caso, y el campo de `Linea` que
#: llenan. Cada set trae las suyas: el de exenta dice "VALOR UNITARIO" y agrega
#: la unidad, y sus notas traen solo el valor, sin cantidad.
_COLUMNAS = {
    "CANTIDAD": "cantidad",
    "PRECIO UNITARIO": "precio",
    "VALOR UNITARIO": "precio",
    "UNIDAD MEDIDA": "unidad",
    "DESCUENTO ITEM": "descuento_pct",
}


class SetInvalidoError(Exception):
    """El archivo no tiene la forma esperada o pide algo que no se soporta."""


@dataclass
class Linea:
    nombre: str
    cantidad: Decimal | None = None
    precio: Decimal | None = None
    descuento_pct: Decimal | None = None
    unidad: str | None = None
    #: Exenta por su nombre ("... EXENTO") o por estar en un documento exento.
    #: Las notas la heredan de la línea que modifican.
    exento: bool = False

    def __post_init__(self) -> None:
        self.exento = self.exento or self.nombre.upper().endswith("EXENTO")


@dataclass
class Caso:
    id: str
    tipo_dte: int | None = None
    lineas: list[Linea] = field(default_factory=list)
    descuento_global_pct: Decimal | None = None
    referencia: str | None = None
    razon: str | None = None

    @property
    def codigo_referencia(self) -> int | None:
        """CodRef deducido de la razón que escribe el SII."""
        if self.razon is None:
            return None
        razon = self.razon.upper()
        if "ANULA" in razon:
            return ANULA
        if "CORRIGE" in razon and not any(p in razon for p in ("MONTO", "PRECIO", "CANTIDAD")):
            return CORRIGE_TEXTO
        return CORRIGE_MONTOS


@dataclass
class SetPruebas:
    numero_atencion: str
    casos: list[Caso]

    def caso(self, id_: str) -> Caso:
        for c in self.casos:
            if c.id == id_:
                return c
        raise SetInvalidoError(f"El set no tiene el caso {id_}")


def _numero(texto: str) -> Decimal:
    return Decimal(texto.strip().rstrip("%").replace(",", "."))


def parsear_set(texto: str, nombre: str = "SET BASICO") -> SetPruebas:
    """Lee un set del `.txt` del SII (ya decodificado desde latin-1).

    El archivo trae todos los sets pedidos, uno tras otro; se lee solo la
    sección cuyo título empieza con `nombre`. Un archivo sin títulos se lee
    entero.

    Raises:
        SetInvalidoError: No se encontró el set, el número de atención o ningún caso.
    """
    secciones = _SEPARADOR.split(texto)
    if len(secciones) > 1:
        titulo = re.compile(rf"^{re.escape(nombre)}\b", re.MULTILINE)
        texto = next((s for s in secciones if titulo.search(s)), None)
        if texto is None:
            raise SetInvalidoError(f"El archivo no trae el {nombre}")
    atencion = _ATENCION.search(texto)
    if not atencion:
        raise SetInvalidoError("No se encontró el número de atención del set")

    casos: list[Caso] = []
    actual: Caso | None = None
    columnas: list[str] = []
    for cruda in texto.splitlines():
        linea = cruda.rstrip("\r")
        limpia = linea.strip()
        if not limpia or limpia.startswith("==="):
            continue
        if m := _CASO.match(limpia):
            actual = Caso(id=m.group(1))
            casos.append(actual)
            columnas = []
            continue
        if actual is None:
            continue  # encabezado del archivo: indicaciones generales

        partes = [p.strip() for p in linea.split("\t") if p.strip()]
        clave = partes[0].upper()
        if clave == "DOCUMENTO":
            nombre = " ".join(partes[1:]).upper()
            if nombre not in TIPOS:
                raise SetInvalidoError(f"Caso {actual.id}: documento no soportado: {nombre!r}")
            actual.tipo_dte = TIPOS[nombre]
        elif clave == "RAZON REFERENCIA":
            actual.razon = " ".join(partes[1:])
        elif clave == "REFERENCIA":
            ref = _REF_CASO.search(" ".join(partes[1:]))
            if not ref:
                raise SetInvalidoError(f"Caso {actual.id}: referencia sin número de caso")
            actual.referencia = ref.group(1)
        elif clave.startswith("DESCUENTO GLOBAL"):
            actual.descuento_global_pct = _numero(partes[-1])
        elif clave == "ITEM":
            desconocidas = [p for p in partes[1:] if p.upper() not in _COLUMNAS]
            if desconocidas:
                raise SetInvalidoError(f"Caso {actual.id}: columnas no soportadas: {desconocidas}")
            columnas = [_COLUMNAS[p.upper()] for p in partes[1:]]
        else:
            valores = partes[1:]
            if not valores or len(valores) > len(columnas):
                raise SetInvalidoError(f"Caso {actual.id}: la línea no calza con las columnas: {limpia!r}")
            campos: dict = dict(zip(columnas, valores))
            for campo in ("cantidad", "precio", "descuento_pct"):
                if campo in campos:
                    campos[campo] = _numero(campos[campo])
            actual.lineas.append(
                Linea(nombre=partes[0], exento=actual.tipo_dte in DTE_EXENTOS, **campos)
            )

    if not casos:
        raise SetInvalidoError("El set no tiene casos")
    for c in casos:
        if c.tipo_dte is None:
            raise SetInvalidoError(f"Caso {c.id}: no dice qué documento es")
    return SetPruebas(numero_atencion=atencion.group(1), casos=casos)


def resolver_lineas(set_: SetPruebas) -> dict[str, tuple[list[Linea], Decimal | None]]:
    """Completa las líneas de cada caso con lo que el set no repite.

    - Devolución parcial o "modifica monto": cada línea toma lo que no trae
      (precio, cantidad, descuento, unidad, exención) de la línea del mismo
      nombre en el caso referenciado.
    - Anulación sin líneas: copia el caso referenciado completo, descuento
      global incluido.
    - Corrección de texto sin líneas: una línea sin monto que describe la
      corrección.

    Los casos se resuelven en orden, así que una nota que anula otra nota toma
    las líneas ya resueltas de esa nota.
    """
    resueltos: dict[str, tuple[list[Linea], Decimal | None]] = {}
    for caso in set_.casos:
        lineas, global_pct = caso.lineas, caso.descuento_global_pct
        if caso.referencia:
            base_lineas, base_global = resueltos[caso.referencia]
            codigo = caso.codigo_referencia
            if not lineas and codigo == ANULA:
                lineas, global_pct = [replace(l) for l in base_lineas], base_global
            elif not lineas and codigo == CORRIGE_TEXTO:
                lineas = [Linea(nombre=caso.razon or "Corrige texto", cantidad=Decimal(1), precio=Decimal(0))]
            else:
                por_nombre = {l.nombre: l for l in base_lineas}
                completas = []
                for l in lineas:
                    original = por_nombre.get(l.nombre)
                    if original is None:
                        completas.append(l)
                        continue
                    completas.append(
                        Linea(
                            nombre=l.nombre,
                            cantidad=l.cantidad if l.cantidad is not None else original.cantidad,
                            precio=l.precio if l.precio is not None else original.precio,
                            descuento_pct=l.descuento_pct if l.descuento_pct is not None else original.descuento_pct,
                            unidad=l.unidad or original.unidad,
                            exento=l.exento or original.exento,
                        )
                    )
                lineas = completas
        for l in lineas:
            if l.precio is None or l.cantidad is None:
                falta = "precio" if l.precio is None else "cantidad"
                raise SetInvalidoError(f"Caso {caso.id}: {l.nombre!r} no tiene {falta}")
        resueltos[caso.id] = (lineas, global_pct)
    return resueltos


def armar_documento(
    set_: SetPruebas,
    caso: Caso,
    lineas: list[Linea],
    descuento_global_pct: Decimal | None,
    receptor: Receptor,
    fecha: date,
    folios: dict[str, tuple[int, int]],
) -> DatosDocumento:
    """Arma el documento de un caso, listo para `emitir_documento`.

    Args:
        folios: `{caso_id: (tipo_dte, folio)}` de los casos ya emitidos. Las
            notas necesitan el folio del documento que referencian, así que los
            casos se emiten en orden.
    """
    # Todo documento del set se identifica con una referencia de tipo SET cuya
    # razón es el número de caso. ponytail: FolioRef "0" es la convención más
    # difundida para esta referencia; a confirmar con el primer set enviado.
    referencias = [Referencia(tipo_doc="SET", folio="0", fecha=fecha, razon=f"CASO {caso.id}")]
    if caso.referencia:
        if caso.referencia not in folios:
            raise SetInvalidoError(
                f"Caso {caso.id}: primero hay que emitir el caso {caso.referencia}, al que referencia"
            )
        tipo_ref, folio_ref = folios[caso.referencia]
        referencias.append(
            Referencia(
                tipo_doc=str(tipo_ref),
                folio=str(folio_ref),
                fecha=fecha,
                codigo=caso.codigo_referencia,
                razon=caso.razon,
            )
        )

    return DatosDocumento(
        tipo_dte=caso.tipo_dte,
        fecha_emision=fecha,
        receptor=receptor,
        items=[
            Item(
                nombre=l.nombre,
                cantidad=l.cantidad,
                precio=l.precio,
                unidad=l.unidad,
                descuento_pct=l.descuento_pct,
                exento=l.exento,
            )
            for l in lineas
        ],
        descuentos_globales=(
            [DescuentoGlobal(valor=descuento_global_pct, glosa="Descuento global items afectos")]
            if descuento_global_pct
            else []
        ),
        referencias=referencias,
    )


def folios_necesarios(set_: SetPruebas) -> dict[int, int]:
    """Cuántos folios de cada tipo hace falta pedir para el set completo."""
    conteo: dict[int, int] = {}
    for caso in set_.casos:
        conteo[caso.tipo_dte] = conteo.get(caso.tipo_dte, 0) + 1
    return conteo
