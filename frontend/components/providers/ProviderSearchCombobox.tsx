'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { searchProviders, Provider } from '@/services/providers'
import ProviderDialog from '@/components/providers/ProviderDialog'
import { toast } from 'sonner'
import {
    Loader2,
    Search,
    Truck,
    Plus,
    X,
    CheckCircle2,
} from 'lucide-react'

interface Props {
    value: Provider | null
    onChange: (provider: Provider | null) => void
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
            <span className="font-bold text-primary">{match}</span>
            {after}
        </>
    )
}

export default function ProviderSearchCombobox({
    value,
    onChange,
    placeholder = 'Buscar proveedor por Razón Social o RUT…',
}: Props) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<Provider[]>([])
    const [isOpen, setIsOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const [createOpen, setCreateOpen] = useState(false)

    const containerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const listRef = useRef<HTMLDivElement>(null)

    // ── Debounced search ──────────────────────────────────────────
    const performSearch = useCallback(async (q: string) => {
        if (q.length < 2) {
            setResults([])
            setIsOpen(false)
            return
        }

        setLoading(true)
        try {
            const data = await searchProviders(q)
            setResults(data)
            setIsOpen(true)
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
                setIsOpen(false)
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

    // ── Close dropdown on click outside ──────────────────────────
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

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
        if (!isOpen && e.key !== 'Escape') {
            if (e.key === 'ArrowDown' && query.length >= 2) {
                performSearch(query)
            }
            return
        }

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
                    selectProvider(results[highlightedIndex])
                } else if (highlightedIndex === results.length) {
                    setIsOpen(false)
                    setCreateOpen(true)
                }
                break
            case 'Escape':
                e.preventDefault()
                setIsOpen(false)
                break
        }
    }

    // ── Select / clear ───────────────────────────────────────────
    const selectProvider = (p: Provider) => {
        onChange(p)
        setQuery('')
        setResults([])
        setIsOpen(false)
    }

    const clearProvider = () => {
        onChange(null)
        setQuery('')
        setTimeout(() => inputRef.current?.focus(), 50)
    }

    // ── Provider creation handler ────────────────────────────────
    const handleCreateSuccess = () => {
        setCreateOpen(false)
        toast.success('Proveedor creado. Por favor búscalo de nuevo.')
    }

    // ── RENDER: Selected state (chip) ────────────────────────────
    if (value) {
        return (
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
                    onClick={clearProvider}
                    type="button"
                >
                    <X className="h-3.5 w-3.5" />
                </Button>
            </div>
        )
    }

    // ── RENDER: Search state ─────────────────────────────────────
    return (
        <>
            <div ref={containerRef} className="relative">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                        ref={inputRef}
                        placeholder={placeholder}
                        value={query}
                        onChange={(e) => handleInputChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => {
                            if (query.length >= 2 && results.length > 0) setIsOpen(true)
                        }}
                        className="pl-8 pr-8 h-9 text-sm"
                        autoComplete="off"
                    />
                    {loading && (
                        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                </div>

                {isOpen && (
                    <div
                        ref={listRef}
                        className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
                    >
                        <div className="max-h-[200px] overflow-y-auto">
                            {results.length === 0 && !loading && (
                                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                    <Truck className="h-5 w-5 mx-auto mb-1 opacity-40" />
                                    No se encontraron proveedores para &ldquo;{query}&rdquo;
                                </div>
                            )}

                            {results.map((provider, idx) => (
                                <button
                                    key={provider.id}
                                    data-combobox-item
                                    onClick={() => selectProvider(provider)}
                                    onMouseEnter={() => setHighlightedIndex(idx)}
                                    className={`
                                        flex w-full items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer
                                        ${idx === highlightedIndex
                                            ? 'bg-primary/10'
                                            : 'hover:bg-accent/50'
                                        }
                                        ${idx > 0 ? 'border-t border-border' : ''}
                                    `}
                                >
                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted shrink-0">
                                        <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm truncate text-foreground">
                                            <HighlightedText text={provider.razon_social} query={query} />
                                        </p>
                                        <p className="text-[11px] font-mono text-muted-foreground dark:text-muted-foreground">
                                            <HighlightedText text={provider.rut} query={query} />
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>

                        <button
                            data-combobox-item
                            onClick={() => {
                                setIsOpen(false)
                                setCreateOpen(true)
                            }}
                            onMouseEnter={() => setHighlightedIndex(results.length)}
                            className={`
                                flex w-full items-center gap-2 px-3 py-2.5 text-left border-t border-border transition-colors cursor-pointer
                                ${highlightedIndex === results.length
                                    ? 'bg-primary/10'
                                    : 'hover:bg-accent/50'
                                }
                            `}
                        >
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 shrink-0">
                                <Plus className="h-3 w-3 text-primary" />
                            </div>
                            <span className="text-xs font-medium text-primary">
                                Crear nuevo proveedor
                            </span>
                        </button>
                    </div>
                )}
            </div>

            <ProviderDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                onSuccess={handleCreateSuccess}
            />
        </>
    )
}
