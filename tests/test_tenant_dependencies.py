"""Verifica el enrutamiento de esquema de app/dependencies/tenant.py contra
PostgreSQL real (issue #38).

La suite principal corre sobre SQLite en memoria con get_tenant_db/get_global_db
sobreescritas (ver conftest.py), así que nunca ejercita esta lógica. Es
justamente el código más sensible del proyecto: un error aquí puede filtrar
datos entre inquilinos o escribir en el esquema equivocado, como pasó durante
el desarrollo de esta misma protección (create_user escribía en `public.users`
en vez del esquema del tenant después del primer commit() — ver el historial
de app/dependencies/tenant.py).

Requiere una PostgreSQL real alcanzable con las TORN_DB_* del entorno (la del
docker-compose del proyecto, o el servicio de Postgres en CI). Si no hay
ninguna disponible, se salta entera.

Corre contra la base configurada en TORN_DB_*, que normalmente es la de
desarrollo: cada fila que crea queda marcada con el nombre de esquema único
de la prueba y se borra explícitamente al terminar (no se apoya en rollback,
porque lo que se está probando es precisamente el comportamiento a través de
varios commit()).
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.database import Base, engine
from app.dependencies.tenant import get_global_db, get_tenant_db
from app.models.payment import PaymentMethod
from app.models.saas import SaaSPlan, SaaSUser, Tenant, TenantUser


def _postgres_available() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except OperationalError:
        return False


pytestmark = pytest.mark.skipif(
    not _postgres_available(),
    reason="Requiere PostgreSQL real (TORN_DB_*); no disponible en este entorno.",
)


@pytest.fixture(scope="module", autouse=True)
def ensure_public_tables():
    """Crea las tablas 'public' que estas pruebas necesitan si no existen.

    Contra la base de desarrollo ya existen (las creó el aprovisionamiento
    real); contra el Postgres vacío de CI no. `create_all` con `checkfirst`
    (el default) no toca nada si ya están, así que es seguro en ambos casos.
    No usa Alembic porque la cadena de migraciones asume tablas de tenant
    preexistentes (ver #33) y fallaría en una base recién creada.
    """
    if not _postgres_available():
        return
    Base.metadata.create_all(
        bind=engine,
        tables=[SaaSPlan.__table__, SaaSUser.__table__, Tenant.__table__, TenantUser.__table__],
    )


class TenantFixture:
    """Esquema de prueba aislado + limpieza explícita de lo que se cree en
    `public` bajo su nombre (las filas de un `Tenant`/`SaaSPlan` de prueba no
    viven en el esquema temporal, que se destruye con DROP SCHEMA)."""

    def __init__(self, schema_name: str):
        self.schema_name = schema_name

    def plan_name(self, label: str) -> str:
        """Nombre de SaaSPlan único para esta prueba, fácil de borrar después."""
        return f"{label} [{self.schema_name}]"


@pytest.fixture
def tenant_fixture():
    schema_name = f"test_tenant_{uuid.uuid4().hex[:12]}"
    with engine.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema_name}"'))
        conn.commit()

    connection = engine.connect()
    connection.execution_options(schema_translate_map={None: schema_name})
    Base.metadata.create_all(bind=connection, tables=[PaymentMethod.__table__])
    connection.commit()
    connection.close()

    fx = TenantFixture(schema_name)
    try:
        yield fx
    finally:
        with engine.connect() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema_name}" CASCADE'))
            conn.execute(
                text("DELETE FROM public.tenant_users WHERE tenant_id IN "
                     "(SELECT id FROM public.tenants WHERE schema_name = :s)"),
                {"s": schema_name},
            )
            conn.execute(text("DELETE FROM public.tenants WHERE schema_name = :s"), {"s": schema_name})
            conn.execute(text("DELETE FROM public.saas_plans WHERE name LIKE :pat"), {"pat": f"%[{schema_name}]"})
            conn.commit()


class TestConexionUnicaPorPeticion:
    """El mecanismo real que usa get_tenant_db: reusar la conexión de
    get_global_db en vez de abrir una segunda."""

    def test_get_tenant_db_reusa_la_sesion_de_get_global_db(self, tenant_fixture):
        global_gen = get_global_db()
        global_db = next(global_gen)
        try:
            assert engine.pool.checkedout() == 1, (
                "get_global_db debe abrir exactamente una conexión"
            )

            plan = SaaSPlan(name=tenant_fixture.plan_name("Plan Test"), max_users=5)
            global_db.add(plan)
            global_db.commit()

            connection = global_db.connection()
            connection.execution_options(schema_translate_map={None: tenant_fixture.schema_name})

            assert engine.pool.checkedout() == 1, (
                "aplicar el schema_translate_map no debe abrir una segunda conexión"
            )
        finally:
            global_gen.close()

        assert engine.pool.checkedout() == 0, "la conexión debe volver al pool al cerrar"

    def test_schema_translate_map_sobrevive_a_multiples_commits(self, tenant_fixture):
        """Regresión directa del bug: antes del fix, una sesión ligada al
        Engine devolvía su conexión al pool en cada commit() y la siguiente
        consulta tomaba una conexión nueva, sin el mapeo de esquema."""
        global_gen = get_global_db()
        global_db = next(global_gen)
        try:
            connection = global_db.connection()
            connection.execution_options(schema_translate_map={None: tenant_fixture.schema_name})

            # 1er commit: sobre una tabla 'public' explícita.
            plan = SaaSPlan(name=tenant_fixture.plan_name("Plan Antes Del Commit"), max_users=1)
            global_db.add(plan)
            global_db.commit()

            # 2do commit: sobre una tabla del tenant (schema=None → traducida).
            # Si el mapeo se hubiera perdido, esto habría insertado en
            # 'public.payment_methods' en vez del esquema de prueba.
            pm = PaymentMethod(code="EFECTIVO", name="Efectivo")
            global_db.add(pm)
            global_db.commit()

            # `schema_translate_map` sólo traduce Table/ORM compilados, no
            # texto SQL crudo: la verificación tiene que ir por la misma vía
            # que usa el resto del código (session.query), no por text().
            in_tenant_schema = global_db.query(PaymentMethod).filter(PaymentMethod.code == "EFECTIVO").count()
            assert in_tenant_schema == 1
        finally:
            global_gen.close()

    def test_consultas_intercaladas_public_y_tenant_resuelven_al_esquema_correcto(self, tenant_fixture):
        """Reproduce el patrón de app/routers/users.py: alternar consultas al
        esquema 'public' y al del tenant dentro de la misma conexión."""
        global_gen = get_global_db()
        global_db = next(global_gen)
        try:
            connection = global_db.connection()
            connection.execution_options(schema_translate_map={None: tenant_fixture.schema_name})

            global_db.add(PaymentMethod(code="DEBITO", name="Débito"))
            global_db.commit()

            plan_name = tenant_fixture.plan_name("Plan Intercalado")
            global_db.add(SaaSPlan(name=plan_name, max_users=2))
            global_db.commit()

            global_db.add(PaymentMethod(code="CREDITO", name="Crédito"))
            global_db.commit()

            tenant_count = global_db.query(PaymentMethod).count()
            assert tenant_count == 2

            public_count = global_db.query(SaaSPlan).filter(SaaSPlan.name == plan_name).count()
            assert public_count == 1
        finally:
            global_gen.close()


class TestGetTenantDbReal:
    """Ejercita get_tenant_db en sí (no una reimplementación de su lógica)."""

    def test_get_tenant_db_yields_global_db_y_resuelve_al_tenant(self, tenant_fixture):
        global_gen = get_global_db()
        global_db = next(global_gen)
        try:
            tenant = Tenant(
                name="Tenant Real Test",
                rut=f"{uuid.uuid4().int % 90000000 + 10000000}-1",
                schema_name=tenant_fixture.schema_name,
                is_active=True,
            )
            global_db.add(tenant)
            global_db.commit()

            tenant_user = TenantUser(
                tenant_id=tenant.id, user_id=1, role_name="ADMINISTRADOR"
            )

            tenant_gen = get_tenant_db(
                x_tenant_id=tenant.id, tenant_user=tenant_user, global_db=global_db
            )
            try:
                tenant_db = next(tenant_gen)
                assert tenant_db is global_db, (
                    "get_tenant_db debe reusar la sesión de global_db, no abrir una nueva"
                )
                assert engine.pool.checkedout() == 1

                tenant_db.add(PaymentMethod(code="EFECTIVO", name="Efectivo"))
                tenant_db.commit()

                # Segunda escritura tras el commit, ahora sobre 'public': el
                # punto exacto donde fallaba antes del fix.
                global_db.add(SaaSPlan(name=tenant_fixture.plan_name("Plan Post Commit"), max_users=1))
                global_db.commit()

                assert tenant_db.query(PaymentMethod).count() == 1
            finally:
                tenant_gen.close()
        finally:
            global_gen.close()

    def test_get_tenant_db_rechaza_tenant_inactivo(self, tenant_fixture):
        from fastapi import HTTPException

        global_gen = get_global_db()
        global_db = next(global_gen)
        try:
            tenant = Tenant(
                name="Tenant Inactivo Test",
                rut=f"{uuid.uuid4().int % 90000000 + 10000000}-2",
                schema_name=tenant_fixture.schema_name,
                is_active=False,
            )
            global_db.add(tenant)
            global_db.commit()

            tenant_user = TenantUser(
                tenant_id=tenant.id, user_id=1, role_name="ADMINISTRADOR"
            )

            with pytest.raises(HTTPException) as exc_info:
                next(get_tenant_db(x_tenant_id=tenant.id, tenant_user=tenant_user, global_db=global_db))
            assert exc_info.value.status_code == 404
        finally:
            global_gen.close()
