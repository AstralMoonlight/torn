import os
import sys
from sqlalchemy import create_engine, text

# Add parent directory to path to import app modules if needed
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def update_schema():
    """Adds is_deleted column to products table if it doesn't exist."""
    
    with engine.connect() as conn:
        print("Checking if 'is_deleted' column exists in 'products' table...")
        
        # Check if column exists
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='products' AND column_name='is_deleted'"
        ))
        
        if result.fetchone():
            print("Column 'is_deleted' already exists. Skipping.")
        else:
            print("Adding 'is_deleted' column to 'products' table...")
            conn.execute(text("ALTER TABLE products ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE"))
            conn.commit()
            print("Column added successfully.")

if __name__ == "__main__":
    try:
        update_schema()
    except Exception as e:
        print(f"Error updating schema: {e}")
