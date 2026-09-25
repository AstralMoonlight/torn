'use client'

import { useEffect, useRef, useState } from 'react'
import {
    getTaxes,
    createTax,
    Tax,
    DOCUMENT_PRINT_TYPES,
    PRINT_FORMAT_OPTIONS,
    type ColorMode,
    type PrintFormat,
} from '@/services/config'
import { getApiErrorDetail } from '@/services/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableEmpty } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { AlertaError } from '@/components/ui/alerta-error'
import { Check, Loader2, Plus, Settings, Percent, Printer, LayoutGrid, Layers, FileText, Palette, Landmark, Users, Building2 } from 'lucide-react'
import { avisar, useUIStore } from '@/lib/store/uiStore'
import { useSessionStore } from '@/lib/store/sessionStore'
import { useSettingsStore } from '@/lib/store/settingsStore'
import { cn } from '@/lib/utils'
import FoliosTab from './FoliosTab'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import PaletaColores from '@/components/layout/PaletaColores'

type EstadoGuardado = { tipo: 'guardando' } | { tipo: 'guardado' } | { tipo: 'error'; mensaje: string } | null

/**
 * Estado de un guardado inmediato: "Guardando…", la marca "Guardado" por unos
 * segundos, o el error. Si falla, `settingsStore.guardar` ya volvió a la opción
 * anterior.
 */
function useGuardado() {
    const [estado, setEstado] = useState<EstadoGuardado>(null)
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
    const seguir = async (envio: Promise<void>) => {
        clearTimeout(timer.current)
        setEstado({ tipo: 'guardando' })
        try {
            await envio
            setEstado({ tipo: 'guardado' })
            timer.current = setTimeout(() => setEstado(null), 2500)
        } catch (error) {
            setEstado({ tipo: 'error', mensaje: getApiErrorDetail(error, 'No se pudo guardar el cambio.') })
        }
    }
    useEffect(() => () => clearTimeout(timer.current), [])
    return [estado, seguir] as const
}

function MarcaGuardado({ estado }: { estado: EstadoGuardado }) {
    if (!estado || estado.tipo === 'error') return null
    return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            {estado.tipo === 'guardando'
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Guardando…</>
                : <><Check className="h-3.5 w-3.5 text-primary" aria-hidden /> Guardado</>}
        </span>
    )
}

function Opcion({ activa, onClick, children, className }: {
    activa: boolean; onClick: () => void; children: React.ReactNode; className?: string
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={activa}
            className={cn(
                'rounded-md border-2 transition-all',
                activa
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:border-primary/40',
                className,
            )}
        >
            {children}
        </button>
    )
}

