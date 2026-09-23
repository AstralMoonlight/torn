"""Almacenamiento de objetos (S3 / MinIO) para XML firmados, sobres y PDF.

Regla: **write-once**. El XML firmado se guarda exactamente como se envió y nunca
se sobrescribe. Se consigue con dos cosas:

- La clave incluye el SHA-256 del contenido: dos contenidos distintos nunca
  comparten clave.
- El `PUT` va con `If-None-Match: *`: si la clave ya existe, S3 rechaza la
  escritura en vez de pisarla. Como la clave depende del contenido, que ya
  exista significa que es el mismo archivo, y eso cuenta como éxito.
"""

from __future__ import annotations

import hashlib
import uuid

import aioboto3
from botocore.exceptions import ClientError

from app.core.config import Settings, get_settings


class IntegridadError(Exception):
    """Lo leído de S3 no corresponde al hash que se guardó en la base."""


def clave_dte(tenant_id: uuid.UUID, tipo_dte: int, folio: int, sha256: str) -> str:
    return f"{tenant_id}/dte/{tipo_dte}/{folio}/{sha256}.xml"


def clave_envio(tenant_id: uuid.UUID, envio_id: uuid.UUID, sha256: str) -> str:
    return f"{tenant_id}/envios/{envio_id}/{sha256}.xml"


class Almacen:
    """Cliente mínimo de S3 con las dos operaciones que necesita el servicio."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.s = settings or get_settings()
        self._sesion = aioboto3.Session()

    def _cliente(self):
        # ponytail: un cliente por operación; un pool si el volumen lo pide.
        return self._sesion.client(
            "s3",
            endpoint_url=self.s.s3_endpoint_url,
            aws_access_key_id=self.s.s3_access_key,
            aws_secret_access_key=self.s.s3_secret_key,
            region_name=self.s.s3_region,
        )

    async def asegurar_bucket(self) -> None:
        """Crea el bucket si no existe. Idempotente."""
        async with self._cliente() as s3:
            try:
                await s3.head_bucket(Bucket=self.s.s3_bucket)
            except ClientError:
                await s3.create_bucket(Bucket=self.s.s3_bucket)

    async def guardar(self, clave: str, datos: bytes) -> None:
        """Escribe una sola vez. Si la clave ya existe, no la toca."""
        async with self._cliente() as s3:
            try:
                await s3.put_object(
                    Bucket=self.s.s3_bucket,
                    Key=clave,
                    Body=datos,
                    ContentType="application/xml",
                    IfNoneMatch="*",
                )
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") not in ("PreconditionFailed", "412"):
                    raise

    async def leer(self, clave: str, sha256: str | None = None) -> bytes:
        """Lee un objeto y, si se entrega el hash, verifica que no cambió."""
        async with self._cliente() as s3:
            respuesta = await s3.get_object(Bucket=self.s.s3_bucket, Key=clave)
            async with respuesta["Body"] as cuerpo:
                datos = await cuerpo.read()
        if sha256 is not None and hashlib.sha256(datos).hexdigest() != sha256:
            raise IntegridadError(f"{clave}: el contenido no calza con el hash guardado")
        return datos
