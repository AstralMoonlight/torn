"""
Seed script for multi-tenant demo data.
Each tenant gets DIFFERENT data to prove data isolation.

Tenant 27 (tenant_167603513) — "Jonathan Isla E.I.R.L." → Tienda de Electrónica
Tenant 25 (tenant_763989569) — "Distribuidora JCB SpA"  → Distribuidora Médica
"""

import os
import sys
from decimal import Decimal
from datetime import datetime, timedelta

import psycopg2
from psycopg2.extras import RealDictCursor

DB_HOST = os.getenv("TORN_DB_HOST", "localhost")
DB_PORT = os.getenv("TORN_DB_PORT", "5433")
DB_NAME = os.getenv("TORN_DB_NAME", "torn_db")
DB_USER = os.getenv("TORN_DB_USER", "torn")
DB_PASS = os.getenv("TORN_DB_PASSWORD", "torn")

DSN = f"host={DB_HOST} port={DB_PORT} dbname={DB_NAME} user={DB_USER} password={DB_PASS}"

# ── Valid Chilean RUTs (calculated with correct check digit) ─────────

RUTS = {
    # Customers
    "boleta": "66666666-6",
    "empresa_alpha": "76.100.048-9",
    "persona_juan": "12.345.678-5",
    "persona_maria": "15.432.876-9",
    "clinica_sur": "76.300.200-4",
    "hospital_norte": "77.400.300-2",
    "farmacia_salud": "76.500.400-4",
    # Providers
    "prov_tech": "76.600.500-4",
    "prov_samsung": "77.700.600-2",
    "prov_logitech": "76.800.700-4",
    "prov_medica": "77.900.800-2",
    "prov_insumos": "76.111.222-8",
    "prov_equipos": "77.333.444-7",
}


def upsert_id(cur, schema, table, conflict_col, data):
    """Insert or update, returning the id."""
    cols = list(data.keys())
    vals = list(data.values())
    placeholders = ", ".join(["%s"] * len(vals))
    col_names = ", ".join(cols)
    set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != conflict_col)

    if set_clause:
        sql = f"""
            INSERT INTO {schema}.{table} ({col_names})
            VALUES ({placeholders})
            ON CONFLICT ({conflict_col}) DO UPDATE SET {set_clause}
            RETURNING id
        """
    else:
        sql = f"""
            INSERT INTO {schema}.{table} ({col_names})
            VALUES ({placeholders})
            ON CONFLICT ({conflict_col}) DO NOTHING
        """
        cur.execute(sql, vals)
        # If DO NOTHING, fetch existing
        cur.execute(f"SELECT id FROM {schema}.{table} WHERE {conflict_col} = %s", [data[conflict_col]])
        return cur.fetchone()["id"]

    cur.execute(sql, vals)
    return cur.fetchone()["id"]


def insert_row(cur, schema, table, data):
    """Simple insert returning id."""
    cols = list(data.keys())
    vals = list(data.values())
    placeholders = ", ".join(["%s"] * len(vals))
    col_names = ", ".join(cols)
    sql = f"INSERT INTO {schema}.{table} ({col_names}) VALUES ({placeholders}) RETURNING id"
    cur.execute(sql, vals)
    return cur.fetchone()["id"]


