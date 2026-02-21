'use client'

import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface Props {
    onSearch: (query: string) => void
}

export default function ProductSearch({ onSearch }: Props) {
    return (
        <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
            <Input
                type="text"
                placeholder="Buscar por nombre, SKU o código de barras..."
                className="h-12 pl-11 text-base bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 focus-visible:ring-blue-500"
                onChange={(e) => onSearch(e.target.value)}
                autoFocus
            />
        </div>
    )
}
