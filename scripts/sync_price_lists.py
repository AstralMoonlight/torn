import os
import sys
from sqlalchemy import text

# Add parent directory to path to import app modules if needed
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def sync_price_lists_to_tenants():
    """Migrates the price lists schema changes to all tenant schemas."""
    
    with engine.connect() as conn:
        print("Fetching all tenant schemas...")
        
        # Get all tenant schemas
        schemas = conn.execute(text(
            "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'"
        )).scalars().all()
        
        if not schemas:
            print("No tenant schemas found.")
            return

        print(f"Found {len(schemas)} schemas: {', '.join(schemas)}")
        
        for schema in schemas:
            print(f"\n--- Processing schema: {schema} ---")
            
            # 1. Create price_lists table
            print("  Ensuring price_lists table exists...")
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {schema}.price_lists (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    description VARCHAR(500),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE
                )
            """))
            
            # 2. Create price_list_product table
            print("  Ensuring price_list_product table exists...")
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {schema}.price_list_product (
                    price_list_id INTEGER NOT NULL REFERENCES {schema}.price_lists(id) ON DELETE CASCADE,
                    product_id INTEGER NOT NULL REFERENCES {schema}.products(id) ON DELETE CASCADE,
                    fixed_price NUMERIC(15, 2) NOT NULL,
                    PRIMARY KEY (price_list_id, product_id)
                )
            """))
            
            # 3. Add price_list_id to customers
            print("  Checking if price_list_id exists in customers...")
            col_check = conn.execute(text(f"""
                SELECT column_name FROM information_schema.columns 
                WHERE table_schema='{schema}' AND table_name='customers' AND column_name='price_list_id'
            """)).fetchone()
            
            if not col_check:
                print("  Adding price_list_id to customers...")
                conn.execute(text(f"ALTER TABLE {schema}.customers ADD COLUMN price_list_id INTEGER"))
                
                print("  Adding foreign key to customers.price_list_id...")
                conn.execute(text(f"""
                    ALTER TABLE {schema}.customers 
                    ADD CONSTRAINT fk_customers_price_list_id 
                    FOREIGN KEY (price_list_id) REFERENCES {schema}.price_lists(id) ON DELETE SET NULL
                """))
            else:
                print("  Column price_list_id already exists in customers.")
            
            conn.commit()
            print(f"  ✓ Schema {schema} synced successfully.")

if __name__ == "__main__":
    try:
        sync_price_lists_to_tenants()
        print("\nAll tenant schemas have been synced successfully!")
    except Exception as e:
        print(f"\nError syncing schemas: {e}")
        sys.exit(1)
