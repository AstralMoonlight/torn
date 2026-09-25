'use client'

import { useState, useEffect } from 'react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
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
import { Pencil, Trash2, Plus, Search, Loader2, Tags } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'

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
        <PageContainer>
            <PageHeader
                icon={Tags}
                title="Marcas"
                description="Gestiona las marcas de tus productos."
                actions={
                    <Button onClick={handleOpenCreate}>
                        <Plus className="mr-2 h-4 w-4" /> Nueva Marca
                    </Button>
                }
            />

            <div data-section="marcas.buscador" className="flex items-center gap-2 max-w-sm">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Buscar marca..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-9"
                />
            </div>

            <div data-section="marcas.tabla" className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
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
                            <TableEmpty colSpan={3} loading />
                        ) : filteredBrands.length === 0 ? (
                            <TableEmpty colSpan={3}>No se encontraron marcas.</TableEmpty>
                        ) : (
                            filteredBrands.map((brand) => (
                                <TableRow key={brand.id} className="hover:bg-accent/50 transition-colors">
                                    <TableCell className="font-mono text-xs">{brand.id}</TableCell>
                                    <TableCell className="font-medium">{brand.name}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleOpenEdit(brand)}
                                                className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                title="Editar"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDelete(brand)}
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                title="Eliminar"
                                            >
                                                <Trash2 className="h-4 w-4" />
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
                <DialogContent data-section="marcas.formulario">
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
                        <Button onClick={handleSave} disabled={!name.trim() || saving} className="">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageContainer>
    )
}
