"""Prueba de carga del POS de Torn con Locust.

Simula cajeros que abren el POS (catálogo), escanean productos, buscan clientes,
consultan la caja y cobran ventas. Cada venta pasa por `POST /sales/`, que emite
el DTE en dte-torn dentro de la misma transacción, así que mide la cadena
completa: backend, Postgres y la firma en dte-torn.

Sirve para comparar dos servidores con la misma carga (ver README.md de esta
carpeta). Solo corre contra empresas en modo Desarrollador (DEV): ahí dte-torn
firma con un CAF de prueba y no habla con el SII. En CERT consume folios de
certificación y envía al SII, así que exige TORN_CARGA_PERMITIR_CERT=1; en PROD
no corre nunca.

Configuración (variables de entorno):
    TORN_CARGA_EMAIL          Usuario SaaS con acceso a las empresas.
    TORN_CARGA_PASSWORD       Su contraseña.
    TORN_CARGA_TENANTS        Ids de empresa separados por coma (p.ej. "3" o "3,4,5").
    TORN_CARGA_TIPO_DTE       Tipo de documento de las ventas (por defecto 39, boleta).
    TORN_CARGA_RUT_CLIENTE    Cliente de las ventas (por defecto 66666666-6).
    TORN_CARGA_ESPERA         Segundos entre acciones de un cajero, "min,max" (por defecto "1,3").
    TORN_CARGA_PERMITIR_CERT  "1" para aceptar empresas en CERT.

Uso:
    locust -f scripts/carga/locustfile.py --host http://IP:8000
"""

import logging
import os
import random
from decimal import Decimal

import gevent
import requests
from locust import HttpUser, between, events, tag, task
from locust.runners import MasterRunner

log = logging.getLogger("torn.carga")

EMAIL = os.getenv("TORN_CARGA_EMAIL", "")
PASSWORD = os.getenv("TORN_CARGA_PASSWORD", "")
TENANT_IDS = [int(t) for t in os.getenv("TORN_CARGA_TENANTS", "").split(",") if t.strip()]
TIPO_DTE = int(os.getenv("TORN_CARGA_TIPO_DTE", "39"))
RUT_CLIENTE = os.getenv("TORN_CARGA_RUT_CLIENTE", "66666666-6")
ESPERA = [float(s) for s in os.getenv("TORN_CARGA_ESPERA", "1,3").split(",")]
PERMITIR_CERT = os.getenv("TORN_CARGA_PERMITIR_CERT") == "1"

#: Con menos stock que esto un producto se agota a mitad de la prueba y las
#: ventas empiezan a fallar con 409, que no es lo que se quiere medir.
STOCK_MINIMO = Decimal("1000")

#: Empresas listas para vender: id -> {"headers", "productos", "efectivo_id"}.
#: Se llena una vez en `preparar` y la comparten todos los cajeros del proceso.
EMPRESAS: dict[int, dict] = {}


class PreparacionFallida(Exception):
    pass


def _preparar_empresa(host: str, token: str, empresa: dict) -> dict:
    """Abre caja y carga lo necesario para vender en una empresa."""
    ambiente = empresa.get("sii_ambiente")
    if ambiente == "PROD" or (ambiente == "CERT" and not PERMITIR_CERT) or ambiente not in ("DEV", "CERT"):
        raise PreparacionFallida(
            f"La empresa {empresa['id']} está en modo {ambiente}: la prueba solo corre en DEV "
            "(CERT con TORN_CARGA_PERMITIR_CERT=1, PROD nunca)."
        )

    headers = {"Authorization": f"Bearer {token}", "X-Tenant-Id": str(empresa["id"])}
    s = requests.Session()
    s.headers.update(headers)

    # 409 es "ya hay una caja abierta para este usuario": sirve igual.
    r = s.post(f"{host}/cash/open", json={"start_amount": 0})
    if r.status_code not in (200, 201, 409):
        raise PreparacionFallida(f"Empresa {empresa['id']}: no se pudo abrir caja ({r.status_code}: {r.text})")

    r = s.get(f"{host}/sales/payment-methods/")
    r.raise_for_status()
    efectivo = [m["id"] for m in r.json() if m["code"] == "EFECTIVO"]
    if not efectivo:
        raise PreparacionFallida(f"Empresa {empresa['id']}: no tiene el medio de pago EFECTIVO.")

    r = s.get(f"{host}/customers/{RUT_CLIENTE}")
    if r.status_code != 200:
        raise PreparacionFallida(f"Empresa {empresa['id']}: no existe el cliente {RUT_CLIENTE}.")

    r = s.get(f"{host}/products/")
    r.raise_for_status()
    # Los productos con variantes no se venden directo: se vende la variante,
    # que viene en la misma lista como producto propio.
    productos = [
        p for p in r.json()
        if p["is_active"] and not p["variants"]
        and (not p["controla_stock"] or Decimal(p["stock_actual"]) >= STOCK_MINIMO)
    ]
    if not productos:
        raise PreparacionFallida(
            f"Empresa {empresa['id']}: no hay productos activos sin control de stock "
            f"o con al menos {STOCK_MINIMO} unidades."
        )

    return {"headers": headers, "productos": productos, "efectivo_id": efectivo[0]}


