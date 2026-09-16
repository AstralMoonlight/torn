import { create } from 'zustand'

/**
 * Cómo muestra el POS los productos con variantes:
 * - `grouped`: producto padre con modal de variantes.
 * - `flat`: cada variante como tarjeta independiente.
 *
 * Son los valores que usan `app/configuracion/page.tsx`, `app/pos/page.tsx` y
 * `components/pos/ProductGrid.tsx`.
 */
export type PosVariantDisplay = 'grouped' | 'flat'

interface UIState {
  sidebarCollapsed: boolean
  posVariantDisplay: PosVariantDisplay
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setPosVariantDisplay: (display: PosVariantDisplay) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  posVariantDisplay: 'grouped',
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setPosVariantDisplay: (display) => set({ posVariantDisplay: display }),
}))