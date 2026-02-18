import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from passlib.context import CryptContext

# Load environment variables
load_dotenv()

# Build connection string
db_user = os.getenv("TORN_DB_USER", "torn")
db_password = os.getenv("TORN_DB_PASSWORD", "torn")
db_host = os.getenv("TORN_DB_HOST", "localhost")
db_port = os.getenv("TORN_DB_PORT", "5432")
db_name = os.getenv("TORN_DB_NAME", "torn_db")

DATABASE_URL = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
engine = create_engine(DATABASE_URL)

# Hashing utility
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password):
    return pwd_context.hash(password)

def migrate():
    print("Checking 'password_hash' column in 'users' table...")
    with engine.connect() as conn:
        # Check if column exists
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='users' AND column_name='password_hash'"
        ))
        
        if result.fetchone():
            print("'password_hash' column already exists.")
        else:
            print("Adding 'password_hash' column...")
            conn.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)"))
            print("Successfully added 'password_hash' column.")
            
            # Set default password for existing users
            print("Setting default password '1234' for existing users...")
            default_hash = get_password_hash("1234")
            conn.execute(text("UPDATE users SET password_hash = :hash WHERE password_hash IS NULL"), 
                         {"hash": default_hash})
            print("Default passwords set.")
            conn.commit()

        # Check for PIN column (optional for now but good to have)
        result_pin = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='users' AND column_name='pin'"
        ))
        if not result_pin.fetchone():
             print("Adding 'pin' column...")
             conn.execute(text("ALTER TABLE users ADD COLUMN pin VARCHAR(10)"))
             print("Successfully added 'pin' column.")
             conn.commit()
        else:
             print("'pin' column already exists.")

if __name__ == "__main__":
    migrate()
