"""Alta de DISTRIBUIDORA JCB SPA en Torn, con datos de demostración y sus DTE reales.

- Empresa y esquema: `provision_new_tenant`, lo mismo que hace saas-admin.
- Administrador: `assign_user_to_tenant`, con una contraseña aleatoria que se
  imprime una sola vez.
- Catálogo, clientes, proveedores y compras: de demostración, acordes al giro
  (artículos médicos, perfumería y bazar). Sin ventas inventadas: sus folios
  chocarían con la serie que lleva dte-torn.
- Documentos: los emitidos de verdad en la certificación, exportados de
  dte-torn (tabla `documents`) a un JSON, con sus folios y montos exactos.

Uso (dentro del contenedor del backend):
    python scripts/seed_jcb.py <docs.json> <email_admin>
"""

import json
import os
import secrets
import sys
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal  # noqa: E402
from app.models.saas import SaaSUser, Tenant
from app.routers.saas import assign_user_to_tenant
from app.schemas_saas import TenantUserCreate
from app.services.tenant_service import provision_new_tenant
from seed_tenants import DSN, insert_row, seed_tenant, upsert_id

RUT = "76.398.956-9"
ACTECO = {"code": "464903", "name": "VENTA AL POR MAYOR DE ARTÍCULOS DE PERFUMERÍA, DE TOCADOR Y COSMÉTICOS",
          "category": "1", "taxable": True}

now = datetime.now()
hace = lambda dias: now - timedelta(days=dias)  # noqa: E731

