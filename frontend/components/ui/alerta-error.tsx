import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

/**
 * Error dentro de un diálogo o formulario (reemplaza al toast): va sobre los
 * botones y el diálogo no se cierra. Sin mensaje no pinta nada.
 */
export function AlertaError({ mensaje, className }: { mensaje: string | null | undefined; className?: string }) {
    if (!mensaje) return null
    return (
        <Alert variant="destructive" className={cn('py-3 [&>svg]:top-3.5', className)}>
            <AlertCircle className="h-4 w-4" aria-hidden />
            <AlertDescription>{mensaje}</AlertDescription>
        </Alert>
    )
}
