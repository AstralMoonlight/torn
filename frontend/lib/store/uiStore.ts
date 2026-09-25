import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Cómo muestra el POS los productos con variantes:
 * - `grouped`: producto padre con modal de variantes.
 * - `flat`: cada variante como tarjeta independiente.
 *
 * Son los valores que usan `app/configuracion/page.tsx`, `app/pos/page.tsx` y
 * `components/pos/ProductGrid.tsx`.
 */
export type PosVariantDisplay = 'grouped' | 'flat'

/**
 * Mensaje de página (reemplaza a los toasts): `components/layout/Aviso.tsx` lo
 * muestra como `Alert` arriba del contenido. `ruta` es la página donde se ve;
 * al salir de ella se borra.
 */
export interface Aviso {
  texto: string
  tipo: 'error' | 'info'
  ruta?: string
  reintentar?: () => void
}

interface UIState {
  sidebarCollapsed: boolean
  posVariantDisplay: PosVariantDisplay
  aviso: Aviso | null
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setPosVariantDisplay: (display: PosVariantDisplay) => void
  avisar: (texto: string, opciones?: Partial<Omit<Aviso, 'texto'>>) => void
  cerrarAviso: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      posVariantDisplay: 'grouped',
      aviso: null,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setPosVariantDisplay: (display) => set({ posVariantDisplay: display }),
      avisar: (texto, opciones) => set({
        aviso: { texto, tipo: 'error', ruta: window.location.pathname, ...opciones },
      }),
      cerrarAviso: () => set({ aviso: null }),
    }),
    // Solo la vista del POS es preferencia del navegador; el resto es de la sesión.
    { name: 'torn-ui', partialize: (s) => ({ posVariantDisplay: s.posVariantDisplay }) },
  ),
)

/** Atajo para handlers y stores: `avisar('No se pudo guardar')`. */
export const avisar: UIState['avisar'] = (texto, opciones) => useUIStore.getState().avisar(texto, opciones)