DATOS = {
    "brands": ["3M", "Medline", "Omron", "Nivea", "Natura", "Genérico"],
    "payment_methods": [
        {"code": "EFECTIVO", "name": "Efectivo"},
        {"code": "DEBITO", "name": "Débito"},
        {"code": "CREDITO", "name": "Crédito"},
        {"code": "TRANSFERENCIA", "name": "Transferencia"},
        {"code": "CREDITO_INTERNO", "name": "Crédito Interno"},
    ],
    "customers": [
        {"rut": "66666666-6", "razon_social": "Cliente Final (Boleta)", "giro": "Particular"},
        {"rut": "60.803.000-K", "razon_social": "Servicio de Impuestos Internos", "giro": "Gobierno",
         "direccion": "Teatinos 120", "comuna": "Santiago", "ciudad": "Santiago"},
        {"rut": "76.300.200-4", "razon_social": "Clínica del Sur SpA", "giro": "Servicios médicos",
         "email": "compras@clinicasur.cl", "direccion": "Av. Collao 1202", "comuna": "Concepción", "ciudad": "Concepción"},
        {"rut": "76.500.400-4", "razon_social": "Farmacia Salud Total Ltda.", "giro": "Farmacia",
         "email": "pedidos@saludtotal.cl", "direccion": "Barros Arana 780", "comuna": "Concepción", "ciudad": "Concepción"},
        {"rut": "76.100.048-9", "razon_social": "Perfumería Alpha SpA", "giro": "Venta de perfumes y cosméticos",
         "email": "compras@perfumeriaalpha.cl", "direccion": "Colo Colo 455", "comuna": "Concepción", "ciudad": "Concepción"},
    ],
    "providers": [
        {"rut": "77.900.800-2", "razon_social": "Insumos Médicos del Pacífico SpA", "giro": "Distribución médica",
         "email": "ventas@insumospacifico.cl", "ciudad": "Santiago"},
        {"rut": "76.111.222-8", "razon_social": "Importadora Cosmética Andina Ltda.", "giro": "Importación de cosméticos",
         "email": "contacto@cosmeticaandina.cl", "ciudad": "Santiago"},
        {"rut": "77.333.444-7", "razon_social": "Bazar Mayorista del Biobío S.A.", "giro": "Venta mayorista de bazar",
         "email": "ventas@bazarbiobio.cl", "ciudad": "Concepción"},
    ],
    "products": [
        {"sku": "MED-001", "nombre": "Guantes de Nitrilo", "descripcion": "Caja x100, sin polvo",
         "precio_neto": 8403, "costo_unitario": 5500, "unidad_medida": "caja", "stock_actual": 0, "stock_minimo": 20,
         "brand": "Medline", "variants": [
             {"sku": "MED-001-S", "nombre": "Guantes Nitrilo Talla S", "stock_actual": 0},
             {"sku": "MED-001-M", "nombre": "Guantes Nitrilo Talla M", "stock_actual": 0},
             {"sku": "MED-001-L", "nombre": "Guantes Nitrilo Talla L", "stock_actual": 0},
         ]},
        {"sku": "MED-002", "nombre": "Mascarilla N95", "precio_neto": 2521, "costo_unitario": 1500,
         "stock_actual": 0, "stock_minimo": 50, "brand": "3M"},
        {"sku": "MED-003", "nombre": "Tensiómetro Digital", "precio_neto": 33613, "costo_unitario": 22000,
         "stock_actual": 0, "stock_minimo": 3, "brand": "Omron"},
        {"sku": "MED-004", "nombre": "Alcohol Gel 500 ml", "precio_neto": 2101, "costo_unitario": 1200,
         "stock_actual": 0, "stock_minimo": 30, "brand": "Genérico"},
        {"sku": "PER-001", "nombre": "Crema Corporal 400 ml", "precio_neto": 4193, "costo_unitario": 2600,
         "stock_actual": 0, "stock_minimo": 20, "brand": "Nivea"},
        {"sku": "PER-002", "nombre": "Colonia Kaiak 100 ml", "precio_neto": 16798, "costo_unitario": 10500,
         "stock_actual": 0, "stock_minimo": 10, "brand": "Natura"},
        {"sku": "PER-003", "nombre": "Desodorante Roll-on 50 ml", "precio_neto": 2092, "costo_unitario": 1250,
         "stock_actual": 0, "stock_minimo": 40, "brand": "Nivea"},
        {"sku": "PER-004", "nombre": "Shampoo Neutro 1 L", "precio_neto": 2513, "costo_unitario": 1400,
         "stock_actual": 0, "stock_minimo": 30, "brand": "Genérico"},
        {"sku": "BAZ-001", "nombre": "Pañuelos Desechables x10", "precio_neto": 420, "costo_unitario": 210,
         "unidad_medida": "paquete", "stock_actual": 0, "stock_minimo": 100, "brand": "Genérico"},
        {"sku": "BAZ-002", "nombre": "Set Cepillos de Dientes x4", "precio_neto": 1672, "costo_unitario": 900,
         "stock_actual": 0, "stock_minimo": 30, "brand": "Genérico"},
    ],
    # El stock inicial entra por compras, como en la operación real.
    "purchases": [
        {"provider_rut": "77.900.800-2", "folio": "18234", "fecha": hace(30), "items": [
            {"sku": "MED-001-S", "qty": 30, "cost": 5500}, {"sku": "MED-001-M", "qty": 50, "cost": 5500},
            {"sku": "MED-001-L", "qty": 30, "cost": 5500}, {"sku": "MED-002", "qty": 300, "cost": 1500},
            {"sku": "MED-003", "qty": 12, "cost": 22000}, {"sku": "MED-004", "qty": 120, "cost": 1200}]},
        {"provider_rut": "76.111.222-8", "folio": "5521", "fecha": hace(14), "items": [
            {"sku": "PER-001", "qty": 80, "cost": 2600}, {"sku": "PER-002", "qty": 40, "cost": 10500},
            {"sku": "PER-003", "qty": 150, "cost": 1250}, {"sku": "PER-004", "qty": 100, "cost": 1400}]},
        {"provider_rut": "77.333.444-7", "folio": "90412", "fecha": hace(7), "items": [
            {"sku": "BAZ-001", "qty": 500, "cost": 210}, {"sku": "BAZ-002", "qty": 100, "cost": 900}]},
    ],
    "sales": [],
}


