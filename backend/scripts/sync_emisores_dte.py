"""Copia a dte-torn el emisor y los datos del SII de todas las empresas.

Lo mismo que pasa al guardar el emisor desde la app, pero para todas de una vez:
sirve para la puesta en marcha y para reparar una sincronización fallida.

Uso (desde backend/, con TORN_DTE_URL y TORN_DTE_API_KEY en el .env):
    python scripts/sync_emisores_dte.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))

from sqlalchemy import text  # noqa: E402

from app.database import engine, SessionLocal  # noqa: E402
from app.models.saas import Tenant  # noqa: E402
from app.services import dte_client  # noqa: E402
from app.utils.schemas import safe_schema_name  # noqa: E402


def main() -> int:
    fallas = 0
    with SessionLocal() as db:
        tenants = db.query(Tenant).order_by(Tenant.id).all()
    for tenant in tenants:
        with engine.connect() as conn:
            issuer = conn.execute(
                text(f'SELECT * FROM "{safe_schema_name(tenant.schema_name)}".issuers LIMIT 1')
            ).first()
        if issuer is None:
            print(f"-  {tenant.id} {tenant.name}: sin emisor configurado, se omite")
            continue
        try:
            dte_client.sincronizar_emisor(tenant, issuer)
            print(f"ok {tenant.id} {tenant.name} ({issuer.rut}) -> {dte_client.tenant_uuid(tenant)}")
        except dte_client.DteError as exc:
            fallas += 1
            print(f"!! {tenant.id} {tenant.name} ({issuer.rut}): {exc.status_code} {exc.detail}")
    return 1 if fallas else 0


if __name__ == "__main__":
    if not os.getenv("TORN_DTE_URL"):
        sys.exit("Falta TORN_DTE_URL en el .env")
    sys.exit(main())
