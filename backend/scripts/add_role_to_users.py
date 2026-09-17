import sys
import os
from sqlalchemy import text

# Add parent directory to path to import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def add_role_column():
    with engine.connect() as conn:
        try:
            # Check if column exists
            result = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='role'"))
            if result.fetchone():
                print("Column 'role' already exists.")
                return

            print("Adding 'role' column to 'users' table...")
            conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'CUSTOMER'"))
            conn.execute(text("UPDATE users SET role = 'CUSTOMER' WHERE role IS NULL"))
            conn.commit()
            print("Migration successful.")
        except Exception as e:
            print(f"Error during migration: {e}")

if __name__ == "__main__":
    add_role_column()
