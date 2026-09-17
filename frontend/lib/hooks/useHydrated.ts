'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * `true` sólo después de la hidratación en el cliente, `false` en el
 * render de servidor y en el primer render del cliente.
 *
 * Reemplaza el patrón `useState(false)` + `useEffect(() => setState(true), [])`
 * que varios componentes usaban para esperar la hidratación de Zustand o para
 * evitar un mismatch de SSR: ese patrón dispara `react-hooks/set-state-in-effect`
 * porque hace un setState síncrono dentro de un efecto. `useSyncExternalStore`
 * está pensado exactamente para esta divergencia servidor/cliente y no
 * necesita programar un setState.
 */
export function useHydrated(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => true,
        () => false,
    )
}
