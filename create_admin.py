import sys
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.user import User
from app.utils.security import get_password_hash

def create_admin():
    db: Session = SessionLocal()
    try:
        existing_user = db.query(User).filter(User.email == "admin@torn.cl").first()
        if existing_user:
            existing_user.hashed_password = get_password_hash("admin123")
            db.commit()
            print("¡Contraseña actualizada con éxito!")
            return

        db_user = User(
            email="admin@torn.cl",
            hashed_password=get_password_hash("admin123"),
            is_active=True,
            is_superuser=True
        )
        db.add(db_user)
        db.commit()
        print("¡Usuario administrador creado con éxito!")
        print("Email: admin@torn.cl")
        print("Contraseña: admin123")
    except Exception as e:
        print(f"Error al crear el usuario: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    create_admin()