def seed_tenant(cur, schema, tenant_data):
    """Seed a single tenant schema with the provided data."""
    td = tenant_data

    print(f"\n{'='*60}")
    print(f"  Seeding: {schema}")
    print(f"{'='*60}")

    # ── 1. Brands ─────────────────────────────────────────────
    brand_ids = {}
    for b in td["brands"]:
        bid = upsert_id(cur, schema, "brands", "name", {"name": b})
        brand_ids[b] = bid
        print(f"  ✓ Brand: {b} (id={bid})")

    # ── 2. Payment Methods ────────────────────────────────────
    pm_ids = {}
    for pm in td["payment_methods"]:
        code = pm["code"]
        name = pm["name"]
        cur.execute(f"SELECT id FROM {schema}.payment_methods WHERE code = %s", [code])
        row = cur.fetchone()
        if row:
            pmid = row["id"]
        else:
            pmid = insert_row(cur, schema, "payment_methods", {"code": code, "name": name, "is_active": True})
        pm_ids[name] = pmid
        print(f"  ✓ PaymentMethod: {name} (id={pmid})")

    # ── 3. Customers ──────────────────────────────────────────
    cust_ids = {}
    for c in td["customers"]:
        cid = upsert_id(cur, schema, "customers", "rut", {
            "rut": c["rut"],
            "razon_social": c["razon_social"],
            "giro": c.get("giro"),
            "email": c.get("email"),
            "ciudad": c.get("ciudad"),
            "current_balance": Decimal("0"),
            "is_active": True,
        })
        cust_ids[c["rut"]] = cid
        print(f"  ✓ Customer: {c['razon_social']} (id={cid})")

    # ── 4. Providers ──────────────────────────────────────────
    prov_ids = {}
    for p in td["providers"]:
        pid = upsert_id(cur, schema, "providers", "rut", {
            "rut": p["rut"],
            "razon_social": p["razon_social"],
            "giro": p.get("giro"),
            "email": p.get("email"),
            "ciudad": p.get("ciudad"),
            "telefono": p.get("telefono"),
            "is_active": True,
        })
        prov_ids[p["rut"]] = pid
        print(f"  ✓ Provider: {p['razon_social']} (id={pid})")

    # ── 5. Products (simple + with variants) ──────────────────
    prod_ids = {}
    for p in td["products"]:
        parent_brand = brand_ids.get(p.get("brand"))
        pid = upsert_id(cur, schema, "products", "codigo_interno", {
            "codigo_interno": p["sku"],
            "nombre": p["nombre"],
            "descripcion": p.get("descripcion"),
            "precio_neto": p["precio_neto"],
            "costo_unitario": p.get("costo_unitario", Decimal("0")),
            "unidad_medida": p.get("unidad_medida", "unidad"),
            "codigo_barras": p.get("codigo_barras"),
            "controla_stock": p.get("controla_stock", True),
            "stock_actual": p.get("stock_actual", Decimal("0")),
            "stock_minimo": p.get("stock_minimo", Decimal("5")),
            "brand_id": parent_brand,
            "is_active": True,
            "is_deleted": False,
        })
        prod_ids[p["sku"]] = pid
        print(f"  ✓ Product: {p['nombre']} (id={pid})")

        # Variants
        for vi, v in enumerate(p.get("variants", []), 1):
            v_sku = v.get("sku", f"{p['sku']}-V{vi:02d}")
            vid = upsert_id(cur, schema, "products", "codigo_interno", {
                "codigo_interno": v_sku,
                "nombre": v["nombre"],
                "descripcion": v.get("descripcion"),
                "precio_neto": v.get("precio_neto", p["precio_neto"]),
                "costo_unitario": v.get("costo_unitario", p.get("costo_unitario", Decimal("0"))),
                "unidad_medida": p.get("unidad_medida", "unidad"),
                "controla_stock": True,
                "stock_actual": v.get("stock_actual", Decimal("10")),
                "stock_minimo": Decimal("3"),
                "brand_id": parent_brand,
                "parent_id": pid,
                "is_active": True,
                "is_deleted": False,
            })
            prod_ids[v_sku] = vid
            print(f"    ✓ Variant: {v['nombre']} (id={vid})")

    # ── 6. Get local user_id (owner synced from global) ───────
    cur.execute(f"SELECT id FROM {schema}.users WHERE is_active = true AND role IN ('ADMIN','OWNER') LIMIT 1")
    row = cur.fetchone()
    if not row:
        cur.execute(f"SELECT id FROM {schema}.users WHERE is_active = true LIMIT 1")
        row = cur.fetchone()
    if not row:
        print("  ⚠ No local user found — skipping sales & purchases")
        return
    local_user_id = row["id"]
    print(f"  ✓ Local user_id: {local_user_id}")

    # ── 7. Purchases ──────────────────────────────────────────
    for px in td.get("purchases", []):
        prov_id = prov_ids.get(px["provider_rut"])
        if not prov_id:
            print(f"  ⚠ Provider {px['provider_rut']} not found, skipping purchase")
            continue

        items = px["items"]
        monto_neto = sum(Decimal(str(i["qty"])) * Decimal(str(i["cost"])) for i in items)
        iva = (monto_neto * Decimal("0.19")).quantize(Decimal("0.01"))
        monto_total = monto_neto + iva

        purchase_id = insert_row(cur, schema, "purchases", {
            "provider_id": prov_id,
            "folio": px.get("folio"),
            "tipo_documento": px.get("tipo_documento", "FACTURA"),
            "fecha_compra": px.get("fecha", datetime.now()),
            "monto_neto": monto_neto,
            "iva": iva,
            "monto_total": monto_total,
            "observacion": px.get("observacion"),
        })
        print(f"  ✓ Purchase #{purchase_id} (folio={px.get('folio')}, total=${monto_total})")

        for it in items:
            p_id = prod_ids.get(it["sku"])
            if not p_id:
                print(f"    ⚠ Product {it['sku']} not found, skipping item")
                continue
            qty = Decimal(str(it["qty"]))
            cost = Decimal(str(it["cost"]))
            insert_row(cur, schema, "purchase_details", {
                "purchase_id": purchase_id,
                "product_id": p_id,
                "cantidad": qty,
                "precio_costo_unitario": cost,
                "subtotal": qty * cost,
            })
            # Update stock and cost
            cur.execute(f"""
                UPDATE {schema}.products 
                SET stock_actual = stock_actual + %s, costo_unitario = %s 
                WHERE id = %s
            """, [qty, cost, p_id])

    # ── 8. Sales ──────────────────────────────────────────────
    cur.execute(f"SELECT COALESCE(MAX(folio), 0) as max_folio FROM {schema}.sales")
    next_folio = cur.fetchone()["max_folio"] + 1

    for sx in td.get("sales", []):
        cust_id = cust_ids.get(sx["customer_rut"])
        items = sx["items"]
        monto_neto = sum(Decimal(str(i["qty"])) * Decimal(str(i["price"])) for i in items)
        iva = (monto_neto * Decimal("0.19")).quantize(Decimal("0.01"))
        monto_total = monto_neto + iva

        sale_id = insert_row(cur, schema, "sales", {
            "user_id": local_user_id,
            "folio": next_folio,
            "tipo_dte": sx.get("tipo_dte", 39),
            "fecha_emision": sx.get("fecha", datetime.now()),
            "monto_neto": monto_neto,
            "iva": iva,
            "monto_total": monto_total,
            "customer_id": cust_id,
            "seller_id": local_user_id,
        })
        print(f"  ✓ Sale #{sale_id} folio={next_folio} (${monto_total})")
        next_folio += 1

        for it in items:
            p_id = prod_ids.get(it["sku"])
            if not p_id:
                continue
            qty = Decimal(str(it["qty"]))
            price = Decimal(str(it["price"]))
            insert_row(cur, schema, "sale_details", {
                "sale_id": sale_id,
                "product_id": p_id,
                "cantidad": qty,
                "precio_unitario": price,
                "descuento": Decimal("0"),
                "subtotal": qty * price,
            })
            # Deduct stock
            cur.execute(f"""
                UPDATE {schema}.products SET stock_actual = stock_actual - %s WHERE id = %s
            """, [qty, p_id])

        # Payment
        pm_name = sx.get("payment_method", "Efectivo")
        pm_id = pm_ids.get(pm_name, list(pm_ids.values())[0])
        insert_row(cur, schema, "sale_payments", {
            "sale_id": sale_id,
            "payment_method_id": pm_id,
            "amount": monto_total,
        })


