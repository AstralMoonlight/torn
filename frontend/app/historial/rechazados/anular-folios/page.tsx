'use client'

import { BookOpen, Construction } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'

// ponytail: guía provisoria; la versión con capturas del SII reemplaza estos pasos.
const PASOS = [
    { titulo: 'Entre al sitio del SII', texto: 'Ingrese a sii.cl con el RUT y la clave de la empresa.' },
    { titulo: 'Vaya a Timbraje Electrónico', texto: 'Servicios online > Factura electrónica > Sistema de facturación de mercado > Timbraje electrónico.' },
    { titulo: 'Elija "Anular folios"', texto: 'Seleccione el tipo de documento y el rango donde está el número (lo ve en Documentos rechazados).' },
    { titulo: 'Anule solo ese número', texto: 'Escriba el mismo número como inicio y fin del subrango, confirme y guarde el comprobante.' },
    { titulo: 'Márquelo en Torn', texto: 'Vuelva a Documentos rechazados y presione "Ya lo anulé" en ese número.' },
]

export default function GuiaAnularFoliosPage() {
    return (
        <PageContainer>
            <PageHeader
                icon={BookOpen}
                title="Cómo anular un número en el SII"
                description="Para los números que quedaron sin usar después de un rechazo."
                volver={{ href: '/historial/rechazados', label: 'Documentos rechazados' }}
            />

            <Alert>
                <Construction className="h-4 w-4" />
                <AlertTitle>Guía en preparación</AlertTitle>
                <AlertDescription>
                    Pronto tendrá esta guía con imágenes de cada pantalla del SII. Mientras tanto, estos son los pasos.
                </AlertDescription>
            </Alert>

            <ol data-section="guia-anular.pasos" className="space-y-3">
                {PASOS.map((paso, i) => (
                    <li key={paso.titulo}>
                        <Card className="flex gap-4 p-4">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                                {i + 1}
                            </span>
                            <div className="space-y-0.5">
                                <p className="font-semibold">{paso.titulo}</p>
                                <p className="text-sm text-muted-foreground">{paso.texto}</p>
                            </div>
                        </Card>
                    </li>
                ))}
            </ol>
        </PageContainer>
    )
}
