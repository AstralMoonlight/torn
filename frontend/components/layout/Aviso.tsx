'use client'

import { AlertCircle, Info, RotateCw, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/lib/store/uiStore'
import { cn } from '@/lib/utils'

/**
 * Muestra el aviso de página de `uiStore` (lo que antes eran toasts). `AppShell`
 * lo pone arriba del contenido; el POS lo pone dentro de su propia zona.
 */
export default function Aviso({ className }: { className?: string }) {
    const aviso = useUIStore((s) => s.aviso)
    const cerrar = useUIStore((s) => s.cerrarAviso)
    if (!aviso) return null

    const Icono = aviso.tipo === 'error' ? AlertCircle : Info
    return (
        <Alert
            data-section="aviso"
            variant={aviso.tipo === 'error' ? 'destructive' : 'default'}
            className={cn('flex items-start gap-3 bg-card [&>svg]:static [&>svg~*]:pl-0 shadow-sm', className)}
        >
            <Icono className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <AlertDescription className="flex-1">{aviso.texto}</AlertDescription>
            {aviso.reintentar && (
                <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 -my-1"
                    onClick={() => { cerrar(); aviso.reintentar?.() }}
                >
                    <RotateCw className="h-3.5 w-3.5" aria-hidden /> Reintentar
                </Button>
            )}
            <button
                type="button"
                onClick={cerrar}
                aria-label="Cerrar aviso"
                className="-m-1 rounded p-1 opacity-70 hover:opacity-100"
            >
                <X className="h-4 w-4" aria-hidden />
            </button>
        </Alert>
    )
}
