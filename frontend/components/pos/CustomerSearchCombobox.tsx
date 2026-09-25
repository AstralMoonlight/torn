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
import {
    Loader2,
    Search,
    User as UserIcon,
    UserCheck,
    Plus,
    ChevronDown,
    ChevronRight,
} from 'lucide-react'

interface Props {
    value: Customer | null
    onChange: (customer: Customer | null) => void
    required?: boolean
    /** Ícono h-9 w-9 (default) vs. barra completa — ver comentario donde se usa el trigger. */
    compact?: boolean
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

const SEARCH_PLACEHOLDER = 'Buscar por nombre o RUT…'

export default function CustomerSearchCombobox({
    value,
    onChange,
    required = false,
    compact = true,
}: Props) {
    // Panel inline (no modal): se expande en el flujo normal del documento,
    // empujando lo que viene después en vez de taparlo — el dropdown
    // absoluto que tenía antes sí tapaba Referencias/Totales, y abrir un
    // Dialog para elegir cliente en cada venta resultó ser demasiada
    // ventana emergente. Sólo "Crear nuevo cliente" (formulario largo, poco
    // frecuente) se queda como Dialog más abajo.
    const [expanded, setExpanded] = useState(false)
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

    // ── Reset search state each time the panel expands, autofocus ─
    useEffect(() => {
        if (expanded && !value) {
            setQuery('')
            setResults([])
            setHighlightedIndex(-1)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [expanded, value])

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
                    setExpanded(false)
                    setCreateOpen(true)
                }
                break
            case 'Escape':
                setExpanded(false)
                break
        }
    }

    // ── Select / clear ───────────────────────────────────────────
    const selectCustomer = (c: Customer) => {
        onChange(c)
        setQuery('')
        setResults([])
        setExpanded(false)
    }

    // ── Customer creation handler ────────────────────────────────
    const handleCreateSuccess = async (data: CustomerCreate) => {
        // Si falla, CustomerForm muestra el error dentro del diálogo.
        const newCustomer = await createCustomer(data)
        selectCustomer(newCustomer)
        setCreateOpen(false)
    }

    const triggerToneClass = value
        ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
        : required
            ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
            : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'

    return (
        <>
            {compact ? (
                <button
                    type="button"
                    onClick={() => setExpanded((o) => !o)}
                    title={value ? `${value.razon_social} (${value.rut}) — cambiar o quitar` : `Buscar cliente${required ? ' (requerido)' : ' (opcional)'}`}
                    className={`flex h-9 w-9 items-center justify-center rounded-md border shrink-0 transition-colors ${triggerToneClass}`}
                >
                    {value ? <UserCheck className="h-4 w-4" /> : <UserIcon className="h-4 w-4" />}
                </button>
            ) : (
                // Factura necesita más datos del cliente que Boleta, así que en vez del
                // ícono compacto ocupa toda la barra del carrito para que sea evidente
                // que hay que completarlo.
                <button
                    type="button"
                    onClick={() => setExpanded((o) => !o)}
                    className={`flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm transition-colors ${triggerToneClass}`}
                >
                    {value ? <UserCheck className="h-3.5 w-3.5 shrink-0" /> : <UserIcon className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate flex-1 text-left">
                        {value ? `${value.razon_social} — ${value.rut}` : `Buscar cliente${required ? ' (requerido)' : ' (opcional)'}…`}
                    </span>
                    {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
                </button>
            )}

            {expanded && (
                <div className={`${compact ? 'basis-full w-full' : ''} rounded-lg border border-border bg-muted/50 overflow-hidden`}>
                    {value ? (
                        // ── Ya hay un cliente elegido: mostrarlo y ofrecer cambiar/quitar ──
                        <div className="p-2.5 space-y-2">
                            <div className="flex items-center gap-2.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-2">
                                <UserCheck className="h-4 w-4 text-primary shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-primary truncate">{value.razon_social}</p>
                                    <p className="text-xs font-mono text-primary/80">{value.rut}</p>
                                </div>
                            </div>
                            <div className="flex gap-1.5">
                                <Button type="button" size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => onChange(null)}>
                                    Cambiar cliente
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 h-7 text-xs text-destructive hover:text-destructive"
                                    onClick={() => {
                                        onChange(null)
                                        setExpanded(false)
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
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                <Input
                                    ref={inputRef}
                                    placeholder={SEARCH_PLACEHOLDER}
                                    value={query}
                                    onChange={(e) => handleInputChange(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    className="h-9 rounded-none border-0 pl-8 pr-8 text-xs bg-transparent focus-visible:ring-0"
                                    autoComplete="off"
                                />
                                {loading && (
                                    <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                )}
                            </div>

                            <div ref={listRef} className="max-h-48 overflow-y-auto">
                                {query.length < 2 && (
                                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                        Escribe al menos 2 caracteres para buscar.
                                    </div>
                                )}

                                {query.length >= 2 && results.length === 0 && !loading && (
                                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                        No se encontraron clientes para &ldquo;{query}&rdquo;
                                    </div>
                                )}

                                {results.map((customer, idx) => (
                                    <button
                                        key={customer.id}
                                        data-combobox-item
                                        onClick={() => selectCustomer(customer)}
                                        onMouseEnter={() => setHighlightedIndex(idx)}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer border-t border-border first:border-t-0 ${idx === highlightedIndex ? 'bg-muted' : 'hover:bg-accent/50'
                                            }`}
                                    >
                                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-background shrink-0">
                                            <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs truncate text-foreground">
                                                <HighlightedText text={customer.razon_social} query={query} />
                                            </p>
                                            <p className="text-xs font-mono text-muted-foreground">
                                                <HighlightedText text={customer.rut} query={query} />
                                            </p>
                                        </div>
                                    </button>
                                ))}

                                {/* "Crear nuevo" — always visible */}
                                <button
                                    data-combobox-item
                                    onClick={() => {
                                        setExpanded(false)
                                        setCreateOpen(true)
                                    }}
                                    onMouseEnter={() => setHighlightedIndex(results.length)}
                                    className={`flex w-full items-center gap-2 px-3 py-2 text-left border-t border-border transition-colors cursor-pointer ${highlightedIndex === results.length ? 'bg-muted' : 'hover:bg-accent/50'
                                        }`}
                                >
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-background shrink-0">
                                        <Plus className="h-3 w-3 text-muted-foreground" />
                                    </div>
                                    <span className="text-xs font-medium text-foreground">
                                        Crear nuevo cliente
                                    </span>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-lg z-[100]">
                    <DialogHeader>
                        <DialogTitle>Nuevo cliente rápido</DialogTitle>
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
