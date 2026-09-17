#!/usr/bin/env python3
"""
Pobla la tabla public.actecos desde database/actecos_sii.json.
Ejecutar desde backend/: python scripts/seed_actecos.py
"""
import json
import os
import sys

# Raíz de backend/ (para importar app) y raíz del repo (para database/)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPO_ROOT = os.path.dirname(ROOT)
sys.path.insert(0, ROOT)

from app.database import SessionLocal, engine
from app.models.acteco import Acteco
from app.database import Base

DATA_PATH = os.path.join(REPO_ROOT, "database", "actecos_sii.json")


def main():
    if not os.path.exists(DATA_PATH):
        print(f"Error: no existe {DATA_PATH}")
        sys.exit(1)

    Base.metadata.create_all(bind=engine)

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    db = SessionLocal()
    try:
        existing = {r.code for r in db.query(Acteco.code).all()}
        to_add = [i for i in items if i.get("code") and i["code"] not in existing]
        if not to_add:
            print("La tabla actecos ya está actualizada. Nada que insertar.")
            return

        for item in to_add:
            db.add(
                Acteco(
                    code=item["code"],
                    name=item["name"],
                    taxable=item.get("taxable", True),
                    category=str(item["category"]) if item.get("category") is not None else None,
                    internet_available=item.get("internet_available", True),
                )
            )
        db.commit()
        print(f"Insertados {len(to_add)} códigos ACTECO. Total en BD: {len(existing) + len(to_add)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
