import os
import sys
import json
from sqlalchemy import create_engine, text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

DEFAULT_ROLES = [
    {
        "id": 1,
        "name": "ADMINISTRADOR",
        "description": "Acceso total al sistema",
        "permissions": json.dumps({"all": True})
    },
    {
        "id": 2,
        "name": "VENDEDOR",
        "description": "Rol para generar ventas y administrar caja",
        "permissions": json.dumps({"sales": True, "cash": True})
    }
]

def seed_roles():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'"))
        schemas = [row[0] for row in result.fetchall()]
        
        for schema in schemas:
            print(f"Checking roles in {schema}...")
            # Set search path to tenant
            conn.execute(text(f'SET search_path TO "{schema}"'))
            
            # Check if roles exist
            existing = conn.execute(text("SELECT id, name FROM roles")).fetchall()
            existing_ids = [row[0] for row in existing]
            
            for role in DEFAULT_ROLES:
                if role["id"] not in existing_ids:
                    print(f"  Inserting role {role['name']} ({role['id']}) into {schema}.roles")
                    conn.execute(text("""
                        INSERT INTO roles (id, name, description, permissions)
                        VALUES (:id, :name, :description, :permissions)
                    """), role)
                    # Update sequence if necessary
                    conn.execute(text("SELECT setval('roles_id_seq', (SELECT MAX(id) FROM roles))"))
            
            conn.commit()

if __name__ == "__main__":
    seed_roles()
    print("Roles seeded successfully.")
