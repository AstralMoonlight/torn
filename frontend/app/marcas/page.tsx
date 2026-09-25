'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
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
import { AccionFila } from '@/components/ui/accion-fila'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { AlertaError } from '@/components/ui/alerta-error'
import { getBrands, createBrand, updateBrand, deleteBrand, Brand } from '@/services/brands'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { Pencil, Trash2, Plus, Loader2, Tags } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'

const brandSchema = z.object({ name: z.string().trim().min(1, 'El nombre es obligatorio') })
type BrandFormValues = z.infer<typeof brandSchema>

export default function BrandsPage() {
    const [brands, setBrands] = useState<Brand[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('')

    // Dialog state
    const [open, setOpen] = useState(false)
    const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
    const form = useForm<BrandFormValues>({ resolver: zodResolver(brandSchema), defaultValues: { name: '' } })

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
            avisar(getApiErrorMessage(error, 'Error al cargar marcas'), { reintentar: loadBrands })
        } finally {
            setLoading(false)
        }
    }

    const filteredBrands = brands.filter(b =>
        b.name.toLowerCase().includes(filter.toLowerCase())
    )

    const handleOpenCreate = () => {
        setEditingBrand(null)
        form.reset({ name: '' })
        setOpen(true)
    }

    const handleOpenEdit = (brand: Brand) => {
        setEditingBrand(brand)
        form.reset({ name: brand.name })
        setOpen(true)
    }

    const handleSave = async ({ name }: BrandFormValues) => {
        try {
            if (editingBrand) {
                const updated = await updateBrand(editingBrand.id, { name })
                setBrands(brands.map(b => b.id === updated.id ? updated : b))
            } else {
                const created = await createBrand({ name })
                setBrands([...brands, created])
            }
            setOpen(false)
        } catch (error) {
            console.error(error)
            form.setError('root', { message: getApiErrorDetail(error, 'No se pudo guardar la marca.') })
        }
    }
    const saving = form.formState.isSubmitting

    const [toDelete, setToDelete] = useState<Brand | null>(null)

    const handleDelete = async (brand: Brand) => {
        try {
            await deleteBrand(brand.id)
            setBrands(brands.filter(b => b.id !== brand.id))
        } catch (error) {
            console.error(error)
            avisar(getApiErrorDetail(error, 'No se pudo eliminar la marca (¿está en uso?).'))
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
                        <Plus className="h-4 w-4" /> Nueva Marca
                    </Button>
                }
            />

            <ListToolbar
                busqueda={filter}
                onBusqueda={setFilter}
                placeholder="Buscar marca..."
                visibles={filteredBrands.length}
                total={brands.length}
                unidad="marcas"
            />

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
                                            <AccionFila icon={Pencil} label="Editar" onClick={() => handleOpenEdit(brand)} />
                                            <AccionFila icon={Trash2} label="Eliminar" onClick={() => setToDelete(brand)} peligro />
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
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleSave)} className="space-y-4 py-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nombre</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ej. Nike, Adidas..." {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <AlertaError mensaje={form.formState.errors.root?.message} />
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                                    Cancelar
                                </Button>
                                <Button type="submit" disabled={saving}>
                                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Guardar
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
            <ConfirmDialog
                open={!!toDelete}
                onOpenChange={(o) => !o && setToDelete(null)}
                title="¿Eliminar marca?"
                description={toDelete?.name}
                onConfirm={async () => { if (toDelete) await handleDelete(toDelete) }}
            />
        </PageContainer>
    )
}
