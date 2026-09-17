import sys
import os

# Aseguramos que el script pueda importar desde la app FastAPI
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.database import SessionLocal, engine
from app.models.saas import Tenant
from app.models.dte import CAF
from sqlalchemy.orm import Session

def inject_folios():
    print("Iniciando inyección de folios...")
    global_db = SessionLocal()
    try:
        tenants = global_db.query(Tenant).all()
        print(f"Encontrados {len(tenants)} inquilinos.")
        
        # Tipos de DTE soportados oficiales
        dte_types = [33, 34, 39, 41, 52, 56, 61, 110, 111, 112]
        
        for tenant in tenants:
            schema = tenant.schema_name
            print(f"\nInyectando folios para tenant: {tenant.name} (esquema: {schema})")
            
            # Conexión al esquema del tenant para aislamiento
            connection = engine.connect()
            connection.execution_options(schema_translate_map={None: schema})
            tenant_db = Session(bind=connection)
            
            try:
                for dt in dte_types:
                    # Validar si el tenant ya tiene folios (CAF) para el DTE actual
                    existing_caf = tenant_db.query(CAF).filter(CAF.tipo_documento == dt).first()
                    
                    if not existing_caf:
                        new_caf = CAF(
                            tipo_documento=dt,
                            folio_desde=1,
                            folio_hasta=500,
                            ultimo_folio_usado=0,
                            xml_caf="<CAF_DUMMY_AUTOINJECTED></CAF_DUMMY_AUTOINJECTED>"
                        )
                        tenant_db.add(new_caf)
                        print(f"  [+] Añadido CAF DTE {dt} (1-500)")
                    else:
                        available = existing_caf.folio_hasta - existing_caf.ultimo_folio_usado
                        # Si existen pero no quedan disponibles, dar un extra
                        if available <= 0:
                            existing_caf.folio_hasta += 500
                            print(f"  [*] CAF DTE {dt} ya existía sin stock, se agregaron +500 folios")
                        else:
                            print(f"  [-] CAF DTE {dt} ya existe con {available} folios disponibles.")
                
                tenant_db.commit()
            except Exception as e:
                tenant_db.rollback()
                print(f"  [!] Error en tenant {schema}: {e}")
            finally:
                tenant_db.close()
                connection.execution_options(schema_translate_map=None)
                connection.close()

    except Exception as general_error:
        print(f"Error global: {general_error}")
    finally:
        global_db.close()
        print("\nProceso finalizado.")

if __name__ == "__main__":
    inject_folios()
