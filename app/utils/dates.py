"""Utilidades para manejo de fechas y zonas horarias (Chile)."""

from datetime import datetime
from zoneinfo import ZoneInfo

CHILE_TZ = ZoneInfo("America/Santiago")

def get_now() -> datetime:
    """Retorna la fecha y hora actual en la zona horaria de Chile."""
    return datetime.now(CHILE_TZ)

def get_today() -> datetime:
    """Retorna el inicio del día (00:00:00) en Chile."""
    return get_now().replace(hour=0, minute=0, second=0, microsecond=0)
