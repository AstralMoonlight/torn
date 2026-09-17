"""Utilidades de validación para el proyecto Torn."""

import re


def validar_rut(rut: str) -> str:
    """Valida y formatea un RUT chileno.

    Implementa el algoritmo de Módulo 11 para verificar el dígito verificador.
    Limpia y estandariza el formato de salida.

    Args:
        rut (str): RUT crudo (puede tener puntos, separadores o minúsculas).

    Returns:
        str: RUT limpio y formateado (ej: 12345678-K).

    Raises:
        ValueError: Si el RUT es muy corto, no numérico, fuera de rango o DV incorrecto.
    """
    # Limpiar: quitar puntos, espacios, guiones
    rut_limpio = re.sub(r"[\s.\-]", "", rut.strip().upper())

    if len(rut_limpio) < 2:
        raise ValueError(f"RUT inválido: '{rut}' es demasiado corto")

    cuerpo = rut_limpio[:-1]
    dv_ingresado = rut_limpio[-1]

    # Validar que el cuerpo sea numérico
    if not cuerpo.isdigit():
        raise ValueError(f"RUT inválido: cuerpo '{cuerpo}' no es numérico")

    # Validar largo razonable (min 1M, max 99M)
    numero = int(cuerpo)
    if numero < 1_000_000 or numero > 99_999_999:
        raise ValueError(
            f"RUT inválido: {numero} fuera de rango (1.000.000 – 99.999.999)"
        )

    # Algoritmo Módulo 11
    suma = 0
    multiplicador = 2
    for digito in reversed(cuerpo):
        suma += int(digito) * multiplicador
        multiplicador = multiplicador + 1 if multiplicador < 7 else 2

    resto = 11 - (suma % 11)

    if resto == 11:
        dv_calculado = "0"
    elif resto == 10:
        dv_calculado = "K"
    else:
        dv_calculado = str(resto)

    if dv_ingresado != dv_calculado:
        raise ValueError(
            f"RUT inválido: dígito verificador incorrecto "
            f"(esperado '{dv_calculado}', recibido '{dv_ingresado}')"
        )

    # Retornar formateado
    return f"{cuerpo}-{dv_calculado}"
