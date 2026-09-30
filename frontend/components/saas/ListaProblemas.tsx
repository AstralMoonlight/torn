import Link from 'next/link'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Problema } from '@/services/saas'

const NIVELES = {
    critico: { icono: AlertCircle, clase: 'text-destructive', texto: 'Urgente' },
    aviso: { icono: AlertTriangle, clase: 'text-amber-700 dark:text-amber-400', texto: 'Revisar' },
    info: { icono: Info, clase: 'text-muted-foreground', texto: 'Para saber' },
} as const

/**
 * "Requiere atención": un problema por fila, del más urgente al menos. Con
 * `conEmpresa`, cada fila lleva el nombre de la empresa y enlaza a su ficha.
 */
export function ListaProblemas({ problemas, conEmpresa = false }: { problemas: Problema[]; conEmpresa?: boolean }) {
    if (problemas.length === 0) {
        return (
            <p role="status" className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden /> Nada que revisar.
            </p>
        )
    }
    return (
        <ul className="divide-y divide-border">
            {problemas.map((p, i) => {
                const n = NIVELES[p.nivel]
                const Icono = n.icono
                return (
                    <li key={`${p.tenant_id}-${p.tipo}-${i}`} className="flex items-start gap-3 py-2.5">
                        <Icono className={cn('h-4 w-4 mt-0.5 shrink-0', n.clase)} aria-hidden />
                        <span className="sr-only">{n.texto}:</span>
                        <div className="min-w-0 text-sm">
                            {conEmpresa && (
                                <Link href={`/saas-admin/empresas/${p.tenant_id}`} className="font-medium text-foreground hover:text-primary hover:underline mr-2">
                                    {p.empresa}
                                </Link>
                            )}
                            <span className="text-muted-foreground">{p.mensaje}</span>
                        </div>
                    </li>
                )
            })}
        </ul>
    )
}
