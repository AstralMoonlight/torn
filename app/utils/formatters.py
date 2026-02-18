import locale
from decimal import Decimal

def format_clp(value: float | Decimal) -> str:
    """
    Formats a number as Chilean Peso (CLP) with dot as thousands separator.
    Example: 1234567 -> $1.234.567
    """
    if value is None:
        return "$0"
    
    # We avoid using 'locale' directly to prevent issues with system dependencies
    # and instead use a manual format that matches the es-CL standard.
    try:
        val = float(value)
        # Format with dot as thousands and no decimals (typical for CLP)
        formatted = f"{val:,.0f}".replace(",", "X").replace(".", ",").replace("X", ".")
        return f"${formatted}"
    except (ValueError, TypeError):
        return "$0"

def format_number(value: float | Decimal, decimals: int = 2) -> str:
    """
    Formats a number with dot as thousands and comma as decimal separator.
    Example: 1234.56 -> 1.234,56
    """
    if value is None:
        return "0"
    
    try:
        val = float(value)
        # 1,234.56 -> 1X234,56 -> 1.234,56
        formatted = f"{val:,.{decimals}f}".replace(",", "X").replace(".", ",").replace("X", ".")
        return formatted
    except (ValueError, TypeError):
        return "0"
