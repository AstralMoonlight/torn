'use client'

import { Palette } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSessionStore } from '@/lib/store/sessionStore'
import { useColorEfectivo, useSettingsStore } from '@/lib/store/settingsStore'
import { guardarColorUsuario } from '@/lib/colores'
import PaletaColores from './PaletaColores'

/**
 * Color principal propio del usuario. Solo aparece si el administrador dejó el
 * color "libre por usuario"; la elección se guarda en este navegador.
 */
export default function SelectorColor() {
    const modo = useSettingsStore((s) => s.settings?.color_mode)
    const setColorUsuario = useSettingsStore((s) => s.setColorUsuario)
    const color = useColorEfectivo()
    const tenantId = useSessionStore((s) => s.selectedTenantId)
    const userId = useSessionStore((s) => s.user?.id)

    if (modo !== 'usuario' || !tenantId || !userId) return null

    const elegir = (clave: string) => {
        guardarColorUsuario(tenantId, userId, clave)
        setColorUsuario(clave)
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    title="Color principal"
                    aria-label="Color principal"
                >
                    <Palette className="h-4 w-4" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="p-3">
                <DropdownMenuLabel className="px-0 pt-0">Tu color principal</DropdownMenuLabel>
                <PaletaColores valor={color} onElegir={elegir} className="grid-cols-5" />
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
