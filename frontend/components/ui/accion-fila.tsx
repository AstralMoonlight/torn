import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Acción por fila de una tabla (editar, ver, eliminar): ícono suelto, mismo
 * tamaño y hover neutro en todas las tablas; rojo solo si `peligro`.
 */
export function AccionFila({
    icon: Icon,
    label,
    onClick,
    peligro,
    disabled,
}: {
    icon: LucideIcon
    label: string
    onClick: () => void
    peligro?: boolean
    disabled?: boolean
}) {
    return (
        <Button
            variant="ghost"
            size="icon"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'h-8 w-8 text-muted-foreground',
                peligro ? 'hover:text-destructive hover:bg-destructive/10' : 'hover:text-foreground hover:bg-accent',
            )}
        >
            <Icon className="h-4 w-4" />
        </Button>
    )
}
