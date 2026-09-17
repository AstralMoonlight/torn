"""Aritmética de folios sobre un CAF.

Un CAF autoriza el rango `[folio_desde, folio_hasta]` y `ultimo_folio_usado`
actúa como puntero. El puntero arranca en 0, que en general **no** pertenece al
rango: un CAF autorizado de 1000 a 1100 empieza con `ultimo_folio_usado = 0`.
Tratar ese 0 como "último emitido" hace que el primer documento salga con folio
1 —fuera del rango autorizado— y que el stock disponible se informe de más.
Estas funciones son la única fuente de verdad para ese cálculo.
"""


def _puntero_sin_usar(caf) -> bool:
    """Indica si el CAF todavía no ha emitido ningún folio de su rango."""
    return caf.ultimo_folio_usado is None or caf.ultimo_folio_usado < caf.folio_desde


def siguiente_folio(caf) -> int:
    """Retorna el próximo folio a emitir, siempre dentro del rango autorizado.

    Args:
        caf: Instancia de `CAF`.

    Returns:
        `folio_desde` si el CAF está sin estrenar, o el correlativo siguiente.
    """
    if _puntero_sin_usar(caf):
        return caf.folio_desde
    return caf.ultimo_folio_usado + 1


def folios_disponibles(caf) -> int:
    """Cantidad de folios que quedan por emitir en el CAF (nunca negativa)."""
    if _puntero_sin_usar(caf):
        return folios_totales(caf)
    return max(caf.folio_hasta - caf.ultimo_folio_usado, 0)


def folios_totales(caf) -> int:
    """Tamaño total del rango autorizado por el CAF."""
    return caf.folio_hasta - caf.folio_desde + 1
