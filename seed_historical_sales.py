"""Script para generar ventas históricas de prueba (últimos 30 días)."""

import random
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.database import SessionLocal, engine, Base
from app.models.sale import Sale, SaleDetail
from app.models.product import Product
from app.models.brand import Brand
from app.models.user import User
from app.models.payment import PaymentMethod, SalePayment

def seed_historical_sales():
    db = SessionLocal()
    print("Generando ventas históricas...")

    # Obtener recursos necesarios
    products = db.query(Product).filter(Product.is_active == True).all()
    customers = db.query(User).all() # Usar cualquier usuario como cliente
    payment_methods = db.query(PaymentMethod).all()

    if not products:
        print("No hay productos. Ejecuta seed_data.py primero.")
        return

    # Generar ventas para los últimos 30 días
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)

    total_sales_created = 0

    current_date = start_date
    while current_date <= end_date:
        # Número aleatorio de ventas por día (ej: 2 a 8 ventas)
        daily_sales_count = random.randint(2, 8)
        
        print(f"Generando {daily_sales_count} ventas para {current_date.date()}...")

        for _ in range(daily_sales_count):
            # Hora aleatoria entre 9:00 y 19:00
            hour = random.randint(9, 19)
            minute = random.randint(0, 59)
            sale_date = current_date.replace(hour=hour, minute=minute)

            # Cliente aleatorio
            customer = random.choice(customers) if customers else None
            customer_id = customer.id if customer else 1 

            # Productos aleatorios (1 a 4 items)
            num_items = random.randint(1, 4)
            selected_products = random.sample(products, min(len(products), num_items))

            total_neto = Decimal(0)
            sale_details = []

            for prod in selected_products:
                qty = random.randint(1, 3)
                price = prod.precio_neto
                # Si el precio es 0 (ej: padre), poner precio ficticio
                if price == 0:
                    price = 10000
                
                subtotal = price * qty
                total_neto += subtotal

                detail = SaleDetail(
                    product_id=prod.id,
                    cantidad=qty,
                    precio_unitario=price,
                    subtotal=subtotal,
                    descuento=0
                )
                sale_details.append(detail)

            iva = total_neto * Decimal("0.19")
            total = total_neto + iva

            # Crear Venta
            sale = Sale(
                user_id=customer_id,
                folio=random.randint(1000, 999999), # Folio dummy
                tipo_dte=33 if random.random() > 0.7 else 39, # 30% Factura, 70% Boleta
                fecha_emision=sale_date,
                monto_neto=total_neto,
                iva=iva,
                monto_total=total,
                descripcion="Venta Histórica Generada",
                seller_id=1, # Admin por defecto
                details=sale_details,
                stock_movements=[] # No generamos movimientos de stock para no afectar stock actual real
            )
            db.add(sale)
            db.flush()

            # Pago (asumimos todo pagado con un medio random)
            pm = random.choice(payment_methods)
            payment = SalePayment(
                sale_id=sale.id,
                payment_method_id=pm.id,
                amount=total,
                transaction_code=f"HIST-{random.randint(1000,9999)}"
            )
            db.add(payment)
            
            total_sales_created += 1

        current_date += timedelta(days=1)

    db.commit()
    db.close()
    print(f"¡Listo! Se generaron {total_sales_created} ventas históricas.")

if __name__ == "__main__":
    seed_historical_sales()
