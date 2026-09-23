"""RUT chileno: normalización y dígito verificador.

Un RUT con el DV equivocado no es un error de formato menor: el SII rechaza el
documento completo, y para entonces el folio ya está gastado. Por eso se valida
antes de asignar folio, no después.
"""

from __future__ import annotations

import re

_NO_RUT = re.compile(r"[^0-9kK-]")
_FORMA = re.compile(r"^(\d{1,8})-([\dK])$")

#: RUT genérico que el SII acepta como receptor de boletas sin identificar.
RUT_CONSUMIDOR_FINAL = "66666666-6"


def normalizar_rut(rut: str) -> str:
    """Deja el RUT como `76123456-7`: sin puntos, con guion y DV en mayúscula."""
    return _NO_RUT.sub("", (rut or "").strip()).upper()


def digito_verificador(cuerpo: int) -> str:
    """Calcula el DV por módulo 11."""
    suma, factor = 0, 2
    while cuerpo:
        suma += (cuerpo % 10) * factor
        cuerpo //= 10
        factor = 2 if factor == 7 else factor + 1
    resto = 11 - (suma % 11)
    return {11: "0", 10: "K"}.get(resto, str(resto))


def validar_rut(rut: str) -> str:
    """Normaliza y valida un RUT.

    Returns:
        El RUT normalizado.

    Raises:
        ValueError: Formato inválido o dígito verificador incorrecto.
    """
    normal = normalizar_rut(rut)
    forma = _FORMA.match(normal)
    if not forma:
        raise ValueError(f"RUT con formato inválido: {rut!r}")
    cuerpo, dv = forma.groups()
    if digito_verificador(int(cuerpo)) != dv:
        raise ValueError(f"RUT con dígito verificador incorrecto: {rut!r}")
    return normal
