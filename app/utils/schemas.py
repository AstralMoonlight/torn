"""Validación de nombres de esquema antes de interpolarlos en SQL.

PostgreSQL no permite parametrizar identificadores: un nombre de esquema no
puede viajar como `:param`, hay que concatenarlo. La única defensa posible es
validar el identificador en el punto de uso, que es lo que hace este módulo.

Hasta ahora la garantía dependía de `_generate_schema_name`, que limpia el RUT
con una expresión regular. Eso vive lejos de las ~17 consultas que interpolan el
nombre, y deja de valer en cuanto un `Tenant` se cree por otra vía.
"""

import re

#: Identificador válido de PostgreSQL sin comillas: empieza por letra o guion
#: bajo y no supera los 63 caracteres (`Tenant.schema_name` es `String(63)`).
_SCHEMA_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def safe_schema_name(schema_name) -> str:
    """Valida un nombre de esquema y lo devuelve listo para interpolar.

    Args:
        schema_name: Valor de `Tenant.schema_name`.

    Returns:
        El mismo nombre, si es un identificador válido.

    Raises:
        ValueError: Si está vacío o no es un identificador aceptable.
    """
    if not isinstance(schema_name, str) or not _SCHEMA_NAME_RE.match(schema_name):
        raise ValueError(f"Nombre de esquema inválido: {schema_name!r}")
    return schema_name
