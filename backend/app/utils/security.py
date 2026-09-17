"""Utilidades de seguridad: hashing de contraseñas y emisión de JWT."""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Union

from dotenv import load_dotenv
from jose import jwt
from passlib.context import CryptContext

load_dotenv()

logger = logging.getLogger(__name__)

# ── Configuración ────────────────────────────────────────────────────
#: Entorno de ejecución. En "production" la app se niega a arrancar sin SECRET_KEY.
TORN_ENV = os.getenv("TORN_ENV", "development").strip().lower()

#: Clave de firma de los JWT. Debe venir SIEMPRE de la variable de entorno.
SECRET_KEY = os.getenv("SECRET_KEY", "").strip()

#: Clave de desarrollo. Es pública y no ofrece ninguna garantía: cualquiera
#: que conozca este valor puede firmar un token válido para cualquier usuario.
_DEV_SECRET_KEY = "dev-only-insecure-key-do-not-use-outside-localhost"

if not SECRET_KEY:
    if TORN_ENV in ("production", "prod", "staging"):
        raise RuntimeError(
            "SECRET_KEY no está definida. Es obligatoria cuando TORN_ENV="
            f"'{TORN_ENV}'. Genera una con: "
            "python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    SECRET_KEY = _DEV_SECRET_KEY
    logger.warning(
        "SECRET_KEY no está definida; se usa una clave de desarrollo conocida "
        "públicamente. Define SECRET_KEY en tu .env antes de exponer el servicio."
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60 * 12))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compara una contraseña en claro contra su hash bcrypt."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Genera el hash bcrypt de una contraseña."""
    return pwd_context.hash(password)


def create_access_token(
    subject: Union[str, Any], expires_delta: Optional[timedelta] = None
) -> str:
    """Emite un JWT firmado para el `subject` indicado.

    Args:
        subject: Identificador del usuario (se usa el email).
        expires_delta: Vigencia del token. Por defecto `ACCESS_TOKEN_EXPIRE_MINUTES`.

    Returns:
        El JWT codificado.
    """
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=ACCESS_TOKEN_EXPIRE_MINUTES
        )

    to_encode = {"exp": expire, "sub": str(subject)}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
