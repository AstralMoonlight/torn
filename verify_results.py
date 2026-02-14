from app.database import SessionLocal
from app.models.dte import DTE

db = SessionLocal()
last_dte = db.query(DTE).order_by(DTE.id.desc()).first()

if last_dte:
    print('--- INICIO XML ---')
    print(last_dte.xml_content)
    print('--- FIN XML ---')
    print(f'URL PDF: http://localhost:8000/sales/{last_dte.sale_id}/pdf')
else:
    print('No DTE found.')
