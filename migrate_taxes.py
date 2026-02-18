import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DB_USER = os.getenv("TORN_DB_USER", "torn")
DB_PASSWORD = os.getenv("TORN_DB_PASSWORD", "torn")
DB_HOST = os.getenv("TORN_DB_HOST", "localhost")
DB_PORT = os.getenv("TORN_DB_PORT", "5432")
DB_NAME = os.getenv("TORN_DB_NAME", "torn_db")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
engine = create_engine(DATABASE_URL)

def run_migration():
    with engine.connect() as conn:
        print("Checking for missing tables and columns...")
        
        # 1. Ensure tax table exists (main.py does it, but let's be safe)
        # Actually create_all handles new tables, so we just need columns.
        
        # 2. Add tax_id column to products if missing
        try:
            conn.execute(text("ALTER TABLE products ADD COLUMN tax_id INTEGER REFERENCES taxes(id)"))
            conn.commit()
            print("Added tax_id to products table.")
        except Exception as e:
            conn.rollback()
            if "already exists" in str(e):
                print("tax_id column already exists in products.")
            else:
                print(f"Error adding tax_id: {e}")

        # 3. Initialize default tax
        try:
            result = conn.execute(text("SELECT count(*) FROM taxes WHERE name = 'IVA 19%'"))
            count = result.scalar()
            if count == 0:
                conn.execute(text("INSERT INTO taxes (name, rate, is_active, is_default) VALUES ('IVA 19%', 0.19, true, true)"))
                conn.commit()
                print("Initialized default tax (IVA 19%).")
        except Exception as e:
            conn.rollback()
            print(f"Error initializing taxes: {e}")

if __name__ == "__main__":
    run_migration()
