'use client'

import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { avisar } from '@/lib/store/uiStore'
import { getPriceLists, type PriceListRead } from '@/services/price_lists'
import { useCartStore } from '@/lib/store/cartStore'
import { useHydrated } from '@/lib/hooks/useHydrated'
import { Tag } from 'lucide-react'

export default function PriceListSelector() {
    const { priceList, setPriceList } = useCartStore()
    const [lists, setLists] = useState<PriceListRead[]>([])

    useEffect(() => {
        getPriceLists()
            .then(setLists)
            .catch(() => avisar('No se pudieron cargar las listas de precios.'))
    }, [])

    const handleValueChange = (val: string) => {
        if (val === 'base') {
            setPriceList(null)
        } else {
            const list = lists.find(l => l.id.toString() === val)
            setPriceList(list || null)
        }
    }

    // Don't render until client loads (zustand hydration)
    const mounted = useHydrated()
    if (!mounted) return null

    return (
        <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <Select value={priceList ? priceList.id.toString() : 'base'} onValueChange={handleValueChange}>
                <SelectTrigger className="h-8 w-full border-border text-xs">
                    <SelectValue placeholder="Precio Base" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="base" className="font-medium">
                        Precio Base
                    </SelectItem>
                    {lists.map(list => (
                        <SelectItem key={list.id} value={list.id.toString()} className="text-primary">
                            {list.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
