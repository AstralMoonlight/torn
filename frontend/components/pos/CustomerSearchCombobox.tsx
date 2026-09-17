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
    Plus,
    X,
    CheckCircle2,
} from 'lucide-react'

interface Props {
    value: Customer | null
    onChange: (customer: Customer | null) => void
    required?: boolean
    placeholder?: string
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

export default function CustomerSearchCombobox({
    value,
    onChange,
    placeholder = 'Buscar por Nombre o RUT…',
}: Props) {
    // La búsqueda vive dentro de un Dialog (no un dropdown flotando sobre el
    // input) — este selector se usa dentro de CartPanel, un panel angosto y
    // con poco alto libre debajo (Referencias, totales, botón Cobrar), y un
    // dropdown absoluto ahí terminaba tapando todo eso. El Dialog tiene su
    // propio fondo/overlay, así que no hay nada que pueda quedar cubierto.
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
        if (searchOpen) {
            setQuery('')
            setResults([])
            setHighlightedIndex(-1)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [searchOpen])

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

    const clearCustomer = () => {
        onChange(null)
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

    const createCustomerDialog = (
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
    )

    // ── RENDER: Selected state (chip) ────────────────────────────
    if (value) {
        return (
            <>
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-primary truncate">
                            {value.razon_social}
                        </p>
                        <p className="text-[11px] font-mono text-primary/80">
                            {value.rut}
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-primary hover:text-destructive hover:bg-destructive/10 shrink-0 transition-colors"
                        onClick={clearCustomer}
                        type="button"
                    >
                        <X className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {createCustomerDialog}
            </>
        )
    }

    // ── RENDER: Trigger (abre el Dialog de búsqueda) ─────────────
    return (
        <>
            <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
            >
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{placeholder}</span>
            </button>

            <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
                <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
                    <DialogTitle className="sr-only">Buscar cliente</DialogTitle>
                    <div className="relative border-b border-border">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            ref={inputRef}
                            placeholder={placeholder}
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
                </DialogContent>
            </Dialog>

            {createCustomerDialog}
        </>
    )
}
