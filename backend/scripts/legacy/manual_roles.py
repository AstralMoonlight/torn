from app.database import SessionLocal, engine
from sqlalchemy import text

with engine.connect() as conn:
    print("Public roles:")
    for row in conn.execute(text("SELECT id, name FROM public.roles")).fetchall():
        print(row)
        
    print("\nTenant 763989569 roles:")
    for row in conn.execute(text("SELECT id, name FROM tenant_763989569.roles")).fetchall():
        print(row)
        
    print("\nTenant 167603513 roles:")
    for row in conn.execute(text("SELECT id, name FROM tenant_167603513.roles")).fetchall():
        print(row)
