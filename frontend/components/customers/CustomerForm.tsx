import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DialogFooter } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { AlertaError } from '@/components/ui/alerta-error'
import { Loader2 } from 'lucide-react'
import { CustomerCreate } from '@/services/customers'
import { getApiErrorDetail } from '@/services/api'
import { formatRut, validateRut } from '@/lib/rut'

const customerSchema = z.object({
    rut: z.string().min(1, 'El RUT es obligatorio').refine(validateRut, 'RUT inválido: revisa el dígito verificador'),
    razon_social: z.string().trim().min(1, 'La razón social es obligatoria'),
    giro: z.string(),
    direccion: z.string(),
    comuna: z.string(),
    ciudad: z.string(),
    email: z.string().email('Email inválido').or(z.literal('')),
})

type CustomerFormValues = z.infer<typeof customerSchema>

const VACIO: CustomerFormValues = { rut: '', razon_social: '', giro: '', direccion: '', comuna: '', ciudad: '', email: '' }

interface CustomerFormProps {
    initialData?: CustomerCreate
    /** Si lanza, el error se muestra en el formulario y el diálogo sigue abierto. */
    onSubmit: (data: CustomerCreate) => Promise<void>
    onCancel: () => void
    isEditing?: boolean
}

export default function CustomerForm({ initialData, onSubmit, onCancel, isEditing }: CustomerFormProps) {
    const form = useForm<CustomerFormValues>({ resolver: zodResolver(customerSchema), defaultValues: VACIO })

    useEffect(() => {
        form.reset(initialData ? { ...VACIO, ...initialData } : VACIO)
    }, [initialData, form])

    const guardar = async (values: CustomerFormValues) => {
        try {
            await onSubmit(values)
        } catch (error) {
            form.setError('root', { message: getApiErrorDetail(error, 'No se pudo guardar el cliente.') })
        }
    }

    const campo = (name: keyof CustomerFormValues, label: string, placeholder?: string, extra?: { disabled?: boolean; rut?: boolean }) => (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                        <Input
                            placeholder={placeholder}
                            disabled={extra?.disabled}
                            maxLength={extra?.rut ? 12 : undefined}
                            {...field}
                            onChange={(e) => field.onChange(extra?.rut ? formatRut(e.target.value) : e.target.value)}
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    )

    const { isSubmitting, errors } = form.formState

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(guardar)} className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                    {campo('rut', 'RUT *', '12.345.678-9', { disabled: !!isEditing, rut: true })}
                    {campo('email', 'Email', 'cliente@email.com')}
                </div>
                {campo('razon_social', 'Razón social *', 'Nombre o empresa')}
                {campo('giro', 'Giro', 'Rubro o actividad económica')}
                {campo('direccion', 'Dirección', 'Calle y número')}
                <div className="grid grid-cols-2 gap-4">
                    {campo('comuna', 'Comuna')}
                    {campo('ciudad', 'Ciudad')}
                </div>

                <AlertaError mensaje={errors.root?.message} />

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                        Cancelar
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                        Guardar
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    )
}