def _peso(x: Decimal) -> Decimal:
    return x.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def importar_documentos(cur, schema: str, docs: list) -> None:
    """Los DTE reales de la certificación, como ventas con su folio y montos."""
    cur.execute(f"SELECT id FROM {schema}.users WHERE is_system_user IS NOT TRUE ORDER BY id LIMIT 1")
    user_id = cur.fetchone()["id"]

    productos = {}
    for d in docs:
        for it in d["payload"]["items"]:
            nombre = it["nombre"]
            if nombre not in productos:
                productos[nombre] = upsert_id(cur, schema, "products", "codigo_interno", {
                    "codigo_interno": f"CERT-{len(productos) + 1:03d}",
                    "nombre": nombre,
                    "descripcion": "Ítem de los documentos de certificación del SII",
                    "precio_neto": Decimal(it["precio"]),
                    "costo_unitario": Decimal("0"),
                    "unidad_medida": it.get("unidad") or "unidad",
                    "controla_stock": False,
                    "stock_actual": Decimal("0"),
                    "stock_minimo": Decimal("0"),
                    "is_active": False,  # no aparecen en el POS
                    "is_deleted": False,
                })

    ventas = {}
    for d in docs:
        p = d["payload"]
        rec = p["receptor"]
        cur.execute(f"SELECT id FROM {schema}.customers WHERE replace(rut, '.', '') = replace(%s, '.', '')", [rec["rut"]])
        customer_id = cur.fetchone()["id"]
        referencias = [{"tipo_documento": r["tipo_doc"], "folio": r["folio"], "fecha": r["fecha"],
                        "sii_reason_code": r.get("codigo"), "razon": r.get("razon")} for r in p["referencias"]] or None
        anulada = next((ventas.get((int(r["tipo_doc"]), int(r["folio"]))) for r in p["referencias"]
                        if r["tipo_doc"].isdigit() and (int(r["tipo_doc"]), int(r["folio"])) in ventas), None)
        sale_id = insert_row(cur, schema, "sales", {
            "user_id": user_id, "seller_id": user_id, "customer_id": customer_id,
            "folio": d["folio"], "tipo_dte": d["tipo_dte"], "fecha_emision": d["creado"], "created_at": d["creado"],
            "monto_neto": d["neto"] + d["exento"], "iva": d["iva"], "monto_total": d["total"],
            "descripcion": "Documento de certificación SII", "referencias": json.dumps(referencias) if referencias else None,
            "related_sale_id": anulada,
        })
        ventas[(d["tipo_dte"], d["folio"])] = sale_id
        for it in p["items"]:
            cantidad, precio = Decimal(it["cantidad"]), Decimal(it["precio"])
            bruto = _peso(cantidad * precio)
            descuento = _peso(bruto * Decimal(it["descuento_pct"]) / 100) if it.get("descuento_pct") else Decimal(it["descuento"])
            insert_row(cur, schema, "sale_details", {
                "sale_id": sale_id, "product_id": productos[it["nombre"]], "cantidad": cantidad,
                "precio_unitario": precio, "descuento": descuento, "subtotal": bruto - descuento,
            })
        print(f"  ✓ DTE {d['tipo_dte']} folio {d['folio']} (${d['total']})")


def main(ruta_docs: str, email: str) -> None:
    docs = json.load(open(ruta_docs, encoding="utf-8"))
    db = SessionLocal()
    if db.query(Tenant).filter(Tenant.rut == RUT).first():
        sys.exit(f"{RUT} ya existe en Torn; no se toca.")
    superuser = db.query(SaaSUser).filter(SaaSUser.is_superuser.is_(True)).order_by(SaaSUser.id).first()

    tenant = provision_new_tenant(
        global_db=db, tenant_name="DISTRIBUIDORA JCB SPA", rut=RUT, owner_id=superuser.id,
        address="OHIGGINS 465 LOCAL 39", commune="CONCEPCION", city="CONCEPCION",
        giro="COMERCIALIZACION DE ART Y EQUIPOS MEDICOS Y PERFUMERIA Y BAZAR", economic_activities=[ACTECO],
    )
    tenant.sii_ambiente = "CERT"
    tenant.sii_resolucion_numero = 0
    tenant.sii_resolucion_fecha = datetime(2020, 11, 30).date()
    tenant.sii_oficina = "S.I.I. - CONCEPCION"
    db.commit()
    print(f"✓ Empresa {tenant.id} ({tenant.schema_name})")

    clave = secrets.token_urlsafe(12)
    assign_user_to_tenant(tenant.id, TenantUserCreate(
        email=email, password=clave, full_name="Administrador JCB", role_name="ADMINISTRADOR",
    ), current_user=superuser, global_db=db)
    print(f"✓ Administrador {email}")

    conn = psycopg2.connect(DSN, cursor_factory=RealDictCursor)
    try:
        cur = conn.cursor()
        seed_tenant(cur, tenant.schema_name, DATOS)
        importar_documentos(cur, tenant.schema_name, docs)
        conn.commit()
    finally:
        conn.close()

    print(f"\nTENANT_ID={tenant.id}")
    print(f"CLAVE_ADMIN={clave}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
