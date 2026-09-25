'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AlertaError } from '@/components/ui/alerta-error'
import { Loader2 } from 'lucide-react'
import { cleanRut, formatRut, validateRut } from '@/lib/rut'
import { createProvider, updateProvider, type Provider } from '@/services/providers'
import { getApiErrorDetail } from '@/services/api'

const providerSchema = z.object({
    rut: z.string().min(1, 'RUT es requerido').refine(validateRut, 'RUT inválido'),
    razon_social: z.string().min(1, 'Nombre/Razón Social es requerido'),
    giro: z.string().optional().default(''),
    direccion: z.string().optional().default(''),
    email: z.string().email('Email inválido').optional().or(z.literal('')).default(''),
    telefono: z.string().optional().default(''),
    ciudad: z.string().optional().default(''),
})

type ProviderFormValues = z.input<typeof providerSchema>

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    provider?: Provider | null
    onSuccess: (guardado: Provider) => void
}

export default function ProviderDialog({ open, onOpenChange, provider, onSuccess }: Props) {
    const form = useForm<ProviderFormValues>({
        resolver: zodResolver(providerSchema),
        defaultValues: {
            rut: '',
            razon_social: '',
            giro: '',
            direccion: '',
            email: '',
            telefono: '',
            ciudad: '',
        },
    })

    useEffect(() => {
        if (open) {
            if (provider) {
                form.reset({
                    rut: formatRut(provider.rut),
                    razon_social: provider.razon_social,
                    giro: provider.giro || '',
                    direccion: provider.direccion || '',
                    email: provider.email || '',
                    telefono: provider.telefono || '',
                    ciudad: provider.ciudad || '',
                })
            } else {
                form.reset({
                    rut: '',
                    razon_social: '',
                    giro: '',
                    direccion: '',
                    email: '',
                    telefono: '',
                    ciudad: '',
                })
            }
        }
    }, [open, provider, form])

    const onSubmit = async (values: ProviderFormValues) => {
        try {
            const payload = {
                ...values,
                rut: cleanRut(values.rut),
            }

            const guardado = provider
                ? await updateProvider(provider.id, payload)
                : await createProvider(payload)
            onSuccess(guardado)
            onOpenChange(false)
        } catch (error) {
            form.setError('root', { message: getApiErrorDetail(error, 'No se pudo guardar el proveedor.') })
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent data-section="proveedores.formulario" className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{provider ? 'Editar Proveedor' : 'Nuevo Proveedor'}</DialogTitle>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="rut"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>RUT</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="12.345.678-9"
                                                {...field}
                                                onChange={(e) => field.onChange(formatRut(e.target.value))}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="razon_social"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Razón Social</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Distribuidora S.A." {...field} value={field.value || ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="giro"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Giro</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Venta de abarrotes" {...field} value={field.value || ''} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="direccion"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Dirección</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Av. Principal 123" {...field} value={field.value || ''} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="ciudad"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Ciudad</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Ej: Santiago" {...field} value={field.value || ''} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Email</FormLabel>
                                        <FormControl>
                                            <Input placeholder="contacto@proveedor.cl" {...field} value={field.value || ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="telefono"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Teléfono</FormLabel>
                                        <FormControl>
                                            <Input placeholder="+56 9..." {...field} value={field.value || ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <AlertaError mensaje={form.formState.errors.root?.message} />

                        <DialogFooter className="pt-4">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={form.formState.isSubmitting}>
                                {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                                Guardar
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
