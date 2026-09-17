import os
import sys
from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def sync_roles():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT id, schema_name FROM public.tenants"))
        tenants = result.fetchall()
        
        for tenant_id, schema in tenants:
            print(f"Syncing roles for {schema} (ID: {tenant_id})...")
            
            conn.execute(text(f'SET search_path TO "{schema}"'))
            local_users = conn.execute(text("""
                SELECT u.email, r.name 
                FROM users u 
                LEFT JOIN roles r ON u.role_id = r.id
            """)).fetchall()
            
            conn.execute(text('SET search_path TO "public"'))
            
            for email, role_name in local_users:
                if not email or not role_name: continue
                
                # Fetch saas_user_id
                saas_user = conn.execute(text("SELECT id FROM saas_users WHERE email = :email"), {"email": email}).first()
                if not saas_user: continue
                saas_user_id = saas_user[0]
                
                # Update TenantUser link
                conn.execute(
                    text("UPDATE tenant_users SET role_name = :role_name WHERE tenant_id = :tenant_id AND user_id = :user_id"),
                    {"role_name": role_name, "tenant_id": tenant_id, "user_id": saas_user_id}
                )
                print(f"  -> Synced {email} to {role_name}")
                
        conn.commit()

if __name__ == "__main__":
    sync_roles()
    print("Role Sync Completed Successfully.")
