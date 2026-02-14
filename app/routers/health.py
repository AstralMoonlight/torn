"""Router de salud y estado del sistema."""

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/")
async def health_check():
    """Verifica que el sistema esté operativo."""
    return {"status": "ok", "service": "Torn"}
