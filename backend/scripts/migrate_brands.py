import sys
import os

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.database import engine, Base
from app.models.brand import Brand  # Import to register in metadata

def migrate():
    print("Starting migration...")
    
    # Create new tables (brands)
    Base.metadata.create_all(bind=engine)
    print("Ensured 'brands' table exists.")

    with engine.connect() as conn:
        # Check if brand_id exists in products
        result = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name='brand_id'"))
        exists = result.fetchone()
        
        if not exists:
            print("Adding 'brand_id' column to 'products' table...")
            conn.execute(text("ALTER TABLE products ADD COLUMN brand_id INTEGER REFERENCES brands(id)"))
            conn.commit()
            print("Column added successfully.")
        else:
            print("'brand_id' column already exists.")

    print("Migration complete.")

if __name__ == "__main__":
    migrate()