# ═══════════════════════════════════════════════════════════════
#  TENANT DATA DEFINITIONS  (completely different per tenant)
# ═══════════════════════════════════════════════════════════════

now = datetime.now()
week_ago = now - timedelta(days=7)
two_weeks = now - timedelta(days=14)
month_ago = now - timedelta(days=30)

TENANT_ELECTRONICA = {
    "brands": ["Samsung", "Logitech", "Apple", "Xiaomi", "HP"],
    "payment_methods": [
        {"code": "EFECTIVO", "name": "Efectivo"},
        {"code": "DEBITO", "name": "Débito"},
        {"code": "CREDITO", "name": "Crédito"},
        {"code": "TRANSFERENCIA", "name": "Transferencia"},
    ],
    "customers": [
        {"rut": "66666666-6", "razon_social": "Cliente Final (Boleta)", "giro": "Particular"},
        {"rut": "12.345.678-5", "razon_social": "Juan Pérez Soto", "email": "juan@email.com", "ciudad": "Santiago"},
        {"rut": "15.432.876-9", "razon_social": "María González Rivas", "email": "maria@email.com", "ciudad": "Valparaíso"},
        {"rut": "76.100.048-9", "razon_social": "TechCorp SpA", "giro": "Venta de tecnología", "email": "compras@techcorp.cl", "ciudad": "Santiago"},
    ],
    "providers": [
        {"rut": "76.600.500-4", "razon_social": "Distribuidora Tech Chile SpA", "giro": "Importación electrónica", "email": "ventas@techChile.cl", "ciudad": "Santiago", "telefono": "+56912345678"},
        {"rut": "77.700.600-2", "razon_social": "Samsung Chile S.A.", "giro": "Fabricante electrónico", "email": "b2b@samsung.cl", "ciudad": "Santiago"},
        {"rut": "76.800.700-4", "razon_social": "Logitech Distribución Ltda.", "giro": "Periféricos", "email": "pedidos@logitech.cl", "ciudad": "Las Condes"},
    ],
    "products": [
        {
            "sku": "ELEC-001", "nombre": "Mouse Inalámbrico M185", "descripcion": "Mouse básico inalámbrico Logitech",
            "precio_neto": 8395, "costo_unitario": 5000, "unidad_medida": "unidad",
            "codigo_barras": "7801234567890", "stock_actual": 50, "stock_minimo": 10, "brand": "Logitech",
        },
        {
            "sku": "ELEC-002", "nombre": "Teclado Mecánico K835", "descripcion": "Teclado TKL Switch Rojo",
            "precio_neto": 37815, "costo_unitario": 22000, "unidad_medida": "unidad",
            "codigo_barras": "7800987654321", "stock_actual": 15, "stock_minimo": 5, "brand": "Logitech",
        },
        {
            "sku": "ELEC-003", "nombre": "Galaxy A15", "descripcion": "Smartphone Samsung Galaxy A15 128GB",
            "precio_neto": 126050, "costo_unitario": 85000, "unidad_medida": "unidad",
            "stock_actual": 20, "stock_minimo": 5, "brand": "Samsung",
            "variants": [
                {"sku": "ELEC-003-BLK", "nombre": "Galaxy A15 - Negro 128GB", "stock_actual": 12},
                {"sku": "ELEC-003-WHT", "nombre": "Galaxy A15 - Blanco 128GB", "stock_actual": 8},
                {"sku": "ELEC-003-BLU", "nombre": "Galaxy A15 - Azul 128GB", "stock_actual": 6},
            ],
        },
        {
            "sku": "ELEC-004", "nombre": "Audífonos Bluetooth Xiaomi", "descripcion": "Redmi Buds 4 Active",
            "precio_neto": 12605, "costo_unitario": 7500, "unidad_medida": "unidad",
            "stock_actual": 40, "stock_minimo": 8, "brand": "Xiaomi",
        },
        {
            "sku": "ELEC-005", "nombre": "Monitor HP 24\"", "descripcion": "Monitor FHD IPS 24 pulgadas",
            "precio_neto": 109244, "costo_unitario": 75000, "unidad_medida": "unidad",
            "stock_actual": 8, "stock_minimo": 3, "brand": "HP",
        },
        {
            "sku": "ELEC-006", "nombre": "Cable USB-C", "descripcion": "Cable USB-C a USB-C 1m",
            "precio_neto": 4202, "costo_unitario": 1500, "unidad_medida": "unidad",
            "stock_actual": 100, "stock_minimo": 20,
            "variants": [
                {"sku": "ELEC-006-1M", "nombre": "Cable USB-C 1m", "precio_neto": 4202, "costo_unitario": 1500, "stock_actual": 50},
                {"sku": "ELEC-006-2M", "nombre": "Cable USB-C 2m", "precio_neto": 5882, "costo_unitario": 2200, "stock_actual": 30},
            ],
        },
    ],
    "purchases": [
        {
            "provider_rut": "76.600.500-4", "folio": "F-10234", "tipo_documento": "FACTURA",
            "fecha": month_ago,
            "items": [
                {"sku": "ELEC-001", "qty": 30, "cost": 5000},
                {"sku": "ELEC-002", "qty": 10, "cost": 22000},
                {"sku": "ELEC-004", "qty": 20, "cost": 7500},
            ],
        },
        {
            "provider_rut": "77.700.600-2", "folio": "F-55001", "tipo_documento": "FACTURA",
            "fecha": two_weeks,
            "items": [
                {"sku": "ELEC-003-BLK", "qty": 12, "cost": 85000},
                {"sku": "ELEC-003-WHT", "qty": 8, "cost": 85000},
            ],
        },
        {
            "provider_rut": "76.800.700-4", "folio": "F-7890", "tipo_documento": "FACTURA",
            "fecha": week_ago,
            "items": [
                {"sku": "ELEC-005", "qty": 5, "cost": 75000},
                {"sku": "ELEC-006-1M", "qty": 50, "cost": 1500},
                {"sku": "ELEC-006-2M", "qty": 30, "cost": 2200},
            ],
        },
    ],
    "sales": [
        {
            "customer_rut": "66666666-6", "tipo_dte": 39, "fecha": month_ago,
            "items": [{"sku": "ELEC-001", "qty": 2, "price": 8395}, {"sku": "ELEC-004", "qty": 1, "price": 12605}],
            "payment_method": "Efectivo",
        },
        {
            "customer_rut": "12.345.678-5", "tipo_dte": 39, "fecha": two_weeks,
            "items": [{"sku": "ELEC-003-BLK", "qty": 1, "price": 126050}],
            "payment_method": "Crédito",
        },
        {
            "customer_rut": "76.100.048-9", "tipo_dte": 33, "fecha": week_ago,
            "items": [
                {"sku": "ELEC-005", "qty": 2, "price": 109244},
                {"sku": "ELEC-002", "qty": 3, "price": 37815},
            ],
            "payment_method": "Transferencia",
        },
        {
            "customer_rut": "15.432.876-9", "tipo_dte": 39, "fecha": now - timedelta(days=3),
            "items": [{"sku": "ELEC-006-1M", "qty": 3, "price": 4202}, {"sku": "ELEC-006-2M", "qty": 2, "price": 5882}],
            "payment_method": "Débito",
        },
        {
            "customer_rut": "66666666-6", "tipo_dte": 39, "fecha": now - timedelta(days=1),
            "items": [{"sku": "ELEC-001", "qty": 1, "price": 8395}, {"sku": "ELEC-002", "qty": 1, "price": 37815}],
            "payment_method": "Efectivo",
        },
    ],
}

