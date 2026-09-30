"""Permisos del panel de administración de Factureando (saas-admin).

Un superusuario sin cargo es el **dueño**: tiene todos los permisos y es el único
que arma el equipo (cargos y superusuarios). Un superusuario con cargo solo puede
lo que el cargo incluye.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.dependencies.tenant import get_current_global_user
from app.models.saas import SaaSUser

#: Clave -> qué permite. El orden es el que muestra el editor de cargos.
PERMISOS: dict[str, str] = {
    "empresas.ver": "Ver empresas, resumen y problemas",
    "empresas.editar": "Crear empresas, editar sus datos y activarlas o desactivarlas",
    "empresas.sii": "Cambiar ambiente y resolución del SII",
    "empresas.usuarios": "Usuarios de las empresas",
    "empresas.entrar": "Entrar al sistema de una empresa (soporte)",
    "cobros.ver": "Ver pagos y suscripciones",
    "cobros.registrar": "Registrar y anular pagos, cambiar el plan, links de pago",
    "cobros.prorroga": "Dar prórroga a empresas suspendidas",
    "planes.editar": "Editar planes y reglas de cobranza",
}


def permisos_de(user: SaaSUser) -> list[str]:
    if not user.is_superuser:
        return []
    if user.cargo_id is None:
        return list(PERMISOS)
    return [p for p in (user.cargo.permisos if user.cargo else []) if p in PERMISOS]


def tiene_permiso(user: SaaSUser, permiso: str) -> bool:
    return permiso in permisos_de(user)


def requiere_permiso_saas(permiso: str):
    """Dependencia: el usuario es superusuario y su cargo incluye `permiso`."""
    def verificar(user: Annotated[SaaSUser, Depends(get_current_global_user)]) -> SaaSUser:
        if not tiene_permiso(user, permiso):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Su cargo no permite: {PERMISOS[permiso].lower()}.",
            )
        return user
    return verificar


def requiere_dueno(user: Annotated[SaaSUser, Depends(get_current_global_user)]) -> SaaSUser:
    if not user.es_dueno:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo el dueño administra el equipo.")
    return user
