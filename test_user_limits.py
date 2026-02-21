import os
import sys

# Ensure project path is available
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models.saas import SaaSUser, Tenant, SaaSPlan

client = TestClient(app)

def update_plans():
    db = SessionLocal()
    try:
        # Create a default plan if none exists, else update max_users to 3
        plan = db.query(SaaSPlan).first()
        if not plan:
            plan = SaaSPlan(name="Plan Basico", max_users=3)
            db.add(plan)
            db.commit()
            db.refresh(plan)
            print(f"Plan {plan.name} creado con id {plan.id} y max_users {plan.max_users}")
        else:
            plan.max_users = 3
            db.commit()
            print(f"Plan {plan.name} actualizado a max_users 3")
        
        # assign plan to all existing tenants for testing constraints
        tenants = db.query(Tenant).all()
        for t in tenants:
            t.plan_id = plan.id
        db.commit()
    finally:
        db.close()

def main():
    update_plans()
    
    print("\nIniciando test de Limites de Usuarios...")
    db = SessionLocal()
    try:
        admin = db.query(SaaSUser).filter(SaaSUser.email == "admin@torn.cl").first()
        if not admin:
            print("Admin no encontrado. Ejecuta test_jwt_auth.py primero.")
            return

        tenant = db.query(Tenant).first()
        if not tenant:
             print("Tenant no encontrado. Ejecuta test_jwt_auth.py primero.")
             return
             
        # Login to get JWT for Superadmin
        login_data = {"email": "admin@torn.cl", "password": "SuperPassword123!"}
        res = client.post("/auth/login", json=login_data)
        token = res.json().get("access_token")
        headers = {"Authorization": f"Bearer {token}"}
        
        print(f"\n=> Tenant objetivo: {tenant.name} (Plan asignado: ID {tenant.plan_id})")
        
        # Add 3 users iteratively to reach the limit
        for i in range(1, 4):
             payload = {
                  "email": f"worker{i}@torn.cl",
                  "password": "Password123!",
                  "full_name": f"Worker {i}",
                  "role_name": "VENDEDOR" if i > 1 else "ADMINISTRADOR"
             }
             res = client.post(f"/saas/tenants/{tenant.id}/users", json=payload, headers=headers)
             if res.status_code == 200:
                 print(f" [SUCCESS] Usuario {i} añadido: {payload['email']}")
             elif res.status_code == 400 and "ya pertenece a esta empresa" in res.text:
                 print(f" [SKIP] Usuario {i} ya estaba asociado.")
             else:
                 print(f" [ERROR] Falló al añadir usuario {i}: {res.status_code} - {res.text}")

        # Intentar añadir un 4to usuario, deberia rebotar 400 limit exceeded
        print("\n=> Intentando exceder el límite (Usuario 4)...")
        payload = {
             "email": "worker4@torn.cl",
             "password": "Password123!",
             "full_name": "Worker 4",
             "role_name": "VENDEDOR"
        }
        res = client.post(f"/saas/tenants/{tenant.id}/users", json=payload, headers=headers)
        if res.status_code == 400:
             print(f" [SUCCESS] API Interceptó el Límite exitosamente: {res.text}")
        else:
             print(f" [FAIL] API permitió agregar un usuario sobre el limite: Status {res.status_code}")
             
    finally:
        db.close()

if __name__ == "__main__":
    main()
