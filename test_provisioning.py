import os
import sys

# Asegurar que el path del proyecto esté disponible
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__))))

from app.database import SessionLocal
from app.models.saas import SaaSUser
from app.services.tenant_service import provision_new_tenant
from app.utils.security import get_password_hash

def main():
    print("Iniciando prueba de aprovisionamiento SaaS...")
    db = SessionLocal()
    try:
        # 1. Crear un Usuario Global de prueba
        test_email = "owner@multi-tenant.com"
        print(f"Buscando o creando usuario global: {test_email}")
        user = db.query(SaaSUser).filter(SaaSUser.email == test_email).first()
        if not user:
            user = SaaSUser(
                email=test_email,
                hashed_password=get_password_hash("password123"),
                full_name="CEO Multi-Tenant",
                is_superuser=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Usuario global creado con ID: {user.id}")
        else:
            print(f"Usuario global ya existe. ID: {user.id}")

        # 2. Aprovisionar Empresa A
        print("\n--- Aprovisionando Empresa A ---")
        try:
            tenant_a = provision_new_tenant(
                global_db=db,
                tenant_name="Sushi Operativo",
                rut="41111111-1",
                owner_id=user.id
            )
            print(f"¡Empresa A aprovisionada exitosamente en el esquema: {tenant_a.schema_name}!")
        except Exception as e:
            print(f"Error o ya existe Empresa A: {e}")

        # 3. Aprovisionar Empresa B
        print("\n--- Aprovisionando Empresa B ---")
        try:
            tenant_b = provision_new_tenant(
                global_db=db,
                tenant_name="Kinesio Operativo",
                rut="42222222-2",
                owner_id=user.id
            )
            print(f"¡Empresa B aprovisionada exitosamente en el esquema: {tenant_b.schema_name}!")
        except Exception as e:
            print(f"Error o ya existe Empresa B: {e}")

        print("\nPrueba de aprovisionamiento finalizada.")

    finally:
        db.close()

if __name__ == "__main__":
    main()
