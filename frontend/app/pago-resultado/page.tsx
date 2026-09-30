'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import { Button } from '@/components/ui/button'
import { validateSession } from '@/services/auth'
import { useSessionStore } from '@/lib/store/sessionStore'

const RESULTADOS = {
    pagado: { icono: CheckCircle2, clase: 'text-primary', titulo: 'Pago recibido', texto: 'Su plan quedó renovado. Gracias.' },
    pendiente: { icono: Clock, clase: 'text-amber-600', titulo: 'Pago en proceso', texto: 'Flow todavía no confirma el pago. Cuando lo haga, el plan se renueva solo.' },
    fallido: { icono: XCircle, clase: 'text-destructive', titulo: 'El pago no se completó', texto: 'No se cobró nada. Puede intentarlo de nuevo desde el aviso de arriba.' },
} as const

/** Adonde vuelve el cliente desde Flow (`/pagos/flow/retorno` del backend). */
function Resultado() {
    const estado = useSearchParams().get('estado')
    const r = RESULTADOS[(estado === 'anulado' ? 'fallido' : estado) as keyof typeof RESULTADOS] ?? RESULTADOS.pendiente
    const syncSession = useSessionStore((s) => s.syncSession)

    // El estado de la suscripción viaja con la sesión: se refresca para quitar el aviso.
    useEffect(() => {
        validateSession().then((d) => syncSession(d.user, d.available_tenants)).catch(() => {})
    }, [syncSession])

    const Icono = r.icono
    return (
        <PageContainer className="max-w-lg">
            <div role="status" className="mt-12 rounded-xl border border-border bg-card p-8 text-center space-y-3">
                <Icono className={`mx-auto h-12 w-12 ${r.clase}`} aria-hidden />
                <h1 className="text-xl font-bold">{r.titulo}</h1>
                <p className="text-muted-foreground">{r.texto}</p>
                <Button asChild className="mt-2"><Link href="/pos">Volver al sistema</Link></Button>
            </div>
        </PageContainer>
    )
}

export default function PagoResultadoPage() {
    return <Suspense><Resultado /></Suspense>
}
