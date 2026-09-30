"""suscripciones, pagos, reglas de cobranza y equipo de Factureando

Revision ID: b1c2d3e4f5a6
Revises: a9b0c1d2e3f4
Create Date: 2026-09-30

Todo en `public` (ver tasks/saas_admin.md):
- `saas_plans`: `meses`, `cuotas_sin_interes`, `incluye_impresora` y `precio`
  (entero, con IVA) en vez de `price_monthly`. Se siembran Mensual, Pack 6,
  Pack 12 y Cortesía.
- `tenants`: `suscripcion_vence` y `prorroga_hasta`; se borra `billing_day`.
  Las empresas que ya existen quedan en Cortesía (no vencen) y conservan su cupo
  de usuarios en `max_users_override`.
- Tablas nuevas `saas_pagos`, `saas_ajustes` (una fila) y `saas_cargos`, y
  `saas_users.cargo_id`.

SQL calificado con `public.` e `IF NOT EXISTS`, como a7b8c9d0e1f2. La siembra y
el paso a Cortesía corren solo la primera vez (si `saas_ajustes` no existía).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = 'a9b0c1d2e3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    primera_vez = not sa.inspect(op.get_bind()).has_table("saas_ajustes", schema="public")

    op.execute("""
        CREATE TABLE IF NOT EXISTS public.saas_cargos (
            id SERIAL PRIMARY KEY,
            nombre VARCHAR(60) NOT NULL UNIQUE,
            permisos JSON NOT NULL DEFAULT '[]'
        )
    """)
    op.execute("ALTER TABLE public.saas_users ADD COLUMN IF NOT EXISTS cargo_id INTEGER REFERENCES public.saas_cargos(id)")

    op.execute("""
        ALTER TABLE public.saas_plans
            ADD COLUMN IF NOT EXISTS meses INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS cuotas_sin_interes BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS incluye_impresora VARCHAR(40),
            ADD COLUMN IF NOT EXISTS precio INTEGER NOT NULL DEFAULT 0
    """)
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                       AND table_name = 'saas_plans' AND column_name = 'price_monthly') THEN
                UPDATE public.saas_plans SET precio = round(coalesce(price_monthly, 0));
                ALTER TABLE public.saas_plans DROP COLUMN price_monthly;
            END IF;
        END $$
    """)

    op.execute("""
        ALTER TABLE public.tenants
            ADD COLUMN IF NOT EXISTS suscripcion_vence DATE,
            ADD COLUMN IF NOT EXISTS prorroga_hasta TIMESTAMPTZ,
            DROP COLUMN IF EXISTS billing_day
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS public.saas_pagos (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES public.tenants(id),
            plan_id INTEGER NOT NULL REFERENCES public.saas_plans(id),
            monto INTEGER NOT NULL,
            medio VARCHAR(20) NOT NULL,
            estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
            referencia VARCHAR(100) UNIQUE,
            periodo_desde DATE,
            periodo_hasta DATE,
            vence_anterior DATE,
            nota VARCHAR(300),
            creado_por INTEGER REFERENCES public.saas_users(id),
            created_at TIMESTAMPTZ DEFAULT now(),
            pagado_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_public_saas_pagos_tenant_id ON public.saas_pagos (tenant_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS public.saas_ajustes (
            id INTEGER PRIMARY KEY,
            dias_aviso INTEGER NOT NULL DEFAULT 7,
            dias_gracia INTEGER NOT NULL DEFAULT 5,
            horas_prorroga INTEGER NOT NULL DEFAULT 12
        )
    """)

    _usuario_de_soporte_en_cada_empresa()

    if not primera_vez:
        return

    op.execute("INSERT INTO public.saas_ajustes (id) VALUES (1) ON CONFLICT DO NOTHING")
    # $33.333 al mes con IVA; packs con 5% y 10% de descuento, impresora y cuotas sin
    # interés (la comisión la paga Factureando). Se cambian en saas-admin > Planes.
    valores = """(VALUES
            ('Mensual', 'Pago mes a mes', 33333, 1, 3, false, NULL),
            ('Pack 6 meses', '5% de descuento, impresora térmica e instalación', 189998, 6, 3, true, 'Térmica 57 mm'),
            ('Pack 12 meses', '10% de descuento, impresora térmica e instalación', 359996, 12, 3, true, 'Térmica 80 mm'),
            ('Cortesía', 'Sin vencimiento: piloto y pruebas', 0, 0, 3, false, NULL)
        ) AS v(name, description, precio, meses, max_users, cuotas_sin_interes, incluye_impresora)"""
    # Si ya hay planes con estos nombres (p.ej. tras un downgrade), se dejan como la siembra.
    op.execute(f"""
        UPDATE public.saas_plans p
        SET description = v.description, precio = v.precio, meses = v.meses, max_users = v.max_users,
            cuotas_sin_interes = v.cuotas_sin_interes, incluye_impresora = v.incluye_impresora, is_active = true
        FROM {valores}
        WHERE p.name = v.name
    """)
    op.execute(f"""
        INSERT INTO public.saas_plans (name, description, precio, meses, max_users, cuotas_sin_interes, incluye_impresora, is_active)
        SELECT v.*, true FROM {valores}
        WHERE NOT EXISTS (SELECT 1 FROM public.saas_plans p WHERE p.name = v.name)
    """)
    op.execute("""
        UPDATE public.tenants t
        SET max_users_override = COALESCE(
                t.max_users_override,
                (SELECT p.max_users FROM public.saas_plans p WHERE p.id = t.plan_id),
                3),
            plan_id = (SELECT id FROM public.saas_plans WHERE name = 'Cortesía' AND meses = 0 ORDER BY id DESC LIMIT 1)
    """)


