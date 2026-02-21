import os
import sys

# Ensure project path is available
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models.saas import SaaSUser, Tenant
from app.services.tenant_service import provision_new_tenant
from app.utils.security import get_password_hash

client = TestClient(app)

def main():
    print("Iniciando prueba de Autenticación y Middleware JWT...")
    db = SessionLocal()
    
    admin_email = "admin@torn.cl"
    admin_password = "SuperPassword123!"
    
    try:
        # 1. Crear el Superusuario
        user = db.query(SaaSUser).filter(SaaSUser.email == admin_email).first()
        if not user:
            print(f"Creando superusuario: {admin_email}...")
            user = SaaSUser(
                email=admin_email,
                hashed_password=get_password_hash(admin_password),
                full_name="Serphiente (SuperAdmin)",
                is_superuser=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            print(f"Superusuario {admin_email} ya existe.")
            # Actualizar password por si acaso
            user.hashed_password = get_password_hash(admin_password)
            user.is_superuser = True
            db.commit()

        # 2. Asegurar que haya un Tenant de prueba para el superusuario
        test_rut = "99999999-9" # RUT Ficticio para pruebas de Auth
        tenant = db.query(Tenant).filter(Tenant.rut == test_rut).first()
        if not tenant:
            print("Aprovisionando Tenant de Pruebas (Torn HQ)...")
            try:
                tenant = provision_new_tenant(
                    global_db=db,
                    tenant_name="Torn HQ",
                    rut=test_rut,
                    owner_id=user.id
                )
            except Exception as e:
                 print(f"Error provisions tenant: {e}")
                 # intentamos buscar uno de los creados anteriormente si falla
                 tenant = db.query(Tenant).first()
        else:
             print(f"Tenant de pruebas ya existe: {tenant.name} ({tenant.schema_name})")

        if not tenant:
             print("No se pudo obtener un tenant para probar. Abortando.")
             return

        # 3. Test: Login y Generación de JWT
        print("\n--- Ejecutando Request: POST /auth/login ---")
        login_data = {
            "email": admin_email, 
            "password": admin_password
        }
        response = client.post("/auth/login", json=login_data)
        
        if response.status_code == 200:
            token_data = response.json()
            access_token = token_data.get("access_token")
            # print(f"Login Exitoso! Token recibido:\n{access_token[:50]}...")
            print("Login Exitoso! Token recibido.")
            print("Empresas disponibles en el payload:")
            for t in token_data.get("available_tenants", []):
                print(f" - {t['name']} (ID: {t['id']}) - Rol: {t['role']}")
        else:
            print(f"Error en Login: {response.status_code} - {response.text}")
            return

        # 4. Test: Acceso a Endpoint Operativo Protegido por Tenant Middleware
        print(f"\n--- Ejecutando Request: GET /sales/ (Usando Tenant ID: {tenant.id}) ---")
        headers = {
            "Authorization": f"Bearer {access_token}",
            "X-Tenant-ID": str(tenant.id)
        }
        
        # Hacemos una petición a /sales/ que depende de get_current_tenant_user y get_tenant_db
        sales_response = client.get("/sales/", headers=headers, params={"limit": 5})
        
        if sales_response.status_code == 200:
            print("¡Acceso exitoso al esquema aislado mediante Middleware!")
            print(f"Datos devueltos ({len(sales_response.json())} ventas):", sales_response.json())
        else:
            print(f"Error accediendo a /sales/: {sales_response.status_code} - {sales_response.text}")

    finally:
        db.close()

if __name__ == "__main__":
    main()
