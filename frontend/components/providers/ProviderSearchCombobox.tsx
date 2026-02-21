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
            <span className="font-bold text-blue-600 dark:text-blue-400">{match}</span>
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
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950/40">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200 truncate">
                        {value.razon_social}
                    </p>
                    <p className="text-[11px] font-mono text-emerald-600/80 dark:text-emerald-400/70">
                        {value.rut}
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-emerald-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0 transition-colors"
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
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
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
                        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-neutral-400" />
                    )}
                </div>

                {isOpen && (
                    <div
                        ref={listRef}
                        className="absolute z-50 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
                    >
                        <div className="max-h-[200px] overflow-y-auto">
                            {results.length === 0 && !loading && (
                                <div className="px-3 py-4 text-center text-xs text-neutral-400">
                                    <Truck className="h-5 w-5 mx-auto mb-1 opacity-40" />
                                    No se encontraron proveedores para "{query}"
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
                                            ? 'bg-blue-50 dark:bg-blue-950/40'
                                            : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                                        }
                                        ${idx > 0 ? 'border-t border-neutral-100 dark:border-neutral-800' : ''}
                                    `}
                                >
                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 shrink-0">
                                        <Truck className="h-3.5 w-3.5 text-neutral-500" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm truncate text-neutral-800 dark:text-neutral-200">
                                            <HighlightedText text={provider.razon_social} query={query} />
                                        </p>
                                        <p className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500">
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
                                flex w-full items-center gap-2 px-3 py-2.5 text-left border-t border-neutral-200 dark:border-neutral-700 transition-colors cursor-pointer
                                ${highlightedIndex === results.length
                                    ? 'bg-blue-50 dark:bg-blue-950/40'
                                    : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                                }
                            `}
                        >
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 shrink-0">
                                <Plus className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                            </div>
                            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
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
