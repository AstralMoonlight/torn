import os
import sys
from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def wipe_legacy_public_data():
    """
    Wipes domain data from the public schema that should now only live in tenant schemas.
    This acts as a 'chaos monkey': if the app secretly still relies on public schema for these, 
    it will break, allowing us to fix the leak.
    
    IMPORTANT: We do NOT truncate SaaS tables (users, tenants, plans, tenant_users) or alembic_version.
    """
    tables_to_truncate = [
        'stock_movements',
        'purchase_details',
        'purchases',
        'sale_payments',
        'sale_details',
        'sales',
        'cash_movements',
        'cash_sessions',
        'product_variants',
        'products',
        'brands',
        'providers',
        'customers',
        'issuers',
        'taxes',
        'system_settings'
    ]

    print("Starting wipe of legacy public schema data...")
    for table_name in tables_to_truncate:
        with engine.begin() as conn:
            try:
                # CASCADE handles foreign keys
                conn.execute(text(f'TRUNCATE TABLE public."{table_name}" CASCADE;'))
                print(f" [OK] Truncated public.{table_name}")
            except Exception as e:
                print(f" [WARN] Could not truncate public.{table_name}: {e}")
    
    print("Legacy public data wipe complete.")

if __name__ == "__main__":
    wipe_legacy_public_data()
