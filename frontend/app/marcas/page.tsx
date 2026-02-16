'use client'

import { useState, useEffect } from 'react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getBrands, createBrand, updateBrand, deleteBrand, Brand } from '@/services/brands'
import { getApiErrorMessage } from '@/services/api'
import { toast } from 'sonner'
import { Pencil, Trash2, Plus, Search, Loader2 } from 'lucide-react'

export default function BrandsPage() {
    const [brands, setBrands] = useState<Brand[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('')

    // Dialog state
    const [open, setOpen] = useState(false)
    const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
    const [name, setName] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        loadBrands()
    }, [])

    const loadBrands = async () => {
        setLoading(true)
        try {
            const data = await getBrands()
            setBrands(data)
        } catch (error) {
            console.error(error)
            toast.error(getApiErrorMessage(error, 'Error al cargar marcas'))
        } finally {
            setLoading(false)
        }
    }

    const filteredBrands = brands.filter(b =>
        b.name.toLowerCase().includes(filter.toLowerCase())
    )

    const handleOpenCreate = () => {
        setEditingBrand(null)
        setName('')
        setOpen(true)
    }

    const handleOpenEdit = (brand: Brand) => {
        setEditingBrand(brand)
        setName(brand.name)
        setOpen(true)
    }

    const handleSave = async () => {
        if (!name.trim()) return

        setSaving(true)
        try {
            if (editingBrand) {
                // Update
                const updated = await updateBrand(editingBrand.id, { name })
                setBrands(brands.map(b => b.id === updated.id ? updated : b))
                toast.success('Marca actualizada')
            } else {
                // Create
                const created = await createBrand({ name })
                setBrands([...brands, created])
                toast.success('Marca creada')
            }
            setOpen(false)
        } catch (error) {
            console.error(error)
            toast.error('Error al guardar marca')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (brand: Brand) => {
        if (!confirm(`¿Eliminar marca ${brand.name}?`)) return

        try {
            await deleteBrand(brand.id)
            setBrands(brands.filter(b => b.id !== brand.id))
            toast.success('Marca eliminada')
        } catch (error) {
            console.error(error)
            toast.error('Error al eliminar marca (¿está en uso?)')
        }
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Marcas</h1>
                    <p className="text-muted-foreground">Gestiona las marcas de tus productos.</p>
                </div>
                <Button onClick={handleOpenCreate} className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="mr-2 h-4 w-4" /> Nueva Marca
                </Button>
            </div>

            <div className="flex items-center gap-2 max-w-sm">
                <Search className="h-4 w-4 text-slate-500" />
                <Input
                    placeholder="Buscar marca..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-9"
                />
            </div>

            <div className="border rounded-lg bg-white dark:bg-slate-950 shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[100px]">ID</TableHead>
                            <TableHead>Nombre</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={3} className="h-24 text-center">
                                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-400" />
                                </TableCell>
                            </TableRow>
                        ) : filteredBrands.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                                    No se encontraron marcas.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredBrands.map((brand) => (
                                <TableRow key={brand.id}>
                                    <TableCell className="font-mono text-xs">{brand.id}</TableCell>
                                    <TableCell className="font-medium">{brand.name}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleOpenEdit(brand)}
                                                className="h-8 w-8 p-0"
                                            >
                                                <Pencil className="h-4 w-4 text-blue-600" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDelete(brand)}
                                                className="h-8 w-8 p-0"
                                            >
                                                <Trash2 className="h-4 w-4 text-red-500" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingBrand ? 'Editar Marca' : 'Nueva Marca'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Nombre</Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Ej. Nike, Adidas..."
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} disabled={!name.trim() || saving} className="bg-blue-600 hover:bg-blue-700">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
