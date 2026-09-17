'use client'

import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface Props {
    onSearch: (query: string) => void
}

export default function ProductSearch({ onSearch }: Props) {
    return (
        <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
                type="text"
                placeholder="Buscar por nombre, SKU o código de barras..."
                className="h-12 pl-11 text-base bg-background border-border focus-visible:ring-ring"
                onChange={(e) => onSearch(e.target.value)}
                autoFocus
            />
        </div>
    )
}
