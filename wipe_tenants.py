from sqlalchemy import text
from app.database import engine, SessionLocal
from app.models.saas import Tenant, TenantUser

def wipe_all_tenants():
    db = SessionLocal()
    connection = engine.connect()
    try:
        tenants = db.query(Tenant).all()
        if not tenants:
            print("No tenants to wipe.")
            return

        for t in tenants:
            schema_name = t.schema_name
            print(f"Dropping schema {schema_name}...")
            try:
                connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
            except Exception as e:
                print(f"Error dropping schema {schema_name}: {e}")
            
        connection.commit()
        
        print("Clearing public.tenant_users...")
        db.query(TenantUser).delete()
        print("Clearing public.tenants...")
        db.query(Tenant).delete()
        db.commit()
        print("All tenants wiped successfully.")
    except Exception as e:
        print(f"Critical error: {e}")
    finally:
        connection.close()
        db.close()

if __name__ == "__main__":
    wipe_all_tenants()
