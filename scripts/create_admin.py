import getpass
import os
import sys

# Ejecutar desde la raíz del proyecto: python scripts/<archivo>.py
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.user import User
from app.utils.security import get_password_hash

ADMIN_EMAIL = os.getenv("TORN_ADMIN_EMAIL", "admin@torn.cl")


def _resolve_password() -> str:
    """Toma la contraseña de TORN_ADMIN_PASSWORD o la pide de forma interactiva.

    Nunca cae a una contraseña por defecto: dejarla fija en el código es lo
    que expuso `admin123` en el repo.
    """
    password = os.getenv("TORN_ADMIN_PASSWORD", "").strip()
    if password:
        return password
    if not sys.stdin.isatty():
        print(
            "Error: define TORN_ADMIN_PASSWORD en el entorno (no hay terminal "
            "interactiva para pedirla).",
            file=sys.stderr,
        )
        sys.exit(1)
    password = getpass.getpass(f"Contraseña para {ADMIN_EMAIL}: ").strip()
    if not password:
        print("Error: la contraseña no puede estar vacía.", file=sys.stderr)
        sys.exit(1)
    return password


def create_admin():
    password = _resolve_password()
    db: Session = SessionLocal()
    try:
        existing_user = db.query(User).filter(User.email == ADMIN_EMAIL).first()
        if existing_user:
            existing_user.hashed_password = get_password_hash(password)
            db.commit()
            print("¡Contraseña actualizada con éxito!")
            return

        db_user = User(
            email=ADMIN_EMAIL,
            hashed_password=get_password_hash(password),
            is_active=True,
            is_superuser=True
        )
        db.add(db_user)
        db.commit()
        print("¡Usuario administrador creado con éxito!")
        print(f"Email: {ADMIN_EMAIL}")
    except Exception as e:
        print(f"Error al crear el usuario: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    create_admin()