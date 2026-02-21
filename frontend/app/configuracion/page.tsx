'use client'

import { useEffect, useState } from 'react'
import {
    getSettings,
    updateSettings,
    getTaxes,
    createTax,
    updateTax,
    Tax,
    SystemSettings
} from '@/services/config'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Loader2, Save, Plus, Settings, Percent, Printer } from 'lucide-react'

export default function ConfigurationPage() {
    const [settings, setSettings] = useState<SystemSettings | null>(null)
    const [taxes, setTaxes] = useState<Tax[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // New Tax Form State
    const [newTax, setNewTax] = useState({ name: '', rate: 19 })

    useEffect(() => {
        loadData()
    }, [])

    async function loadData() {
        setLoading(true)
        try {
            const [s, t] = await Promise.all([getSettings(), getTaxes()])
            setSettings(s)
            setTaxes(t)
        } catch (error) {
            toast.error('Error al cargar configuración')
        } finally {
            setLoading(false)
        }
    }

    async function handleSaveSettings() {
        if (!settings) return
        setSaving(true)
        try {
            await updateSettings({
                print_format: settings.print_format,
                iva_default_id: settings.iva_default_id
            })
            toast.success('Configuración guardada')
        } catch (error) {
            toast.error('Error al guardar configuración')
        } finally {
            setSaving(false)
        }
    }

    async function handleAddTax() {
        if (!newTax.name) return
        try {
            await createTax({
                name: newTax.name,
                rate: newTax.rate / 100,
                is_active: true
            })
            toast.success('Impuesto creado')
            setNewTax({ name: '', rate: 19 })
            loadData()
        } catch (error) {
            toast.error('Error al crear impuesto')
        }
    }

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        )
    }

    return (
        <div className="container mx-auto py-8 max-w-4xl space-y-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
                <p className="text-neutral-500">Administra las preferencias generales y parámetros del sistema.</p>
            </div>

            <Tabs defaultValue="general" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="general" className="gap-2">
                        <Settings className="h-4 w-4" /> General
                    </TabsTrigger>
                    <TabsTrigger value="impuestos" className="gap-2">
                        <Percent className="h-4 w-4" /> Impuestos
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="general">
                    <Card>
                        <CardHeader>
                            <CardTitle>Preferencias de Impresión</CardTitle>
                            <CardDescription>
                                Configura cómo se generan y visualizan los documentos de venta.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-3">
                                <Label>Formato de Documentos (Ticket/Factura)</Label>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => setSettings(s => s ? { ...s, print_format: '80mm' } : null)}
                                        className={`flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all ${settings?.print_format === '80mm'
                                                ? 'border-blue-600 bg-blue-50/50 text-blue-600'
                                                : 'border-neutral-100 bg-neutral-50 text-neutral-500 hover:border-neutral-200'
                                            }`}
                                    >
                                        <Printer className="h-8 w-8" />
                                        <div className="text-center">
                                            <p className="font-bold">Termico 80mm</p>
                                            <p className="text-xs opacity-70">Ideal para tickets rápidos</p>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => setSettings(s => s ? { ...s, print_format: 'carta' } : null)}
                                        className={`flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all ${settings?.print_format === 'carta'
                                                ? 'border-blue-600 bg-blue-50/50 text-blue-600'
                                                : 'border-neutral-100 bg-neutral-50 text-neutral-500 hover:border-neutral-200'
                                            }`}
                                    >
                                        <div className="h-8 w-6 border-2 border-current rounded-sm relative">
                                            <div className="absolute top-1 left-1 right-1 h-0.5 bg-current opacity-30"></div>
                                            <div className="absolute top-2.5 left-1 right-1 h-0.5 bg-current opacity-30"></div>
                                            <div className="absolute top-4 left-1 right-1 h-0.5 bg-current opacity-30"></div>
                                        </div>
                                        <div className="text-center">
                                            <p className="font-bold">Carta / A4</p>
                                            <p className="text-xs opacity-70">Formato factura tradicional</p>
                                        </div>
                                    </button>
                                </div>
                            </div>

                            <div className="flex justify-end pt-4 border-t">
                                <Button onClick={handleSaveSettings} disabled={saving} className="gap-2">
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    Guardar Cambios
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="impuestos">
                    <Card>
                        <CardHeader>
                            <CardTitle>Gestión de Impuestos</CardTitle>
                            <CardDescription>
                                Configura las tasas impositivas que se aplican a tus productos.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* New Tax Form */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end bg-neutral-50 p-4 rounded-lg border border-neutral-100">
                                <div className="space-y-2">
                                    <Label className="text-xs">Nombre del Impuesto</Label>
                                    <Input
                                        placeholder="Ej: IVA 19%"
                                        value={newTax.name}
                                        onChange={e => setNewTax({ ...newTax, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Tasa (%)</Label>
                                    <Input
                                        type="number"
                                        value={newTax.rate}
                                        onChange={e => setNewTax({ ...newTax, rate: parseFloat(e.target.value) || 0 })}
                                    />
                                </div>
                                <Button onClick={handleAddTax} className="gap-2">
                                    <Plus className="h-4 w-4" /> Agregar
                                </Button>
                            </div>

                            {/* Taxes Table */}
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Nombre</TableHead>
                                            <TableHead className="text-right">Tasa</TableHead>
                                            <TableHead className="text-center">Estado</TableHead>
                                            <TableHead className="text-center">Por Defecto</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {taxes.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="h-24 text-center text-neutral-500">
                                                    No hay impuestos configurados.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            taxes.map((tax) => (
                                                <TableRow key={tax.id}>
                                                    <TableCell className="font-medium">{tax.name}</TableCell>
                                                    <TableCell className="text-right font-tabular">
                                                        {(tax.rate * 100).toFixed(1)}%
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Badge variant={tax.is_active ? 'default' : 'secondary'}>
                                                            {tax.is_active ? 'Activo' : 'Inactivo'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        {tax.is_default && <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">Default</Badge>}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
