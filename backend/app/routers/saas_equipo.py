"""Equipo de Factureando: cargos con permisos y los superusuarios que los tienen.

Solo el dueño (superusuario sin cargo) entra acá. Nadie del equipo puede tocar al
dueño ni darse más permisos.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.dependencies.saas import PERMISOS, requiere_dueno
from app.dependencies.tenant import get_global_db
from app.models.saas import SaaSCargo, SaaSUser
from app.schemas_saas import CargoIn, CargoOut, MiembroIn, MiembroUpdate, PermisoOut, SaaSUserOut
from app.utils.security import get_password_hash

router = APIRouter(prefix="/saas", tags=["SaaS Equipo"])

Dueno = Annotated[SaaSUser, Depends(requiere_dueno)]


@router.get("/permisos", response_model=list[PermisoOut])
def list_permisos(_: Dueno):
    return [PermisoOut(clave=k, nombre=v) for k, v in PERMISOS.items()]


def _validar(datos: CargoIn) -> list[str]:
    desconocidos = set(datos.permisos) - PERMISOS.keys()
    if desconocidos:
        raise HTTPException(status_code=422, detail=f"Permisos desconocidos: {', '.join(sorted(desconocidos))}")
    return [p for p in PERMISOS if p in datos.permisos]


@router.get("/cargos", response_model=list[CargoOut])
def list_cargos(_: Dueno, db: Session = Depends(get_global_db)):
    return db.query(SaaSCargo).order_by(SaaSCargo.nombre).all()


@router.post("/cargos", response_model=CargoOut, status_code=201)
def create_cargo(datos: CargoIn, _: Dueno, db: Session = Depends(get_global_db)):
    if db.query(SaaSCargo).filter(SaaSCargo.nombre == datos.nombre).first():
        raise HTTPException(status_code=409, detail="Ya existe un cargo con ese nombre.")
    cargo = SaaSCargo(nombre=datos.nombre, permisos=_validar(datos))
    db.add(cargo)
    db.commit()
    return cargo


@router.put("/cargos/{cargo_id}", response_model=CargoOut)
def update_cargo(cargo_id: int, datos: CargoIn, _: Dueno, db: Session = Depends(get_global_db)):
    cargo = db.get(SaaSCargo, cargo_id)
    if not cargo:
        raise HTTPException(status_code=404, detail="Cargo no encontrado.")
    cargo.nombre, cargo.permisos = datos.nombre, _validar(datos)
    db.commit()
    return cargo


@router.delete("/cargos/{cargo_id}", status_code=204)
def delete_cargo(cargo_id: int, _: Dueno, db: Session = Depends(get_global_db)):
    cargo = db.get(SaaSCargo, cargo_id)
    if not cargo:
        raise HTTPException(status_code=404, detail="Cargo no encontrado.")
    if db.query(SaaSUser).filter(SaaSUser.cargo_id == cargo_id).first():
        raise HTTPException(status_code=409, detail="Hay personas con este cargo: cámbielas de cargo antes de borrarlo.")
    db.delete(cargo)
    db.commit()


@router.get("/equipo", response_model=list[SaaSUserOut])
def list_equipo(_: Dueno, db: Session = Depends(get_global_db)):
    return db.query(SaaSUser).filter(SaaSUser.is_superuser == True).order_by(SaaSUser.email).all()  # noqa: E712


def _cargo(db: Session, cargo_id: int) -> SaaSCargo:
    cargo = db.get(SaaSCargo, cargo_id)
    if not cargo:
        raise HTTPException(status_code=404, detail="Cargo no encontrado.")
    return cargo


@router.post("/equipo", response_model=SaaSUserOut, status_code=201)
def create_miembro(datos: MiembroIn, _: Dueno, db: Session = Depends(get_global_db)):
    """Superusuario nuevo con un cargo. Siempre con cargo: el dueño no se crea desde acá."""
    email = datos.email.strip().lower()
    if db.query(SaaSUser).filter(SaaSUser.email == email).first():
        raise HTTPException(status_code=409, detail="Ese correo ya tiene una cuenta. Use otro para el equipo.")
    miembro = SaaSUser(
        email=email, full_name=datos.full_name, hashed_password=get_password_hash(datos.password),
        is_superuser=True, is_active=True, cargo=_cargo(db, datos.cargo_id),
    )
    db.add(miembro)
    db.commit()
    return miembro


@router.patch("/equipo/{user_id}", response_model=SaaSUserOut)
def update_miembro(user_id: int, datos: MiembroUpdate, dueno: Dueno, db: Session = Depends(get_global_db)):
    miembro = db.get(SaaSUser, user_id)
    if not miembro or not miembro.is_superuser:
        raise HTTPException(status_code=404, detail="No es parte del equipo.")
    cambios = datos.model_dump(exclude_unset=True)
    if miembro.es_dueno and ({"cargo_id", "is_active"} & cambios.keys()):
        raise HTTPException(status_code=403, detail="Al dueño no se le cambia el cargo ni se le desactiva.")
    if "cargo_id" in cambios:
        miembro.cargo = _cargo(db, cambios["cargo_id"])
    if "is_active" in cambios:
        miembro.is_active = cambios["is_active"]
    if cambios.get("full_name") is not None:
        miembro.full_name = cambios["full_name"]
    if cambios.get("password"):
        miembro.hashed_password = get_password_hash(cambios["password"])
    db.commit()
    return miembro
