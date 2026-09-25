"""El superusuario sin membresía recibe un TenantUser simulado.

Salía con `.tenant = None`, así que toda llamada a dte-torn hecha como
superusuario iba sin `X-Tenant-Id` (422 en folios, certificado y emisión).
"""

from unittest.mock import MagicMock

from sqlalchemy import inspect

from app.dependencies.tenant import get_current_tenant_user
from app.models.saas import SaaSUser, Tenant


def test_superusuario_sin_membresia_trae_la_empresa_y_no_entra_a_la_sesion():
    admin = SaaSUser(id=1, email="admin@torn.cl", is_superuser=True)
    tenant = Tenant(id=35, schema_name="tenant_jcb")
    db = MagicMock()
    db.query.return_value.options.return_value.filter.return_value.first.return_value = None
    db.get.return_value = tenant

    tu = get_current_tenant_user(35, admin, db)

    assert tu.tenant is tenant and tu.user is admin
    # Sin cascada: el backref no lo agregó a `tenant.users`, así que nunca se insertaría.
    assert tu not in tenant.users
    assert inspect(tu).transient
