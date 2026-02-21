import os
import sys
from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def sync_missing_local_users():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT id, schema_name FROM public.tenants"))
        tenants = result.fetchall()
        
        for tenant_id, schema in tenants:
            print(f"Syncing missing users for {schema} (ID: {tenant_id})...")
            
            # Fetch all global assignments for this tenant
            global_users = conn.execute(
                text("""
                    SELECT su.email, su.full_name, su.hashed_password, tu.role_name, tu.is_active 
                    FROM tenant_users tu
                    JOIN saas_users su ON tu.user_id = su.id
                    WHERE tu.tenant_id = :tenant_id
                """),
                {"tenant_id": tenant_id}
            ).fetchall()
            
            for su_email, su_fname, su_pwd, tu_role, tu_active in global_users:
                if not su_email: continue

                try:
                    # Switch to local schema
                    conn.execute(text(f'SET search_path TO "{schema}"'))
                    
                    # Ensure role_id
                    res_role = conn.execute(
                        text("SELECT id FROM roles WHERE name = :role_name LIMIT 1"),
                        {"role_name": tu_role}
                    ).fetchone()
                    role_id = res_role[0] if res_role else None

                    # Upsert into local users
                    conn.execute(text("""
                        INSERT INTO users (email, full_name, password_hash, role, role_id, is_active)
                        VALUES (:email, :full_name, :pwd, :role, :role_id, :is_active)
                        ON CONFLICT (email) DO UPDATE SET
                        full_name = EXCLUDED.full_name,
                        password_hash = EXCLUDED.password_hash,
                        role = EXCLUDED.role,
                        role_id = EXCLUDED.role_id,
                        is_active = EXCLUDED.is_active
                    """), {
                        "email": su_email,
                        "full_name": su_fname or "",
                        "pwd": su_pwd or "",
                        "role": tu_role,
                        "role_id": role_id,
                        "is_active": tu_active
                    })
                    print(f"  -> Synced {su_email} downward.")
                except Exception as e:
                    print(f"  -> Failed to sync {su_email}: {e}")
                finally:
                    conn.execute(text('SET search_path TO "public"'))
        conn.commit()

if __name__ == "__main__":
    sync_missing_local_users()
    print("Missing local user Sync Completed Successfully.")