@events.test_start.add_listener
def preparar(environment, **_):
    # En modo distribuido el master no simula cajeros; preparan los workers.
    if isinstance(environment.runner, MasterRunner):
        return
    try:
        if not (EMAIL and PASSWORD and TENANT_IDS):
            raise PreparacionFallida("Faltan TORN_CARGA_EMAIL, TORN_CARGA_PASSWORD o TORN_CARGA_TENANTS.")
        host = environment.host.rstrip("/")
        r = requests.post(f"{host}/auth/login", json={"email": EMAIL, "password": PASSWORD})
        if r.status_code != 200:
            raise PreparacionFallida(f"Login fallido ({r.status_code}): {r.text}")
        token = r.json()["access_token"]
        accesibles = {t["id"]: t for t in r.json()["available_tenants"]}
        if not set(TENANT_IDS) <= set(accesibles):
            # Un superusuario entra a cualquier empresa aunque no sea miembro
            # (ver app/dependencies/tenant.py); su modo sale del listado del SaaS.
            r = requests.get(f"{host}/saas/tenants", headers={"Authorization": f"Bearer {token}"})
            if r.status_code == 200:
                accesibles.update({t["id"]: t for t in r.json()})
        for tenant_id in TENANT_IDS:
            if tenant_id not in accesibles:
                raise PreparacionFallida(f"El usuario {EMAIL} no tiene acceso a la empresa {tenant_id}.")
            EMPRESAS[tenant_id] = _preparar_empresa(host, token, accesibles[tenant_id])
            log.info("Empresa %s lista: %s productos vendibles", tenant_id, len(EMPRESAS[tenant_id]["productos"]))
    except (PreparacionFallida, requests.RequestException) as e:
        log.error("No se puede correr la prueba: %s", e)
        EMPRESAS.clear()
        environment.process_exit_code = 1
        # Se sale después de que `runner.start` termine de disparar este evento.
        gevent.spawn_later(0, environment.runner.quit)


class Cajero(HttpUser):
    """Un cajero en una de las empresas de TORN_CARGA_TENANTS.

    Los pesos de las tareas imitan un turno: por cada vez que se abre el POS hay
    varias ventas y escaneos. Para medir solo lectura: `--exclude-tags venta`.
    """

    wait_time = between(*ESPERA)

    def on_start(self):
        if not EMPRESAS:
            # La preparación falló y ya pidió salir; este cajero no hace nada.
            self.stop(force=True)
        self.empresa = EMPRESAS[random.choice(list(EMPRESAS))]

    @task(1)
    def abrir_pos(self):
        self.client.get("/products/", headers=self.empresa["headers"], name="/products/ (catálogo)")

    @task(3)
    def escanear(self):
        # El POS busca en el catálogo cargado y solo llama al backend si no lo
        # encuentra; esto mide ese caso.
        producto = random.choice(self.empresa["productos"])
        self.client.get(f"/products/{producto['codigo_interno']}", headers=self.empresa["headers"],
                        name="/products/[sku]")

    @task(1)
    def buscar_cliente(self):
        self.client.get("/customers/search", params={"q": RUT_CLIENTE[:4]}, headers=self.empresa["headers"],
                        name="/customers/search")

    @task(1)
    def estado_caja(self):
        self.client.get("/cash/status", headers=self.empresa["headers"])

    @tag("venta")
    @task(5)
    def vender(self):
        productos = random.sample(self.empresa["productos"], k=min(len(self.empresa["productos"]), random.randint(1, 4)))
        # Se paga en efectivo con holgura: el backend devuelve el excedente como
        # vuelto, así no hay que replicar acá su cálculo de IVA, listas de
        # precio y redondeo.
        monto = sum(Decimal(p["precio_bruto"]) for p in productos) * 2 + 1000
        venta = {
            "rut_cliente": RUT_CLIENTE,
            "tipo_dte": TIPO_DTE,
            "items": [{"product_id": p["id"], "cantidad": "1"} for p in productos],
            "payments": [{"payment_method_id": self.empresa["efectivo_id"], "amount": str(monto)}],
        }
        with self.client.post("/sales/", json=venta, headers=self.empresa["headers"],
                              name="/sales/ (venta + DTE)", catch_response=True) as r:
            if r.status_code != 201:
                r.failure(f"{r.status_code}: {r.text[:200]}")
