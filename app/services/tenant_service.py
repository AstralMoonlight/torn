"""Servicio de Aprovisionamiento de Inquilinos (Tenants).

Maneja la lógica de creación de nuevas empresas: desde el registro global
en 'public' hasta la creación física del esquema y corrida de migraciones
Alembic (Tenant-Aware).
"""

import re
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.engine import Connection
from alembic import command
from alembic.config import Config

from app.models.saas import Tenant, TenantUser
from app.database import engine, Base
# Importar todos los modelos para que estén registrados en Base.metadata
import app.models.user
import app.models.brand
import app.models.tax
import app.models.product
import app.models.customer
import app.models.provider
import app.models.sale
import app.models.purchase
import app.models.inventory
import app.models.cash
import app.models.dte
import app.models.issuer
import app.models.payment

def _generate_schema_name(rut: str) -> str:
    """Genera un nombre de esquema seguro basado en el RUT para PostgreSQL."""
    clean_rut = re.sub(r'[^a-zA-Z0-9]', '', rut.lower())
    return f"tenant_{clean_rut}"

def provision_new_tenant(
    global_db: Session, 
    tenant_name: str, 
    rut: str, 
    owner_id: int,
    address: str = None,
    commune: str = None,
    city: str = None,
    giro: str = None,
    billing_day: int = 1,
    economic_activities: list = []
) -> Tenant:
    """Crea una nueva empresa, su esquema SQL y ejecuta las migraciones operativas.
    
    Args:
        global_db: Sesión de DB global (esquema public).
        tenant_name: Nombre comercial de la empresa.
        rut: RUT de la empresa para uso fiscal.
        owner_id: ID del `SaaSUser` que fungirá como administrador.
        
    Returns:
        El modelo `Tenant` creado en `public.tenants`.
    """
    # 1. Resolver el nombre de esquema a nivel DB usando el RUT
    schema_name = _generate_schema_name(rut)
    
    existing = global_db.query(Tenant).filter(Tenant.schema_name == schema_name).first()
    if existing:
        raise Exception(f"Ya existe un inquilino registrado para el RUT: {rut}")
        
    # 2. Registrar Inquilino Globalmente
    new_tenant = Tenant(
        name=tenant_name, 
        rut=rut, 
        schema_name=schema_name,
        address=address,
        commune=commune,
        city=city,
        giro=giro,
        billing_day=billing_day,
        economic_activities=economic_activities
    )
    global_db.add(new_tenant)
    global_db.commit()
    global_db.refresh(new_tenant)
    
    # 3. Aislamiento Físico: Creación del Esquema y Migraciones
    connection = engine.connect()
    try:
        # A. Crear Esquema PostgreSQL
        connection.execute(text(f'CREATE SCHEMA "{schema_name}"'))
        connection.commit()
        
        # B. Generar Tablas Operativas usando el Script Base Puro vía psql
        import subprocess
        import tempfile
        import os
        
        try:
            with open("modelo_base_datos.sql", "r", encoding="utf-8") as f:
                sql_script = f.read()
            
            clean_lines = []
            for line in sql_script.split('\n'):
                if "set_config('search_path'" in line: continue
                if "OWNER TO" in line: continue
                clean_lines.append(line)
            
            sql_script = '\n'.join(clean_lines).replace("public.", "")
            final_sql = f'SET search_path TO "{schema_name}";\n' + sql_script
            
            fd, temp_path = tempfile.mkstemp(suffix=".sql")
            with os.fdopen(fd, 'w', encoding='utf-8') as tmp:
                tmp.write(final_sql)
                
            env = os.environ.copy()
            env["PGPASSWORD"] = "torn"
            
            result = subprocess.run(
                ["psql", "-U", "torn", "-h", "localhost", "-p", "5433", "-d", "torn_db", "-v", "ON_ERROR_STOP=1", "-f", temp_path],
                env=env, capture_output=True, text=True
            )
            os.remove(temp_path)
            
            if result.returncode != 0:
                raise Exception(f"psql error: {result.stderr}")
                
        except FileNotFoundError:
            raise Exception("No se encontró modelo_base_datos.sql para aprovisionar las tablas")
        
        # C. Inicializar Datos del Emisor (Issuer) en el nuevo esquema
        primary_acteco = ""
        if economic_activities and len(economic_activities) > 0:
            primary_acteco = economic_activities[0].get("code", "")

        insert_issuer_sql = text(f"""
            INSERT INTO "{schema_name}".issuers (rut, razon_social, giro, acteco, direccion, comuna, ciudad, created_at, updated_at)
            VALUES (:rut, :razon_social, :giro, :acteco, :direccion, :comuna, :ciudad, NOW(), NOW())
        """)
        connection.execute(insert_issuer_sql, {
            "rut": rut,
            "razon_social": tenant_name,
            "giro": giro or "",
            "acteco": primary_acteco,
            "direccion": address or "",
            "comuna": commune or "",
            "ciudad": city or ""
        })
        connection.commit()

        # D. Registrar el esquema en Alembic como actualizado ("stamp head")
        alembic_cfg = Config("alembic.ini")
        alembic_cfg.attributes['connection'] = connection
        command.stamp(alembic_cfg, "head")
        
    except Exception as e:
        global_db.rollback()
        new_tenant.is_active = False
        global_db.commit()
        raise Exception(f"Fallo crítico aprovisionando esquema {schema_name}: {str(e)}")
    finally:
        connection = connection.execution_options(schema_translate_map=None)
        connection.close()
        
    return new_tenant
