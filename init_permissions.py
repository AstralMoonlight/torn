from app.database import SessionLocal
from app.models.user import Role

def init_permissions():
    db = SessionLocal()
    try:
        # Administrador: Todo habilitado
        admin = db.query(Role).filter(Role.name == 'ADMINISTRADOR').first()
        if admin:
            admin.permissions = {
                'Dashboard': True,
                'Terminal POS': True,
                'Caja': True,
                'Productos': True,
                'Marcas': True,
                'Compras': True,
                'Clientes': True,
                'Proveedores': True,
                'Vendedores': True,
                'Historial': True,
                'Reportes de Ventas': True,
                'Configuración': True
            }
            print("Admin permissions set")

        # Vendedor: Solo operativo
        seller = db.query(Role).filter(Role.name == 'VENDEDOR').first()
        if seller:
            seller.permissions = {
                'Dashboard': False,
                'Terminal POS': True,
                'Caja': True,
                'Productos': False,
                'Marcas': False,
                'Compras': False,
                'Clientes': False,
                'Proveedores': False,
                'Vendedores': False,
                'Historial': False,
                'Reportes de Ventas': False,
                'Configuración': False
            }
            print("Seller permissions set")

        db.commit()
        print("Permissions Initialized Successfully")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    init_permissions()
