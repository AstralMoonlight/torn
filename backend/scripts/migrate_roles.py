import os
import sys
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Añadir el directorio actual al path para importar app
sys.path.append(os.getcwd())

load_dotenv()

# Configuración de la base de datos
DB_USER = os.getenv("TORN_DB_USER", "postgres")
DB_PASS = os.getenv("TORN_DB_PASSWORD", "postgres")
DB_HOST = os.getenv("TORN_DB_HOST", "localhost")
DB_PORT = os.getenv("TORN_DB_PORT", "5432")
DB_NAME = os.getenv("TORN_DB_NAME", "torn_db")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def migrate():
    with engine.connect() as conn:
        print("--- Iniciando migración de Roles ---")
        
        # 1. Crear tabla roles si no existe
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS roles (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL,
                description VARCHAR(200),
                can_manage_users BOOLEAN DEFAULT FALSE,
                can_view_reports BOOLEAN DEFAULT FALSE,
                can_edit_products BOOLEAN DEFAULT TRUE,
                can_perform_sales BOOLEAN DEFAULT TRUE,
                can_perform_returns BOOLEAN DEFAULT FALSE
            )
        """))
        print("Tabla 'roles' verificada/creada.")

        # 2. Añadir columna role_id a users si no existe
        # Nota: PostgreSQL no tiene "IF NOT EXISTS" para ADD COLUMN directamente de forma sencilla en SQL plano,
        # pero podemos usar un bloque anónimo o simplemente intentar y capturar (o verificar en info_schema).
        res = conn.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='users' AND column_name='role_id';
        """)).fetchone()
        
        if not res:
            conn.execute(text("ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id)"))
            print("Columna 'role_id' añadida a 'users'.")
        else:
            print("Columna 'role_id' ya existe en 'users'.")

        # 3. Insertar roles iniciales
        roles = [
            ("ADMINISTRADOR", "Acceso total al sistema", True, True, True, True, True),
            ("VENDEDOR", "Realización de ventas y gestión de stock", False, False, True, True, False),
            ("CLIENTE", "Cliente externo (sin acceso a POS)", False, False, False, False, False)
        ]
        
        for name, desc, manage, reports, edit, sales, returns in roles:
            conn.execute(text("""
                INSERT INTO roles (name, description, can_manage_users, can_view_reports, can_edit_products, can_perform_sales, can_perform_returns)
                VALUES (:name, :desc, :manage, :reports, :edit, :sales, :returns)
                ON CONFLICT (name) DO UPDATE SET 
                    description = EXCLUDED.description,
                    can_manage_users = EXCLUDED.can_manage_users,
                    can_view_reports = EXCLUDED.can_view_reports,
                    can_edit_products = EXCLUDED.can_edit_products,
                    can_perform_sales = EXCLUDED.can_perform_sales,
                    can_perform_returns = EXCLUDED.can_perform_returns
            """), {"name": name, "desc": desc, "manage": manage, "reports": reports, "edit": edit, "sales": sales, "returns": returns})
        
        print("Roles iniciales insertados/actualizados.")

        # 4. Mapear usuarios existentes
        # ADMIN -> ADMINISTRADOR
        # SELLER -> VENDEDOR (si existiera alguno)
        # CUSTOMER -> CLIENTE
        
        mapping = {
            "ADMIN": "ADMINISTRADOR",
            "SELLER": "VENDEDOR",
            "CUSTOMER": "CLIENTE"
        }
        
        for old_role, new_role in mapping.items():
            conn.execute(text("""
                UPDATE users SET role_id = (SELECT id FROM roles WHERE name = :new_role)
                WHERE role = :old_role AND role_id IS NULL
            """), {"old_role": old_role, "new_role": new_role})
            
        # Por si acaso hay roles que no coinciden exactamente
        conn.execute(text("""
            UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'CLIENTE')
            WHERE role_id IS NULL
        """))

        conn.commit()
        print("--- Migración completada exitosamente ---")

if __name__ == "__main__":
    migrate()
