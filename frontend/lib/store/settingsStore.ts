import { create } from 'zustand'
import { getSettings, updateSettings, type SettingsUpdate, type SystemSettings } from '@/services/config'

interface SettingsState {
    /** Ajustes de la empresa seleccionada; `null` mientras cargan. Los carga `AppShell`. */
    settings: SystemSettings | null
    cargar: () => Promise<void>
    limpiar: () => void
    /**
     * Guarda al instante (sin botón). Aplica el cambio en pantalla de inmediato y
     * encola el envío: si el usuario toca dos opciones seguidas, los PUT salen en
     * orden y la respuesta de uno no pisa al otro. Si falla, recarga lo que tiene
     * el servidor (vuelve a la opción anterior) y relanza el error.
     */
    guardar: (cambios: SettingsUpdate) => Promise<void>
    /** Color elegido por el usuario en su navegador (modo 'usuario'); ver `lib/colores.ts`. */
    colorUsuario: string | null
    setColorUsuario: (clave: string | null) => void
}

let cola: Promise<unknown> = Promise.resolve()

export const useSettingsStore = create<SettingsState>((set, get) => ({
    settings: null,
    cargar: async () => set({ settings: await getSettings() }),
    limpiar: () => set({ settings: null }),
    colorUsuario: null,
    setColorUsuario: (clave) => set({ colorUsuario: clave }),
    guardar: (cambios) => {
        set((s) => ({ settings: s.settings && { ...s.settings, ...cambios } }))
        const envio = cola.then(() => updateSettings(cambios))
        cola = envio.catch(() => get().cargar()).catch(() => undefined)
        return envio.then(() => undefined)
    },
}))

/** El control de caja está encendido hasta que el servidor diga lo contrario. */
export const useControlCaja = () => useSettingsStore((s) => s.settings?.control_caja ?? true)

/** Color que corresponde aplicar: el de la empresa, o el del usuario si el modo lo permite. */
export const useColorEfectivo = () => useSettingsStore((s) =>
    s.settings?.color_mode === 'usuario'
        ? s.colorUsuario ?? s.settings.color_primario
        : s.settings?.color_primario ?? null)
