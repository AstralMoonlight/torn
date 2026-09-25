/**
 * Paleta cerrada del color principal (`--primary` y `--ring`). Cada valor es el
 * más claro (tema claro) o el más oscuro (tema oscuro) que todavía da 4.6:1 con
 * el texto del botón y con el fondo, salvo `lima`, que es más chillón a
 * propósito. Las claves son las de `ColorPrimario` en `backend/app/schemas.py`.
 */
export const COLORES = [
    { clave: 'azul', nombre: 'Azul', claro: '221 83% 55%', oscuro: '221 83% 61.5%' },
    { clave: 'indigo', nombre: 'Índigo', claro: '239 84% 65%', oscuro: '239 84% 70%' },
    { clave: 'violeta', nombre: 'Violeta', claro: '262 83% 61.5%', oscuro: '262 83% 67.5%' },
    { clave: 'purpura', nombre: 'Púrpura', claro: '280 75% 55%', oscuro: '280 75% 62.5%' },
    { clave: 'fucsia', nombre: 'Fucsia', claro: '293 80% 46.5%', oscuro: '293 80% 56.5%' },
    { clave: 'rosa', nombre: 'Rosa', claro: '330 81% 47%', oscuro: '330 81% 57.5%' },
    { clave: 'frambuesa', nombre: 'Frambuesa', claro: '345 83% 47.5%', oscuro: '345 83% 59%' },
    { clave: 'rojo', nombre: 'Rojo', claro: '0 78% 49%', oscuro: '0 78% 60.5%' },
    { clave: 'naranja', nombre: 'Naranja', claro: '21 90% 40%', oscuro: '21 90% 46.5%' },
    { clave: 'ambar', nombre: 'Ámbar', claro: '38 92% 32%', oscuro: '38 92% 37%' },
    { clave: 'oliva', nombre: 'Oliva', claro: '65 60% 29%', oscuro: '65 60% 34%' },
    { clave: 'lima', nombre: 'Lima', claro: '84 81% 44%', oscuro: '84 81% 50%' },
    { clave: 'verde', nombre: 'Verde', claro: '142 71% 30%', oscuro: '142 71% 34.5%' },
    { clave: 'esmeralda', nombre: 'Esmeralda', claro: '160 84% 27.5%', oscuro: '160 84% 32%' },
    { clave: 'turquesa', nombre: 'Turquesa', claro: '174 80% 27.5%', oscuro: '174 80% 32%' },
    { clave: 'cian', nombre: 'Cian', claro: '189 94% 29.5%', oscuro: '189 94% 34%' },
    { clave: 'celeste', nombre: 'Celeste', claro: '199 89% 35.5%', oscuro: '199 89% 41.5%' },
    { clave: 'acero', nombre: 'Acero', claro: '215 25% 47%', oscuro: '215 25% 54%' },
    { clave: 'grafito', nombre: 'Grafito', claro: '220 9% 46%', oscuro: '220 9% 53%' },
    { clave: 'cafe', nombre: 'Café', claro: '25 45% 42.5%', oscuro: '25 45% 49%' },
] as const

/** Última elección aplicada; la lee el script en línea de `app/layout.tsx` antes de pintar. */
export const COLOR_APLICADO_KEY = 'torn-color'

/** Color que eligió un usuario para una empresa (modo 'usuario'). Solo vive en su navegador. */
export const colorUsuarioKey = (tenantId: number, userId: number) => `torn-color-usuario:${tenantId}:${userId}`

/** Aplica un color de la paleta, o vuelve al azul por defecto con `null`. */
export function aplicarColor(clave: string | null) {
    const estilo = document.documentElement.style
    const color = COLORES.find((c) => c.clave === clave)
    try {
        if (!color) {
            estilo.removeProperty('--primario-claro')
            estilo.removeProperty('--primario-oscuro')
            localStorage.removeItem(COLOR_APLICADO_KEY)
            return
        }
        estilo.setProperty('--primario-claro', color.claro)
        estilo.setProperty('--primario-oscuro', color.oscuro)
        localStorage.setItem(COLOR_APLICADO_KEY, JSON.stringify({ claro: color.claro, oscuro: color.oscuro }))
    } catch { /* sin storage: el color igual queda aplicado en esta pestaña */ }
}

export function leerColorUsuario(tenantId: number, userId: number): string | null {
    try { return localStorage.getItem(colorUsuarioKey(tenantId, userId)) } catch { return null }
}

export function guardarColorUsuario(tenantId: number, userId: number, clave: string) {
    try { localStorage.setItem(colorUsuarioKey(tenantId, userId), clave) } catch { /* sin storage */ }
}
