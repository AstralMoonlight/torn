import requests
import sys

URL = "http://localhost:8000/sales/"
DATA = {
    "rut_cliente": "12345678-9",
    "items": [
        {"product_id": 1, "cantidad": 2},
        {"product_id": 2, "cantidad": 1}
    ],
    "descripcion": "Venta de prueba script"
}

try:
    resp = requests.post(URL, json=DATA, timeout=5)
    print(f"Status: {resp.status_code}")
    print(f"Response: {resp.text}")
except Exception as e:
    print(f"Error: {e}")
