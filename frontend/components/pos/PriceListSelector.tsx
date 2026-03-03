'use client'

import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { getPriceLists, type PriceListRead } from '@/services/price_lists'
import { useCartStore } from '@/lib/store/cartStore'
import { Tag } from 'lucide-react'

export default function PriceListSelector() {
    const { priceList, setPriceList } = useCartStore()
    const [lists, setLists] = useState<PriceListRead[]>([])

    useEffect(() => {
        getPriceLists()
            .then(setLists)
            .catch(() => toast.error('Error cargando listas de precios'))
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
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])
    if (!mounted) return null

    return (
        <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-neutral-400" />
            <Select value={priceList ? priceList.id.toString() : 'base'} onValueChange={handleValueChange}>
                <SelectTrigger className="h-8 w-full border-neutral-200 dark:border-neutral-800 text-xs">
                    <SelectValue placeholder="Precio Base" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="base" className="font-medium">
                        Precio Base
                    </SelectItem>
                    {lists.map(list => (
                        <SelectItem key={list.id} value={list.id.toString()} className="text-blue-600 dark:text-blue-400">
                            {list.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
