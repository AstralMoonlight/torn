export function validateRut(rut: string): boolean {
  if (!rut || rut.trim().length < 3) return false;
  const clean = rut.replace(/[^0-9kK]/g, '');
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1).toLowerCase();
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const expected = 11 - (sum % 11);
  const dvExpected =
    expected === 11 ? '0' : expected === 10 ? 'k' : String(expected);
  return dv === dvExpected;
}

export function formatRut(rut: string): string {
  const clean = rut.replace(/[^0-9kK]/g, '');
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1).toUpperCase();
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formatted}-${dv}`;
}

/**
 * Normaliza un RUT a la forma que espera el backend: cuerpo, guion y dígito
 * verificador en mayúscula, sin puntos (ej. `12345678-5`).
 *
 * @param rut RUT en cualquier formato.
 * @returns El RUT normalizado, o la entrada limpia si es demasiado corta.
 */
export function cleanRut(rut: string): string {
  const clean = (rut || '').replace(/[^0-9kK]/g, '');
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1).toUpperCase();
  return `${body}-${dv}`;
}
