"""Diagnóstico contra el ambiente de certificación del SII (maullin / apicert).

Pide semilla y token con el certificado real, por los dos canales. Si el SII
entrega el token, la firma XMLDSig de este servicio es aceptada por el SII de
verdad, no solo por los tests. No emite documentos ni toca la base de datos.

Uso (la clave del .pfx va en `.env` como `DTE_CERT_PASSWORD`, nunca en el
comando ni en el chat):

    docker compose run --rm \
        -v "./<archivo>.pfx:/tmp/cert.pfx:ro" -e DTE_CERT_PFX=/tmp/cert.pfx \
        api python -m app.scripts.certificacion
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

from redis.asyncio import Redis

from app.core.certificados import CertificadoInvalidoError, parsear_pfx
from app.core.config import get_settings
from app.dte.sii_client import Canal, ClienteSii, SiiError, crear_http

#: Tenant ficticio: la clave del token en Redis queda aislada de los reales.
_TENANT_DIAGNOSTICO = uuid.UUID("00000000-0000-0000-0000-00000000d1a6")


async def main() -> int:
    ruta, clave = os.environ.get("DTE_CERT_PFX"), os.environ.get("DTE_CERT_PASSWORD")
    if not ruta or not clave:
        print("Faltan DTE_CERT_PFX (ruta al .pfx) y/o DTE_CERT_PASSWORD (en .env).")
        return 2

    try:
        with open(ruta, "rb") as f:
            cert = parsear_pfx(f.read(), clave)
    except (OSError, CertificadoInvalidoError) as exc:
        print(f"No se pudo abrir el certificado: {exc}")
        return 1

    vigente = cert.not_after is None or cert.not_after > datetime.now(timezone.utc)
    print(f"Certificado: titular {cert.rut or '(sin RUT)'}, vence {cert.not_after:%Y-%m-%d}"
          f"{'' if vigente else '  <-- VENCIDO'}")
    print(f"Huella: {cert.fingerprint_sha256[:16]}...\n")

    s = get_settings()
    redis = Redis.from_url(s.redis_url)
    fallos = 0
    async with crear_http(s.sii_timeout_segundos) as http:
        cliente = ClienteSii(http, redis, ambiente="CERT", ttl_token=60)
        for canal in (Canal.DTE, Canal.BOLETA):
            try:
                token = await cliente.obtener_token(canal, _TENANT_DIAGNOSTICO, cert, forzar=True)
                # El token abre una sesión a nombre del titular: no se imprime entero.
                print(f"[{canal}] OK: el SII aceptó la firma y entregó token ({token[:4]}..., {len(token)} caracteres)")
            except SiiError as exc:
                fallos += 1
                print(f"[{canal}] FALLÓ ({type(exc).__name__}): {exc}")
                if exc.respuesta:
                    print(f"         respuesta del SII: {exc.respuesta[:300]}")
    await redis.aclose()
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
