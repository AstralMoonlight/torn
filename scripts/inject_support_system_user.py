import sys
import os
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

# Añadir el directorio raíz al path para importar app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database import engine

def run_sync():
    """Itera por todos los esquemas y aplica las migraciones de God Mode."""
    print("🚀 Iniciando sincronización de Usuario de Soporte en todos los tenants...")
    
    with engine.connect() as conn:
        # 1. Obtener todos los tenants
        tenants = conn.execute(text("SELECT id, name, schema_name FROM public.tenants")).fetchall()
        print(f"📦 Se encontraron {len(tenants)} tenants.")

        for tid, tname, schema in tenants:
            print(f"\n--- Procesando: {tname} (ID: {tid}, Schema: {schema}) ---")
            
            try:
                # 2. Agregar columna is_system_user a users
                try:
                    conn.execute(text(f'ALTER TABLE "{schema}".users ADD COLUMN IF NOT EXISTS is_system_user boolean DEFAULT false'))
                    print(f"✅ Columna 'is_system_user' asegurada en {schema}.users")
                except Exception as e:
                    print(f"⚠️ Error al agregar is_system_user: {e}")

                # 3. Agregar columna audit_metadata a sales y cash_sessions
                try:
                    conn.execute(text(f'ALTER TABLE "{schema}".sales ADD COLUMN IF NOT EXISTS audit_metadata jsonb'))
                    conn.execute(text(f'ALTER TABLE "{schema}".cash_sessions ADD COLUMN IF NOT EXISTS audit_metadata jsonb'))
                    print(f"✅ Columnas 'audit_metadata' aseguradas en {schema}.sales y {schema}.cash_sessions")
                except Exception as e:
                    print(f"⚠️ Error al agregar audit_metadata: {e}")

                # 4. Crear índice único parcial para is_system_user
                try:
                    # Dropear si existe para evitar conflictos o simplemente intentar crear
                    conn.execute(text(f'CREATE UNIQUE INDEX IF NOT EXISTS ix_users_system_user ON "{schema}".users (is_system_user) WHERE (is_system_user = true)'))
                    print(f"✅ Índice único parcial is_system_user asegurado en {schema}")
                except Exception as e:
                    print(f"⚠️ Error al crear índice: {e}")

                # 5. Buscar Rol ADMINISTRADOR dinámicamente
                role_res = conn.execute(text(f"SELECT id FROM \"{schema}\".roles WHERE name = 'ADMINISTRADOR'")).first()
                admin_role_id = role_res[0] if role_res else 1
                print(f"🔍 ID de Rol ADMINISTRADOR encontrado: {admin_role_id}")

                # 6. Inyectar usuario "Soporte Torn" si no existe
                exists = conn.execute(text(f"SELECT id FROM \"{schema}\".users WHERE is_system_user = true")).first()
                
                if not exists:
                    insert_sql = text(f"""
                        INSERT INTO "{schema}".users 
                        (rut, razon_social, email, full_name, is_system_user, is_active, role_id, role, password_hash)
                        VALUES 
                        ('0-0', 'Soporte Torn', 'soporte@torn.cl', 'Soporte Sistema', true, true, :role_id, 'ADMIN', 'INVALID_HASH')
                    """)
                    conn.execute(insert_sql, {"role_id": admin_role_id})
                    print(f"✨ Usuario 'Soporte Sistema' inyectado con éxito en {schema}")
                else:
                    print(f"ℹ️ El usuario de sistema ya existe en {schema} (ID: {exists[0]})")

                conn.commit()

            except Exception as e:
                print(f"❌ Error crítico procesando schema {schema}: {e}")
                conn.rollback()

    print("\n✅ Sincronización finalizada.")

if __name__ == "__main__":
    run_sync()