def _usuario_de_soporte_en_cada_empresa() -> None:
    """Reemplaza a los endpoints `inject-system-user*`, que se borran: las empresas
    creadas antes del usuario de soporte lo reciben aquí (las nuevas ya nacen con él,
    `tenant_service.provision_new_tenant`). Sin él, el superusuario no puede operar
    dentro de la empresa (`get_current_local_user`)."""
    esquemas = op.get_bind().execute(sa.text(
        "SELECT table_schema FROM information_schema.columns "
        "WHERE table_name = 'users' AND column_name = 'is_system_user' AND table_schema <> 'public'"
    )).scalars().all()
    for esquema in esquemas:
        op.execute(f"""
            INSERT INTO "{esquema}".users
                (rut, razon_social, email, full_name, is_system_user, is_active, role_id, role, password_hash)
            SELECT '0-0', 'Soporte Torn', 'soporte@torn.cl', 'Soporte Sistema', true, true,
                   COALESCE((SELECT id FROM "{esquema}".roles WHERE name = 'ADMINISTRADOR' LIMIT 1), 1),
                   'ADMIN', 'INVALID_HASH'
            WHERE NOT EXISTS (SELECT 1 FROM "{esquema}".users
                              WHERE is_system_user = true OR email = 'soporte@torn.cl')
        """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.saas_ajustes")
    op.execute("DROP TABLE IF EXISTS public.saas_pagos")
    op.execute("""
        ALTER TABLE public.tenants
            DROP COLUMN IF EXISTS prorroga_hasta,
            DROP COLUMN IF EXISTS suscripcion_vence,
            ADD COLUMN IF NOT EXISTS billing_day INTEGER DEFAULT 1
    """)
    op.execute("""
        ALTER TABLE public.saas_plans
            ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(10, 2) DEFAULT 0
    """)
    op.execute("UPDATE public.saas_plans SET price_monthly = precio")
    op.execute("""
        ALTER TABLE public.saas_plans
            DROP COLUMN IF EXISTS precio,
            DROP COLUMN IF EXISTS incluye_impresora,
            DROP COLUMN IF EXISTS cuotas_sin_interes,
            DROP COLUMN IF EXISTS meses
    """)
    op.execute("ALTER TABLE public.saas_users DROP COLUMN IF EXISTS cargo_id")
    op.execute("DROP TABLE IF EXISTS public.saas_cargos")
