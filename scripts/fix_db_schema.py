"""Script to fix database schema by adding missing columns to existing tables."""

import os
import sys
from sqlalchemy import text

# Add parent directory to path to import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def check_column(conn, table, column):
    """Checks if a column exists in a table."""
    # This works for PostgreSQL
    query = text(f"""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='{table}' AND column_name='{column}'
    """)
    result = conn.execute(query).fetchone()
    return result is not None

def fix_schema():
    """Adds missing columns to the products table."""
    with engine.connect() as conn:
        print("Starting schema fix...")
        
        # 1. Brands table exists check (Implicitly handled by Base.metadata.create_all in app startup, 
        # but we need to ensure it's there before adding FK)
        print("Ensuring 'brands' table exists...")
        # Since brands might be missing if it was added recently, we run create_all
        from app.models.brand import Brand
        from app.database import Base
        Base.metadata.create_all(bind=engine)
        
        # 2. Add columns to products
        columns_to_add = [
            ("costo_unitario", "NUMERIC(15, 2) DEFAULT 0"),
            ("is_deleted", "BOOLEAN DEFAULT FALSE"),
            ("brand_id", "INTEGER REFERENCES brands(id)")
        ]
        
        for col_name, col_type in columns_to_add:
            if not check_column(conn, "products", col_name):
                print(f"Adding column '{col_name}' to 'products' table...")
                conn.execute(text(f"ALTER TABLE products ADD COLUMN {col_name} {col_type}"))
                print(f"Column '{col_name}' added.")
            else:
                print(f"Column '{col_name}' already exists.")
        
        conn.commit()
        print("Schema fix completed successfully.")

if __name__ == "__main__":
    try:
        fix_schema()
    except Exception as e:
        print(f"Error fixing schema: {e}")
        sys.exit(1)
