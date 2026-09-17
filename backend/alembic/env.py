from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from sqlalchemy.engine import Connection

from alembic import context

import os
import sys
from dotenv import load_dotenv

# Add the project root to the python path so `app` can be imported
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '..')))

from app.database import Base, DATABASE_URL
import app.models.saas
# Carga de modelos operativos
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

target_metadata = Base.metadata

config = context.config
# Sobrescribimos la URL de sqlalchemy.url con la definida en DATABASE_URL
config.set_main_option("sqlalchemy.url", DATABASE_URL)

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    # The connection might be passed directly programmatically
    # (e.g. from our tenant_service.py)
    connectable = config.attributes.get('connection', None)

    if connectable is None:
        connectable = engine_from_config(
            config.get_section(config.config_ini_section, {}),
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
        )

    if isinstance(connectable, Connection):
        schema_translate_map = None
        if hasattr(connectable, "_execution_options") and "schema_translate_map" in connectable._execution_options:
             schema_translate_map = connectable._execution_options["schema_translate_map"]

        mapped_schema = schema_translate_map.get(None) if schema_translate_map else None

        context.configure(
            connection=connectable, 
            target_metadata=target_metadata,
            include_schemas=True,
            version_table_schema=mapped_schema
        )
        with context.begin_transaction():
            context.run_migrations()
    else:
        with connectable.connect() as connection:
            schema_translate_map = None
            if hasattr(connection, "_execution_options") and "schema_translate_map" in connection._execution_options:
                 schema_translate_map = connection._execution_options["schema_translate_map"]
            mapped_schema = schema_translate_map.get(None) if schema_translate_map else None
            
            context.configure(
                connection=connection, 
                target_metadata=target_metadata,
                include_schemas=True,
                version_table_schema=mapped_schema
            )
            with context.begin_transaction():
                context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
