"""Configuración de fixtures para tests de integración.

La suite corre íntegra sobre SQLite y sin red: `TORN_AUTO_CREATE_TABLES=0` evita
que el arranque de la app toque PostgreSQL, y las dependencias de multi-tenancy
(`get_tenant_db`, usuarios global/local, `require_admin`) se sustituyen por la
sesión de prueba y un usuario administrador fijo. Sin estos overrides cada
endpoint responde 401, porque los routers dejaron de usar `get_db` al migrar a
tenant-per-schema.
"""

import os
from collections import defaultdict
from decimal import Decimal

os.environ.setdefault("TORN_AUTO_CREATE_TABLES", "0")
os.environ.setdefault("SECRET_KEY", "test-secret-key")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies.tenant import (
    get_current_global_user,
    get_current_local_user,
    get_current_tenant_user,
    get_global_db,
    get_tenant_db,
    require_admin,
)
from app.main import app
from app.models.saas import SaaSUser, TenantUser
from app.models.user import User
from app.services import dte_client
from app.utils.taxes import monto_linea_dte, totales_dte

# ── BD en memoria para tests ────────────────────────────────────────
SQLALCHEMY_TEST_URL = "sqlite://"

engine_test = create_engine(
    SQLALCHEMY_TEST_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=engine_test
)

#: Modelos que viven en el esquema `public` de PostgreSQL. SQLite no tiene
#: esquemas, así que se excluyen de la creación de tablas de la BD de prueba.
_SAAS_TABLES = [
    table for table in Base.metadata.sorted_tables if table.schema == "public"
]
_TENANT_TABLES = [
    table for table in Base.metadata.sorted_tables if table.schema != "public"
]


@pytest.fixture(scope="function")
def db_session():
    """Crea tablas frescas para cada test y las destruye al terminar."""
    Base.metadata.create_all(bind=engine_test, tables=_TENANT_TABLES)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine_test, tables=_TENANT_TABLES)


@pytest.fixture(scope="function")
def admin_local_user(db_session):
    """Usuario operativo (id=1) que actúa como cajero/administrador local."""
    user = db_session.get(User, 1)
    if not user:
        user = User(
            id=1,
            rut="11111111-1",
            razon_social="Admin",
            email="admin@torn.cl",
        )
        db_session.add(user)
        db_session.commit()
    return user


@pytest.fixture(scope="function")
def client(db_session, admin_local_user):
    """TestClient de FastAPI con la BD y la identidad de prueba inyectadas."""

    def override_db():
        yield db_session

    global_user = SaaSUser(
        id=1, email="admin@torn.cl", full_name="Admin", is_superuser=False
    )
    tenant_user = TenantUser(
        tenant_id=1, user_id=1, role_name="ADMINISTRADOR", is_active=True
    )

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_tenant_db] = override_db
    app.dependency_overrides[get_global_db] = override_db
    app.dependency_overrides[get_current_global_user] = lambda: global_user
    app.dependency_overrides[get_current_tenant_user] = lambda: tenant_user
    app.dependency_overrides[require_admin] = lambda: tenant_user
    app.dependency_overrides[get_current_local_user] = lambda: admin_local_user

    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class FakeDte:
    """dte-torn de mentira: folios correlativos por tipo y totales del payload.

    `documentos` guarda lo que se emitió; `error` hace fallar la próxima emisión.
    """

    def __init__(self):
        self.documentos = []
        self.error = None
        self._folios = defaultdict(int)

    def emitir(self, tenant_id, documento, actor=None):
        if self.error:
            raise self.error
        self.documentos.append(documento)
        self._folios[documento["tipo_dte"]] += 1
        lineas = [
            (monto_linea_dte(Decimal(i["cantidad"]), Decimal(i["precio"]), Decimal(i["descuento"])), i["exento"])
            for i in documento["items"]
        ]
        _, _, _, total = totales_dte(documento["tipo_dte"], lineas)
        return {"folio": self._folios[documento["tipo_dte"]], "monto_total": int(total)}


@pytest.fixture(autouse=True)
def fake_dte(monkeypatch):
    """Ningún test habla con un dte-torn real."""
    fake = FakeDte()
    monkeypatch.setattr(dte_client, "emitir", fake.emitir)
    return fake
