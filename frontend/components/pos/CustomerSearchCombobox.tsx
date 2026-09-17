'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { searchCustomers, createCustomer, Customer, type CustomerCreate } from '@/services/customers'
import CustomerForm from '@/components/customers/CustomerForm'
import { toast } from 'sonner'
import {
    Loader2,
    Search,
    User as UserIcon,
    UserCheck,
    Plus,
} from 'lucide-react'

interface Props {
    value: Customer | null
    onChange: (customer: Customer | null) => void
    required?: boolean
}

/**
 * Highlights matching portions of text with a bold span.
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
    if (!query || query.length < 2) return <>{text}</>

    const normalizedQuery = query.toLowerCase()
    const normalizedText = text.toLowerCase()
    const idx = normalizedText.indexOf(normalizedQuery)

    if (idx === -1) return <>{text}</>

    const before = text.slice(0, idx)
    const match = text.slice(idx, idx + query.length)
    const after = text.slice(idx + query.length)

    return (
        <>
            {before}
            <span className="font-black text-foreground underline decoration-muted-foreground underline-offset-2">{match}</span>
            {after}
        </>
    )
}

const SEARCH_PLACEHOLDER = 'Buscar por Nombre o RUT…'

export default function CustomerSearchCombobox({
    value,
    onChange,
    required = false,
}: Props) {
    // Trigger de un solo ícono (no una barra de búsqueda entera): dentro de
    // CartPanel comparte fila con los tabs de tipo de documento, y la idea es
    // ocupar el mínimo espacio posible en pantalla. Toda la interacción
    // (buscar, cambiar, quitar) vive en el Dialog que abre al hacer clic —
    // que además tiene su propio overlay, así que nunca tapa nada del panel
    // como sí lo hacía el dropdown absoluto que tenía antes.
    const [searchOpen, setSearchOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<Customer[]>([])
    const [loading, setLoading] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const [createOpen, setCreateOpen] = useState(false)

    const inputRef = useRef<HTMLInputElement>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const listRef = useRef<HTMLDivElement>(null)

    // ── Debounced search ──────────────────────────────────────────
    const performSearch = useCallback(async (q: string) => {
        if (q.length < 2) {
            setResults([])
            return
        }

        setLoading(true)
        try {
            const data = await searchCustomers(q)
            setResults(data)
            setHighlightedIndex(-1)
        } catch {
            setResults([])
        } finally {
            setLoading(false)
        }
    }, [])

    const handleInputChange = useCallback(
        (val: string) => {
            setQuery(val)
            clearTimeout(debounceRef.current)

            if (val.length < 2) {
                setResults([])
                return
            }

            setLoading(true)
            debounceRef.current = setTimeout(() => {
                performSearch(val)
            }, 300)
        },
        [performSearch],
    )

    // ── Cleanup debounce on unmount ───────────────────────────────
    useEffect(() => {
        return () => clearTimeout(debounceRef.current)
    }, [])

    // ── Reset search state each time the dialog opens, autofocus ──
    useEffect(() => {
        if (searchOpen && !value) {
            setQuery('')
            setResults([])
            setHighlightedIndex(-1)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [searchOpen, value])

    // ── Scroll highlighted item into view ────────────────────────
    useEffect(() => {
        if (highlightedIndex >= 0 && listRef.current) {
            const items = listRef.current.querySelectorAll('[data-combobox-item]')
            items[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
        }
    }, [highlightedIndex])

    // ── Keyboard navigation ──────────────────────────────────────
    const totalItems = results.length + 1 // +1 for "Crear nuevo" row
    const handleKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setHighlightedIndex((prev) => (prev + 1) % totalItems)
                break
            case 'ArrowUp':
                e.preventDefault()
                setHighlightedIndex((prev) => (prev - 1 + totalItems) % totalItems)
                break
            case 'Enter':
                e.preventDefault()
                if (highlightedIndex >= 0 && highlightedIndex < results.length) {
                    selectCustomer(results[highlightedIndex])
                } else if (highlightedIndex === results.length) {
                    // "Crear nuevo" row
                    setSearchOpen(false)
                    setCreateOpen(true)
                }
                break
        }
    }

    // ── Select / clear ───────────────────────────────────────────
    const selectCustomer = (c: Customer) => {
        onChange(c)
        setQuery('')
        setResults([])
        setSearchOpen(false)
    }

    // ── Customer creation handler ────────────────────────────────
    const handleCreateSuccess = async (data: CustomerCreate) => {
        try {
            const newCustomer = await createCustomer(data)
            selectCustomer(newCustomer)
            setCreateOpen(false)
            toast.success('Cliente creado y seleccionado')
        } catch {
            toast.error('Error al crear cliente')
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setSearchOpen(true)}
                title={value ? `${value.razon_social} (${value.rut}) — cambiar o quitar` : `Buscar cliente${required ? ' (requerido)' : ' (opcional)'}`}
                className={`flex h-9 w-9 items-center justify-center rounded-md border shrink-0 transition-colors ${value
                    ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                    : required
                        ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
                        : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    }`}
            >
                {value ? <UserCheck className="h-4 w-4" /> : <UserIcon className="h-4 w-4" />}
            </button>

            <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
                <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
                    <DialogTitle className="sr-only">Cliente</DialogTitle>

                    {value ? (
                        // ── Ya hay un cliente elegido: mostrarlo y ofrecer cambiar/quitar ──
                        <div className="p-4 space-y-3">
                            <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5">
                                <UserCheck className="h-5 w-5 text-primary shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-primary truncate">{value.razon_social}</p>
                                    <p className="text-[11px] font-mono text-primary/80">{value.rut}</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" className="flex-1" onClick={() => onChange(null)}>
                                    Cambiar cliente
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-1 text-destructive hover:text-destructive"
                                    onClick={() => {
                                        onChange(null)
                                        setSearchOpen(false)
                                    }}
                                >
                                    Quitar cliente
                                </Button>
                            </div>
                        </div>
                    ) : (
                        // ── Búsqueda ──
                        <>
                            <div className="relative border-b border-border">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                <Input
                                    ref={inputRef}
                                    placeholder={SEARCH_PLACEHOLDER}
                                    value={query}
                                    onChange={(e) => handleInputChange(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    className="h-12 rounded-none border-0 pl-10 pr-9 text-sm focus-visible:ring-0"
                                    autoComplete="off"
                                />
                                {loading && (
                                    <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                )}
                            </div>

                            <div ref={listRef} className="max-h-[340px] overflow-y-auto">
                                {query.length < 2 && (
                                    <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                                        Escribe al menos 2 caracteres para buscar.
                                    </div>
                                )}

                                {query.length >= 2 && results.length === 0 && !loading && (
                                    <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                                        <UserIcon className="h-6 w-6 mx-auto mb-1.5 opacity-40" />
                                        No se encontraron clientes para &ldquo;{query}&rdquo;
                                    </div>
                                )}

                                {results.map((customer, idx) => (
                                    <button
                                        key={customer.id}
                                        data-combobox-item
                                        onClick={() => selectCustomer(customer)}
                                        onMouseEnter={() => setHighlightedIndex(idx)}
                                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer border-t border-border first:border-t-0 ${idx === highlightedIndex ? 'bg-muted' : 'hover:bg-accent/50'
                                            }`}
                                    >
                                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted shrink-0">
                                            <UserIcon className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm truncate text-foreground">
                                                <HighlightedText text={customer.razon_social} query={query} />
                                            </p>
                                            <p className="text-[11px] font-mono text-muted-foreground">
                                                <HighlightedText text={customer.rut} query={query} />
                                            </p>
                                        </div>
                                    </button>
                                ))}

                                {/* "Crear nuevo" — always visible */}
                                <button
                                    data-combobox-item
                                    onClick={() => {
                                        setSearchOpen(false)
                                        setCreateOpen(true)
                                    }}
                                    onMouseEnter={() => setHighlightedIndex(results.length)}
                                    className={`flex w-full items-center gap-2 px-4 py-3 text-left border-t border-border transition-colors cursor-pointer ${highlightedIndex === results.length ? 'bg-muted' : 'hover:bg-accent/50'
                                        }`}
                                >
                                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted shrink-0">
                                        <Plus className="h-3 w-3 text-muted-foreground" />
                                    </div>
                                    <span className="text-xs font-medium text-foreground">
                                        Crear nuevo cliente
                                    </span>
                                </button>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-lg z-[100]">
                    <DialogHeader>
                        <DialogTitle>Nuevo Cliente Rápido</DialogTitle>
                    </DialogHeader>
                    <CustomerForm
                        onSubmit={handleCreateSuccess}
                        onCancel={() => setCreateOpen(false)}
                    />
                </DialogContent>
            </Dialog>
        </>
    )
}
