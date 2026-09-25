'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** Radix no admite `value=""` en un ítem: la opción vacía ("Sin indicar") viaja con esta marca. */
const VACIO = '__vacio__'

export interface Opcion<T extends string | number> {
    value: T | ''
    label: string
}

/**
 * Lista de opciones sobre el Select de shadcn, en vez de un `<select>` nativo:
 * la lista nativa la dibuja el navegador y no respeta estilos (ni el puntero de
 * mano en las opciones). Acepta valores numéricos o de texto.
 */
export function SelectOpciones<T extends string | number>({
    value, onChange, opciones, id, className, placeholder, 'aria-label': ariaLabel,
}: {
    value: T | ''
    onChange: (value: T | '') => void
    opciones: readonly Opcion<T>[]
    id?: string
    className?: string
    placeholder?: string
    'aria-label'?: string
}) {
    const aTexto = (v: T | '') => (v === '' ? VACIO : String(v))
    return (
        <Select
            value={aTexto(value)}
            onValueChange={(v) => {
                const opcion = opciones.find((o) => aTexto(o.value) === v)
                if (opcion) onChange(opcion.value)
            }}
        >
            <SelectTrigger id={id} aria-label={ariaLabel} className={cn('rounded-lg', className)}>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {opciones.map((o) => (
                    <SelectItem key={aTexto(o.value)} value={aTexto(o.value)}>{o.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
