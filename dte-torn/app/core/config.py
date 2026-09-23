"""Configuración del servicio, leída del entorno.

Todo lleva prefijo `DTE_`. Lo que no tiene valor por defecto es obligatorio:
el proceso no arranca sin eso, que es preferible a arrancar con una llave
maestra de juguete y descubrirlo cuando ya hay certificados cifrados con ella.
"""

from __future__ import annotations

import base64
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Variables de entorno del servicio."""

    model_config = SettingsConfigDict(
        env_prefix="DTE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["dev", "staging", "prod"] = "dev"

    # --- Base de datos -----------------------------------------------------
    #: Rol de la aplicación: SIN bypass de RLS. Ver `db.py`.
    database_url: str = Field(
        default="postgresql+asyncpg://dte_app:dte_app@localhost:5432/dte",
    )
    #: Rol dueño del esquema, solo para Alembic (crea tablas y políticas).
    database_owner_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/dte",
    )
    #: Clave del rol de aplicación; la migración inicial crea el rol con ella.
    app_db_password: str = "dte_app"
    db_pool_size: int = 10
    db_max_overflow: int = 5

    # --- Seguridad ---------------------------------------------------------
    #: 32 bytes en base64. De acá se derivan las llaves por tenant (HKDF).
    #: Fuera de la base de datos, siempre.
    master_key: str
    #: Versión con la que se cifra lo nuevo. Sube al rotar la llave maestra.
    master_key_version: int = 1
    #: Llaves anteriores, para poder leer lo que se cifró antes de una rotación:
    #: `DTE_MASTER_KEYS_ANTERIORES={"1": "<base64>"}`. Sin esto, rotar la llave
    #: dejaría ilegible todo lo ya guardado.
    master_keys_anteriores: dict[str, str] = Field(default_factory=dict)
    #: Compartida con el backend que consume este servicio.
    internal_api_key: str

    # --- Infraestructura ---------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"

    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "dte"
    s3_region: str = "us-east-1"

    sentry_dsn: str | None = None

    # --- Reglas de negocio -------------------------------------------------
    #: Folios restantes bajo los cuales se pide un CAF nuevo.
    folio_umbral_alerta: int = 100
    #: Máximo de envíos simultáneos al SII por RUT emisor.
    sii_concurrencia_por_rut: int = 2

    @field_validator("master_key")
    @classmethod
    def _master_key_de_32_bytes(cls, v: str) -> str:
        """Valida que la llave maestra sean 32 bytes reales en base64."""
        _decodificar_llave(v, "DTE_MASTER_KEY")
        return v

    @field_validator("master_keys_anteriores")
    @classmethod
    def _anteriores_validas(cls, v: dict[str, str]) -> dict[str, str]:
        """Valida cada llave anterior igual que la actual."""
        for version, llave in v.items():
            _decodificar_llave(llave, f"DTE_MASTER_KEYS_ANTERIORES[{version}]")
        return v

    @property
    def master_key_bytes(self) -> bytes:
        """La llave maestra vigente, ya decodificada."""
        return base64.b64decode(self.master_key)

    def llave_maestra_de(self, version: int) -> bytes | None:
        """Retorna la llave maestra de una versión, o None si no está cargada."""
        if version == self.master_key_version:
            return self.master_key_bytes
        anterior = self.master_keys_anteriores.get(str(version))
        return base64.b64decode(anterior) if anterior else None


def _decodificar_llave(valor: str, nombre: str) -> bytes:
    """Decodifica y valida una llave maestra en base64."""
    try:
        raw = base64.b64decode(valor, validate=True)
    except Exception as exc:  # noqa: BLE001 - mensaje de arranque
        raise ValueError(f"{nombre} debe ser base64 válido") from exc
    if len(raw) != 32:
        raise ValueError(f"{nombre} debe decodificar a 32 bytes, son {len(raw)}")
    return raw


@lru_cache
def get_settings() -> Settings:
    """Retorna la configuración, cacheada por proceso."""
    return Settings()  # type: ignore[call-arg]
