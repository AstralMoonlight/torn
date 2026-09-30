import { Badge } from '@/components/ui/badge'

const TIPOS: Record<number, { label: string; color: string }> = {
    33: { label: 'Factura', color: 'bg-primary' },
    34: { label: 'Factura Exenta', color: 'bg-muted-foreground' },
    39: { label: 'Boleta', color: 'bg-primary' },
    41: { label: 'Boleta Exenta', color: 'bg-muted-foreground' },
    52: { label: 'Guía', color: 'bg-amber-600' },
    56: { label: 'N. Débito', color: 'bg-muted-foreground' },
    61: { label: 'N. Crédito', color: 'bg-destructive' },
    110: { label: 'Factura Export.', color: 'bg-indigo-600' },
    111: { label: 'ND Export.', color: 'bg-indigo-500' },
    112: { label: 'NC Export.', color: 'bg-pink-500' },
}

/** Nombre corto del tipo de documento, con su color. */
export function DteBadge({ tipo }: { tipo: number }) {
    const info = TIPOS[tipo] || { label: `Documento ${tipo}`, color: 'bg-muted-foreground' }
    return <Badge className={`${info.color} text-xs px-1.5`}>{info.label}</Badge>
}

/** "Factura", "Boleta"...: para frases como "Factura N° 12". */
export function nombreDte(tipo: number): string {
    return TIPOS[tipo]?.label ?? `Documento ${tipo}`
}
