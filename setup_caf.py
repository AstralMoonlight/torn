from app.database import SessionLocal, engine, Base
from app.models.dte import CAF
from app.models.product import Product
from app.models.user import User

# Asegurar tablas
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Verificar/Crear CAF 33
caf = db.query(CAF).filter_by(tipo_documento=33).first()
if not caf:
    print("Creando CAF tipo 33 (Rango 1-100)...")
    caf = CAF(
        tipo_documento=33,
        folio_desde=1,
        folio_hasta=100,
        ultimo_folio_usado=0,
        xml_caf="<CAF_DUMMY_CONTENT>"
    )
    db.add(caf)
    db.commit()
else:
    print(f"CAF 33 ya existe. Ultimo folio usado: {caf.ultimo_folio_usado}")

db.close()
