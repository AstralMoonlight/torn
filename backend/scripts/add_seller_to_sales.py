import sys
import os

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.database import engine

def add_seller_id_to_sales():
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            # Check if column exists
            result = conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='sales' AND column_name='seller_id'"
            ))
            if result.fetchone():
                print("Column 'seller_id' already exists in 'sales'.")
                return

            print("Adding 'seller_id' column to 'sales' table...")
            conn.execute(text("ALTER TABLE sales ADD COLUMN seller_id INTEGER REFERENCES users(id)"))
            
            # Update existing sales to have a default seller (e.g., user id 1) if needed
            # For now, we leave it null or set to default admin
            print("Updating existing sales with default seller (ID 1)...")
            conn.execute(text("UPDATE sales SET seller_id = 1 WHERE seller_id IS NULL"))

            trans.commit()
            print("Migration successful!")
        except Exception as e:
            trans.rollback()
            print(f"Error: {e}")
            raise

if __name__ == "__main__":
    add_seller_id_to_sales()
