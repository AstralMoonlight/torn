"""Servicio de Aprovisionamiento de Inquilinos (Tenants).

Maneja la lógica de creación de nuevas empresas: desde el registro global
en 'public' hasta la creación física del esquema y corrida de migraciones
Alembic (Tenant-Aware).
"""

import logging
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
from app.utils.schemas import safe_schema_name

logger = logging.getLogger(__name__)

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
    esquema_creado = False
    try:
        # A. Crear Esquema PostgreSQL
        connection.execute(text(f'CREATE SCHEMA "{safe_schema_name(schema_name)}"'))
        connection.commit()
        esquema_creado = True
        
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
            final_sql = f'SET search_path TO "{safe_schema_name(schema_name)}";\n' + sql_script
            
            fd, temp_path = tempfile.mkstemp(suffix=".sql")
            with os.fdopen(fd, 'w', encoding='utf-8') as tmp:
                tmp.write(final_sql)

            # Las credenciales salen del mismo entorno que usa app/database.py.
            # Estaban fijas a torn@localhost:5433, lo que rompía el
            # aprovisionamiento en cualquier despliegue (Docker incluido).
            env = os.environ.copy()
            env["PGPASSWORD"] = os.getenv("TORN_DB_PASSWORD", "torn")

            try:
                result = subprocess.run(
                    [
                        "psql",
                        "-U", os.getenv("TORN_DB_USER", "torn"),
                        "-h", os.getenv("TORN_DB_HOST", "localhost"),
                        "-p", os.getenv("TORN_DB_PORT", "5432"),
                        "-d", os.getenv("TORN_DB_NAME", "torn_db"),
                        "-v", "ON_ERROR_STOP=1",
                        "-f", temp_path,
                    ],
                    env=env, capture_output=True, text=True
                )
            except FileNotFoundError:
                raise Exception(
                    "No se encontró el binario 'psql'. Es necesario para aprovisionar "
                    "el esquema del inquilino; instala postgresql-client en la imagen."
                )
            finally:
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
            INSERT INTO "{safe_schema_name(schema_name)}".issuers (rut, razon_social, giro, acteco, direccion, comuna, ciudad, created_at, updated_at)
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
        
        # D. Cargar Roles por defecto
        insert_roles_sql = text(f"""
            INSERT INTO "{safe_schema_name(schema_name)}".roles 
            (id, name, description, permissions, can_manage_users, can_view_reports, can_edit_products, can_perform_sales, can_perform_returns)
            VALUES 
                (1, 'ADMINISTRADOR', 'Acceso total al sistema', '{{"all": true}}'::jsonb, true, true, true, true, true),
                (2, 'VENDEDOR', 'Rol para generar ventas y administrar caja', '{{"sales": true, "cash": true}}'::jsonb, false, false, true, true, false)
        """)
        connection.execute(insert_roles_sql)
        connection.execute(text(f"SELECT setval('\"{safe_schema_name(schema_name)}\".roles_id_seq', 2)"))

        role_id_res = connection.execute(text(f"""
            SELECT id FROM "{safe_schema_name(schema_name)}".roles WHERE name = 'ADMINISTRADOR'
        """)).first()
        admin_role_id = role_id_res[0] if role_id_res else 1

        insert_system_user_sql = text(f"""
            INSERT INTO "{safe_schema_name(schema_name)}".users
            (rut, razon_social, email, full_name, is_system_user, is_active, role_id, role, password_hash)
            VALUES
            ('0-0', 'Soporte Torn', 'soporte@torn.cl', 'Soporte Sistema', true, true, :role_id, 'ADMIN', 'INVALID_HASH')
        """)
        connection.execute(insert_system_user_sql, {"role_id": admin_role_id})
        
        connection.commit()

        # D. Registrar el esquema en Alembic como actualizado ("stamp head").
        #
        # `alembic/env.py` deduce el `version_table_schema` del
        # schema_translate_map de la conexión. Sin configurarlo, el stamp no
        # apuntaba al esquema del inquilino y éste quedaba sin tabla
        # `alembic_version`: las migraciones futuras no tenían dónde partir.
        connection.execution_options(
            schema_translate_map={None: safe_schema_name(schema_name)}
        )
        alembic_cfg = Config("alembic.ini")
        alembic_cfg.attributes['connection'] = connection
        command.stamp(alembic_cfg, "head")
        connection.commit()
        
    except Exception as e:
        # Aprovisionar no es atómico: el `CREATE SCHEMA` y el registro del
        # inquilino ya se confirmaron por separado, así que un `rollback()` aquí
        # no deshace nada. Hay que limpiar a mano, o queda un esquema a medio
        # crear y una fila en `public.tenants` que bloquea ese RUT para siempre,
        # porque el schema_name se deriva de él.
        _limpiar_aprovisionamiento_fallido(
            global_db, connection, new_tenant, schema_name, esquema_creado
        )
        raise Exception(
            f"Fallo aprovisionando el esquema {schema_name}: {e}. "
            "Se revirtió la creación; puedes reintentar con el mismo RUT."
        )
    finally:
        connection = connection.execution_options(schema_translate_map=None)
        connection.close()

    return new_tenant


def _limpiar_aprovisionamiento_fallido(
    global_db: Session,
    connection: Connection,
    tenant: Tenant,
    schema_name: str,
    esquema_creado: bool,
) -> None:
    """Revierte un aprovisionamiento incompleto, dejando el RUT reutilizable.

    Nunca propaga sus propios errores: el fallo original es el que interesa.

    Args:
        global_db: Sesión sobre el esquema `public`.
        connection: Conexión usada para crear el esquema.
        tenant: Fila ya persistida en `public.tenants`.
        schema_name: Esquema a eliminar.
        esquema_creado: Si el `CREATE SCHEMA` llegó a ejecutarse.
    """
    if esquema_creado:
        try:
            connection.rollback()
            connection.execute(
                text(f'DROP SCHEMA IF EXISTS "{safe_schema_name(schema_name)}" CASCADE')
            )
            connection.commit()
        except Exception:
            logger.exception(
                "No se pudo eliminar el esquema %s tras un aprovisionamiento "
                "fallido. Hay que borrarlo a mano antes de reintentar.",
                schema_name,
            )

    try:
        global_db.rollback()
        # Las membresías se crean después de esta función, pero se limpian por
        # si el fallo ocurre en un reintento sobre un inquilino ya enlazado.
        global_db.query(TenantUser).filter(TenantUser.tenant_id == tenant.id).delete(
            synchronize_session=False
        )
        global_db.delete(tenant)
        global_db.commit()
    except Exception:
        global_db.rollback()
        logger.exception(
            "No se pudo eliminar el registro del inquilino %s tras un "
            "aprovisionamiento fallido.",
            tenant.id,
        )
