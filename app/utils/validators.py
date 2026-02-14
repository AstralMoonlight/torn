"""Utilidades de validación para el proyecto Torn."""

import re


def validar_rut(rut: str) -> str:
    """
    Valida un RUT chileno y lo retorna formateado (12345678-K).

    Algoritmo Módulo 11:
    1. Toma los dígitos del cuerpo (sin DV).
    2. Multiplica cada dígito de derecha a izquierda por 2,3,4,5,6,7 (cíclico).
    3. Suma los productos, calcula 11 - (suma % 11).
    4. Si el resultado es 11 → "0", si es 10 → "K", sino el dígito.

    Raises:
        ValueError: Si el RUT es inválido.
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
