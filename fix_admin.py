from app.database import SessionLocal
from app.models.user import User, Role

def fix_admin_role():
    db = SessionLocal()
    try:
        # Find Administrator role
        admin_role = db.query(Role).filter(Role.name == 'ADMINISTRADOR').first()
        if not admin_role:
            print("Error: Role 'ADMINISTRADOR' not found")
            return

        # Find User
        user = db.query(User).filter(User.rut == '16.760.351-3').first()
        if not user:
            print("Error: User '16.760.351-3' not found")
            return

        # Update
        user.role_id = admin_role.id
        user.role = 'ADMINISTRADOR' # Sync deprecated field just in case
        db.commit()
        print(f"User {user.rut} successfully promoted to ADMINISTRADOR")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    fix_admin_role()