export default function ConfigurationPage() {
    const settings = useSettingsStore((s) => s.settings)
    const guardar = useSettingsStore((s) => s.guardar)
    const [taxes, setTaxes] = useState<Tax[]>([])
    const [loadingTaxes, setLoadingTaxes] = useState(true)
    const posVariantDisplay = useUIStore((s) => s.posVariantDisplay)
    const setPosVariantDisplay = useUIStore((s) => s.setPosVariantDisplay)
    const [impresion, seguirImpresion] = useGuardado()
    const [caja, seguirCaja] = useGuardado()
    const [color, seguirColor] = useGuardado()

    const isAdmin = useSessionStore((s) =>
        s.user?.is_superuser === true ||
        s.availableTenants.find((t) => t.id === s.selectedTenantId)?.role_name === 'ADMINISTRADOR')

    // New Tax Form State
    const [newTax, setNewTax] = useState({ name: '', rate: 19 })
    const [errorTax, setErrorTax] = useState<string | null>(null)
    const [creandoTax, setCreandoTax] = useState(false)

    useEffect(() => {
        loadTaxes()
    }, [])

    async function loadTaxes() {
        setLoadingTaxes(true)
        try {
            setTaxes(await getTaxes())
        } catch {
            avisar('No se pudieron cargar los impuestos.', { reintentar: loadTaxes })
        } finally {
            setLoadingTaxes(false)
        }
    }

    function resolvePrintFormat(key: string): PrintFormat {
        return settings?.print_formats?.[key] ?? settings?.print_format ?? '80mm'
    }

    // Se manda una entrada explícita por cada tipo de documento (no solo la que
    // cambió), para no depender de merges parciales en el backend.
    function setDocPrintFormat(key: string, format: PrintFormat) {
        const print_formats: Record<string, PrintFormat> = {}
        for (const { key: k } of DOCUMENT_PRINT_TYPES) {
            print_formats[k] = k === key ? format : resolvePrintFormat(k)
        }
        seguirImpresion(guardar({ print_formats }))
    }

    async function handleAddTax() {
        if (!newTax.name) {
            setErrorTax('Escribe el nombre del impuesto.')
            return
        }
        setErrorTax(null)
        setCreandoTax(true)
        try {
            await createTax({
                name: newTax.name,
                rate: newTax.rate / 100,
                is_active: true
            })
            setNewTax({ name: '', rate: 19 })
            loadTaxes()
        } catch (error) {
            setErrorTax(getApiErrorDetail(error, 'No se pudo crear el impuesto.'))
        } finally {
            setCreandoTax(false)
        }
    }

    if (!settings) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const modos: { value: ColorMode; label: string; detalle: string; icon: typeof Users }[] = [
        { value: 'empresa', label: 'Por empresa', detalle: 'Eliges un color y lo ven todos.', icon: Building2 },
        { value: 'usuario', label: 'Libre por usuario', detalle: 'Cada uno elige el suyo en el menú lateral.', icon: Users },
    ]

    return (
        <PageContainer className="max-w-4xl">
            <PageHeader
                icon={Settings}
                title="Configuración"
                description="Administra las preferencias generales y los parámetros del sistema."
            />

            <Tabs defaultValue="general" className="space-y-6">
                <TabsList>
                    <TabsTrigger value="general" className="gap-2">
                        <Settings className="h-4 w-4" /> General
                    </TabsTrigger>
                    <TabsTrigger value="impuestos" className="gap-2">
                        <Percent className="h-4 w-4" /> Impuestos
                    </TabsTrigger>
                    <TabsTrigger value="folios" className="gap-2">
                        <FileText className="h-4 w-4" /> Folios (CAF)
                    </TabsTrigger>
                </TabsList>

                <TabsContent data-section="configuracion.general" value="general" className="space-y-6">
                    <p className="text-xs text-muted-foreground">Los cambios se guardan solos al elegir cada opción.</p>

                    <Card>
                        <CardHeader>
                            <CardTitle>Preferencias de impresión</CardTitle>
                            <CardDescription>
                                Configura cómo se generan y visualizan los documentos de venta.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div data-section="configuracion.general.impresion" className="space-y-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <Label>Formato de impresión por tipo de documento</Label>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Cada documento que puedes emitir imprime con su propio formato.
                                        </p>
                                    </div>
                                    <MarcaGuardado estado={impresion} />
                                </div>
                                <div className="space-y-2">
                                    {DOCUMENT_PRINT_TYPES.map(({ key, label }) => {
                                        const current = resolvePrintFormat(key)
                                        return (
                                            <div
                                                key={key}
                                                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted px-4 py-3"
                                            >
                                                <span className="text-sm font-medium">{label}</span>
                                                <div className="flex gap-2">
                                                    {PRINT_FORMAT_OPTIONS.map(({ value, label: optLabel }) => (
                                                        <Opcion
                                                            key={value}
                                                            activa={current === value}
                                                            onClick={() => setDocPrintFormat(key, value)}
                                                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
                                                        >
                                                            {value !== 'carta' && <Printer className="h-3.5 w-3.5" />} {optLabel}
                                                        </Opcion>
                                                    ))}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                                {impresion?.tipo === 'error' && <AlertaError mensaje={impresion.mensaje} />}
                            </div>

                            {/* POS Variant Display Preference */}
                            <div data-section="configuracion.general.variantes" className="space-y-3 border-t pt-5">
                                <div>
                                    <Label>Vista del terminal POS: variantes</Label>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Cómo se muestran los productos con variantes en el punto de venta.
                                        Se guarda en este navegador.
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <Opcion
                                        activa={posVariantDisplay === 'grouped'}
                                        onClick={() => setPosVariantDisplay('grouped')}
                                        className="flex flex-col items-center gap-3 rounded-xl p-5"
                                    >
                                        <Layers className="h-8 w-8" />
                                        <div className="text-center">
                                            <p className="font-bold text-sm">Agrupado</p>
                                            <p className="text-xs opacity-70 mt-0.5">Producto padre con modal de variantes</p>
                                        </div>
                                    </Opcion>
                                    <Opcion
                                        activa={posVariantDisplay === 'flat'}
                                        onClick={() => setPosVariantDisplay('flat')}
                                        className="flex flex-col items-center gap-3 rounded-xl p-5"
                                    >
                                        <LayoutGrid className="h-8 w-8" />
                                        <div className="text-center">
                                            <p className="font-bold text-sm">Vista plana</p>
                                            <p className="text-xs opacity-70 mt-0.5">Todas las variantes visibles en el grid</p>
                                        </div>
                                    </Opcion>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {isAdmin && (
                        <Card data-section="configuracion.general.caja">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5" /> Caja</CardTitle>
                                <CardDescription>Turnos de caja con apertura y arqueo ciego al cierre.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted px-4 py-3">
                                    <div>
                                        <Label htmlFor="control-caja">Control de caja</Label>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Apagado, Caja desaparece del menú y el POS vende sin abrir turno.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <MarcaGuardado estado={caja} />
                                        <Switch
                                            id="control-caja"
                                            checked={settings.control_caja}
                                            onCheckedChange={(v) => seguirCaja(guardar({ control_caja: v }))}
                                        />
                                    </div>
                                </div>
                                {caja?.tipo === 'error' && <AlertaError mensaje={caja.mensaje} />}
                            </CardContent>
                        </Card>
                    )}

                    {isAdmin && (
                        <Card data-section="configuracion.general.color">
                            <CardHeader>
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" /> Color principal</CardTitle>
                                        <CardDescription className="mt-1.5">
                                            Botones, menú y acentos del sistema.
                                        </CardDescription>
                                    </div>
                                    <MarcaGuardado estado={color} />
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="grid grid-cols-2 gap-4">
                                    {modos.map(({ value, label, detalle, icon: Icono }) => (
                                        <Opcion
                                            key={value}
                                            activa={settings.color_mode === value}
                                            onClick={() => seguirColor(guardar({ color_mode: value }))}
                                            className="flex items-center gap-3 rounded-xl p-4 text-left"
                                        >
                                            <Icono className="h-6 w-6 shrink-0" />
                                            <div>
                                                <p className="font-bold text-sm">{label}</p>
                                                <p className="text-xs opacity-70 mt-0.5">{detalle}</p>
                                            </div>
                                        </Opcion>
                                    ))}
                                </div>
                                <div className="space-y-2">
                                    <Label>
                                        {settings.color_mode === 'empresa' ? 'Color de la empresa' : 'Color para quien no elija uno'}
                                    </Label>
                                    <PaletaColores
                                        valor={settings.color_primario}
                                        onElegir={(clave) => seguirColor(guardar({ color_primario: clave }))}
                                        className="grid-cols-5 sm:grid-cols-10 w-fit"
                                    />
                                </div>
                                {color?.tipo === 'error' && <AlertaError mensaje={color.mensaje} />}
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent data-section="configuracion.impuestos" value="impuestos">
                    <Card>
                        <CardHeader>
                            <CardTitle>Gestión de impuestos</CardTitle>
                            <CardDescription>
                                Configura las tasas impositivas que se aplican a tus productos.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* New Tax Form */}
                            <div className="space-y-3 bg-muted p-4 rounded-lg border border-border">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                                    <div className="space-y-2">
                                        <Label className="text-xs">Nombre del impuesto</Label>
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
                                    <Button onClick={handleAddTax} disabled={creandoTax} className="gap-2">
                                        {creandoTax ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Agregar
                                    </Button>
                                </div>
                                <AlertaError mensaje={errorTax} />
                            </div>

                            {/* Taxes Table */}
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Nombre</TableHead>
                                            <TableHead className="text-right">Tasa</TableHead>
                                            <TableHead className="text-center">Estado</TableHead>
                                            <TableHead className="text-center">Por defecto</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loadingTaxes ? (
                                            <TableEmpty colSpan={4} loading />
                                        ) : taxes.length === 0 ? (
                                            <TableEmpty colSpan={4}>No hay impuestos configurados.</TableEmpty>
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
                                                        {tax.is_default && <Badge variant="outline" className="text-foreground border-border bg-muted">Default</Badge>}
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

                <TabsContent data-section="configuracion.folios" value="folios">
                    <Card>
                        <CardContent className="pt-6">
                            <FoliosTab />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </PageContainer>
    )
}
