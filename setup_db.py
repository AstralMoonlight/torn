"""
Script para verificar la conexión a PostgreSQL y crear las tablas iniciales.

Uso:
    python setup_db.py

Variables de entorno soportadas:
    TORN_DB_USER     (default: postgres)
    TORN_DB_PASSWORD (default: postgres)
    TORN_DB_HOST     (default: localhost)
    TORN_DB_PORT     (default: 5432)
    TORN_DB_NAME     (default: torn_db)
"""

import sys

from sqlalchemy import text

from app.database import engine, Base

# Importar todos los modelos para que Base.metadata los registre
from app.models import User, Sale, DTE  # noqa: F401


def main():
    print("=" * 50)
    print("  Torn — Verificación de Base de Datos")
    print("=" * 50)

    # 1. Probar conexión
    print("\n[1/3] Probando conexión a PostgreSQL...")
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version();"))
            version = result.scalar()
            print(f"  ✓ Conexión exitosa.")
            print(f"  ✓ PostgreSQL: {version}")
    except Exception as e:
        print(f"  ✗ Error de conexión: {e}")
        print("\n  Asegúrate de que:")
        print("    - PostgreSQL está corriendo")
        print("    - La base de datos 'torn_db' existe")
        print("    - Las credenciales son correctas")
        sys.exit(1)

    # 2. Crear tablas
    print("\n[2/3] Creando tablas...")
    try:
        Base.metadata.create_all(bind=engine)
        print("  ✓ Tablas creadas correctamente.")
    except Exception as e:
        print(f"  ✗ Error creando tablas: {e}")
        sys.exit(1)

    # 3. Verificar tablas creadas
    print("\n[3/3] Verificando tablas...")
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT tablename FROM pg_tables "
                    "WHERE schemaname = 'public' ORDER BY tablename;"
                )
            )
            tables = [row[0] for row in result]
            if tables:
                for t in tables:
                    print(f"  ✓ {t}")
            else:
                print("  ⚠ No se encontraron tablas en el esquema public.")
    except Exception as e:
        print(f"  ✗ Error verificando tablas: {e}")
        sys.exit(1)

    print("\n" + "=" * 50)
    print("  ¡Todo listo! Torn está conectado a la BD.")
    print("=" * 50)


if __name__ == "__main__":
    main()