TENANT_MEDICA = {
    "brands": ["3M", "Medline", "BD", "Omron", "Genérico"],
    "payment_methods": [
        {"code": "EFECTIVO", "name": "Efectivo"},
        {"code": "DEBITO", "name": "Débito"},
        {"code": "CREDITO", "name": "Crédito"},
        {"code": "OC", "name": "Orden de Compra"},
    ],
    "customers": [
        {"rut": "66666666-6", "razon_social": "Cliente Final (Boleta)", "giro": "Particular"},
        {"rut": "76.300.200-4", "razon_social": "Clínica del Sur SpA", "giro": "Servicios médicos", "email": "compras@clinicasur.cl", "ciudad": "Concepción"},
        {"rut": "77.400.300-2", "razon_social": "Hospital Regional del Norte", "giro": "Salud pública", "email": "abastecimiento@hrn.cl", "ciudad": "Antofagasta"},
        {"rut": "76.500.400-4", "razon_social": "Farmacia Salud Total Ltda.", "giro": "Farmacia", "email": "pedidos@saludtotal.cl", "ciudad": "Temuco"},
    ],
    "providers": [
        {"rut": "77.900.800-2", "razon_social": "Insumos Médicos del Pacífico SpA", "giro": "Distribución médica", "email": "ventas@insumospacifico.cl", "ciudad": "Santiago", "telefono": "+56987654321"},
        {"rut": "76.111.222-8", "razon_social": "Importadora Medical Supply Ltda.", "giro": "Importación insumos", "email": "contacto@medicalsupply.cl", "ciudad": "Santiago"},
        {"rut": "77.333.444-7", "razon_social": "Equipos Clínicos S.A.", "giro": "Equipamiento hospitalario", "email": "ventas@equiposclinicos.cl", "ciudad": "Viña del Mar"},
    ],
    "products": [
        {
            "sku": "MED-001", "nombre": "Guantes de Nitrilo", "descripcion": "Caja x100 guantes nitrilo sin polvo",
            "precio_neto": 8403, "costo_unitario": 5500, "unidad_medida": "caja",
            "stock_actual": 200, "stock_minimo": 50, "brand": "Medline",
            "variants": [
                {"sku": "MED-001-S", "nombre": "Guantes Nitrilo Talla S", "stock_actual": 60},
                {"sku": "MED-001-M", "nombre": "Guantes Nitrilo Talla M", "stock_actual": 80},
                {"sku": "MED-001-L", "nombre": "Guantes Nitrilo Talla L", "stock_actual": 60},
            ],
        },
        {
            "sku": "MED-002", "nombre": "Mascarilla N95 3M", "descripcion": "Respirador N95 modelo 9205+",
            "precio_neto": 2521, "costo_unitario": 1500, "unidad_medida": "unidad",
            "stock_actual": 500, "stock_minimo": 100, "brand": "3M",
        },
        {
            "sku": "MED-003", "nombre": "Jeringa 5ml BD", "descripcion": "Jeringa descartable 5ml con aguja 21G",
            "precio_neto": 252, "costo_unitario": 120, "unidad_medida": "unidad",
            "stock_actual": 1000, "stock_minimo": 200, "brand": "BD",
        },
        {
            "sku": "MED-004", "nombre": "Tensiómetro Digital Omron", "descripcion": "Monitor presión arterial HEM-7120",
            "precio_neto": 33613, "costo_unitario": 22000, "unidad_medida": "unidad",
            "stock_actual": 15, "stock_minimo": 5, "brand": "Omron",
        },
        {
            "sku": "MED-005", "nombre": "Alcohol Gel 500ml", "descripcion": "Gel antiséptico 70% alcohol",
            "precio_neto": 2101, "costo_unitario": 1200, "unidad_medida": "unidad",
            "stock_actual": 300, "stock_minimo": 50, "brand": "Genérico",
        },
        {
            "sku": "MED-006", "nombre": "Gasa Estéril 10x10", "descripcion": "Sobre individual gasa estéril",
            "precio_neto": 168, "costo_unitario": 80, "unidad_medida": "sobre",
            "stock_actual": 2000, "stock_minimo": 500, "brand": "Genérico",
        },
        {
            "sku": "MED-007", "nombre": "Oxímetro de Pulso", "descripcion": "Oxímetro digital de dedo",
            "precio_neto": 16807, "costo_unitario": 10000, "unidad_medida": "unidad",
            "stock_actual": 25, "stock_minimo": 5, "brand": "Omron",
        },
    ],
    "purchases": [
        {
            "provider_rut": "77.900.800-2", "folio": "OC-2024-001", "tipo_documento": "FACTURA",
            "fecha": month_ago,
            "items": [
                {"sku": "MED-001-S", "qty": 30, "cost": 5500},
                {"sku": "MED-001-M", "qty": 50, "cost": 5500},
                {"sku": "MED-001-L", "qty": 30, "cost": 5500},
                {"sku": "MED-002", "qty": 200, "cost": 1500},
                {"sku": "MED-005", "qty": 100, "cost": 1200},
            ],
        },
        {
            "provider_rut": "76.111.222-8", "folio": "OC-2024-002", "tipo_documento": "FACTURA",
            "fecha": two_weeks,
            "items": [
                {"sku": "MED-003", "qty": 500, "cost": 120},
                {"sku": "MED-006", "qty": 1000, "cost": 80},
            ],
        },
        {
            "provider_rut": "77.333.444-7", "folio": "OC-2024-003", "tipo_documento": "FACTURA",
            "fecha": week_ago,
            "items": [
                {"sku": "MED-004", "qty": 10, "cost": 22000},
                {"sku": "MED-007", "qty": 15, "cost": 10000},
            ],
        },
    ],
    "sales": [
        {
            "customer_rut": "76.300.200-4", "tipo_dte": 33, "fecha": month_ago,
            "items": [
                {"sku": "MED-001-M", "qty": 10, "price": 8403},
                {"sku": "MED-002", "qty": 50, "price": 2521},
                {"sku": "MED-003", "qty": 100, "price": 252},
            ],
            "payment_method": "Orden de Compra",
        },
        {
            "customer_rut": "77.400.300-2", "tipo_dte": 33, "fecha": two_weeks,
            "items": [
                {"sku": "MED-001-S", "qty": 20, "price": 8403},
                {"sku": "MED-001-L", "qty": 20, "price": 8403},
                {"sku": "MED-005", "qty": 50, "price": 2101},
                {"sku": "MED-006", "qty": 500, "price": 168},
            ],
            "payment_method": "Orden de Compra",
        },
        {
            "customer_rut": "76.500.400-4", "tipo_dte": 33, "fecha": week_ago,
            "items": [
                {"sku": "MED-004", "qty": 3, "price": 33613},
                {"sku": "MED-007", "qty": 5, "price": 16807},
            ],
            "payment_method": "Crédito",
        },
        {
            "customer_rut": "66666666-6", "tipo_dte": 39, "fecha": now - timedelta(days=2),
            "items": [
                {"sku": "MED-002", "qty": 5, "price": 2521},
                {"sku": "MED-005", "qty": 2, "price": 2101},
            ],
            "payment_method": "Efectivo",
        },
        {
            "customer_rut": "76.300.200-4", "tipo_dte": 33, "fecha": now - timedelta(days=1),
            "items": [
                {"sku": "MED-003", "qty": 200, "price": 252},
                {"sku": "MED-006", "qty": 300, "price": 168},
            ],
            "payment_method": "Orden de Compra",
        },
        {
            "customer_rut": "66666666-6", "tipo_dte": 39, "fecha": now,
            "items": [{"sku": "MED-007", "qty": 1, "price": 16807}],
            "payment_method": "Débito",
        },
    ],
}


def main():
    print("Connecting to database...")
    conn = psycopg2.connect(DSN, cursor_factory=RealDictCursor)
    conn.autocommit = False

    try:
        cur = conn.cursor()

        # Clear existing seeded data (reverse FK order)
        for schema in ["tenant_167603513", "tenant_763989569"]:
            print(f"\n  Cleaning {schema}...")
            for table in ["sale_payments", "sale_details", "sales", "purchase_details", "purchases",
                          "stock_movements", "products", "customers", "providers", "brands", "payment_methods"]:
                try:
                    cur.execute(f"DELETE FROM {schema}.{table}")
                except Exception as e:
                    print(f"    (skip {table}: {e})")
                    conn.rollback()
                    cur = conn.cursor()
            conn.commit()

        # Seed each tenant
        seed_tenant(cur, "tenant_167603513", TENANT_ELECTRONICA)
        conn.commit()

        seed_tenant(cur, "tenant_763989569", TENANT_MEDICA)
        conn.commit()

        print(f"\n{'='*60}")
        print("  ✅ ALL DONE — Both tenants seeded with unique data!")
        print(f"{'='*60}")

    except Exception as e:
        conn.rollback()
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
