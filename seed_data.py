"""Script de inicialización de datos para demostración completa."""

from decimal import Decimal

from sqlalchemy.orm import Session

from app.database import SessionLocal, engine, Base
from app.models.dte import CAF
from app.models.issuer import Issuer
from app.models.product import Product
from app.models.user import User
from app.models.payment import PaymentMethod


def seed_data():
    db = SessionLocal()

    # 1. Emisor (Concepción)
    if not db.query(Issuer).first():
        print("Creating Issuer...")
        issuer = Issuer(
            rut="76123456-K",
            razon_social="Servicios Tecnológicos del Biobío SpA",
            giro="Desarrollo de Software y Consultoría",
            acteco="620100",
            direccion="Calle O'Higgins 1234, Oficina 505",
            comuna="Concepción",
            ciudad="Concepción",
            telefono="+56912345678",
            email="contacto@biotech.cl",
        )
        db.add(issuer)

    # 2. CAF (Folios 1-100 para Facturas 33)
    if not db.query(CAF).filter_by(tipo_documento=33).first():
        print("Creating CAF...")
        caf = CAF(
            tipo_documento=33,
            folio_desde=1,
            folio_hasta=100,
            ultimo_folio_usado=0,
            xml_caf="<CAF>DUMMY_CONTENT</CAF>",  # Simulado
        )
        db.add(caf)

    # 3. Cliente (Santiago)
    if not db.query(User).filter_by(rut="11222333-9").first():
        print("Creating Customer...")
        customer = User(
            rut="11222333-9",
            razon_social="Importadora Los Andes Ltda.",
            giro="Venta al por mayor",
            direccion="Av. Providencia 2000",
            comuna="Providencia",
            ciudad="Santiago",
            email="compras@losandes.cl",
            is_active=True,
        )
        db.add(customer)

    # 4. Productos
    if not db.query(Product).filter_by(codigo_interno="SKU-001").first():
        print("Creating Products...")
        p1 = Product(
            codigo_interno="SKU-001",
            codigo_barras="7801234567890",
            nombre="Monitor 27'' IPS 4K",
            descripcion="Pantalla profesional para diseño",
            precio_neto=250000,
            unidad_medida="unidad",
            is_active=True,
            controla_stock=True,
            stock_actual=10,
            stock_minimo=2,
        )
        p2 = Product(
            codigo_interno="SKU-002",
            codigo_barras="7809876543210",
            nombre="Teclado Mecánico RGB",
            descripcion="Switch Blue, layout español",
            precio_neto=45000,
            unidad_medida="unidad",
            is_active=True,
            controla_stock=True,
            stock_actual=5,
            stock_minimo=1,
        )
        # Producto Padre
        p_zap = Product(
            codigo_interno="ZAP-RUN-001",
            nombre="Zapatilla Running Pro",
            descripcion="Zapatilla de correr genérica",
            precio_neto=0, # Padre puede no tener precio o ser referencial
            unidad_medida="par",
            is_active=True,
            controla_stock=False,
        )
        db.add(p_zap)
        db.flush() # Para obtener ID
        
        # Variantes
        v1 = Product(
            codigo_interno="ZAP-RUN-40",
            parent_id=p_zap.id,
            nombre="Zapatilla Running Pro - Talla 40",
            precio_neto=50000,
            unidad_medida="par",
            is_active=True,
            controla_stock=True,
            stock_actual=20,
        )
        v2 = Product(
            codigo_interno="ZAP-RUN-42",
            parent_id=p_zap.id,
            nombre="Zapatilla Running Pro - Talla 42",
            precio_neto=52000, # Precio distinto por talla (ejemplo)
            unidad_medida="par",
            is_active=True,
            controla_stock=True,
            stock_actual=15,
        )
        db.add(p1)
        db.add(p2)
        db.add(v1)
        db.add(v2)

    # 5. Medios de Pago
    if not db.query(PaymentMethod).first():
        print("Creating Payment Methods...")
        methods = [
            PaymentMethod(code="EFECTIVO", name="Efectivo"),
            PaymentMethod(code="DEBITO", name="Tarjeta Débito"),
            PaymentMethod(code="CREDITO", name="Tarjeta Crédito"),
            PaymentMethod(code="TRANSFERENCIA", name="Transferencia"),
        ]
        db.add_all(methods)

    db.commit()
    db.close()
    print("Seed data inserted successfully.")


if __name__ == "__main__":
    # Asegurar tablas creadas
    Base.metadata.create_all(bind=engine)
    seed_data()
