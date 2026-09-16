import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

def migrate_roles_permissions():
    user = os.getenv('TORN_DB_USER')
    password = os.getenv('TORN_DB_PASSWORD')
    host = os.getenv('TORN_DB_HOST')
    port = os.getenv('TORN_DB_PORT')
    name = os.getenv('TORN_DB_NAME')
    
    DB_URL = f"postgresql://{user}:{password}@{host}:{port}/{name}"
    
    engine = create_engine(DB_URL)
    
    with engine.connect() as conn:
        print("Checking if 'permissions' column exists...")
        result = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='roles' AND column_name='permissions'"))
        if not result.fetchone():
            print("Adding 'permissions' column to 'roles' table...")
            conn.execute(text("ALTER TABLE roles ADD COLUMN permissions JSONB DEFAULT '{}'"))
            print("Column added successfully.")
        else:
            print("Column 'permissions' already exists.")
        
        conn.commit()

if __name__ == "__main__":
    migrate_roles_permissions()
