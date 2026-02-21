'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionStore } from '@/lib/store/sessionStore'
import { validateSession } from '@/services/auth'
import { Button } from '@/components/ui/button'
import { Store, Building2, ArrowRight, ShieldAlert, LogOut } from 'lucide-react'

export default function SelectTenantPage() {
    const router = useRouter()
    const { availableTenants, selectedTenantId, selectTenant, token, user, logout, syncSession } = useSessionStore()

    const activeTenants = useMemo(() => availableTenants.filter(t => t.is_active), [availableTenants])
    const inactiveTenants = useMemo(() => availableTenants.filter(t => !t.is_active), [availableTenants])

    useEffect(() => {
        if (!token) {
            router.push('/login')
            return
        }

        // Sincronizar estado real desde el servidor al entrar
        validateSession()
            .then(data => {
                syncSession(data.user, data.available_tenants)
            })
            .catch(err => {
                console.error('[SelectTenant] Error syncing session:', err)
            })
    }, [token, syncSession, router])

    useEffect(() => {
        if (!token) return

        // Si es superusuario sin empresas, va al panel global
        if (availableTenants.length === 0 && user?.is_superuser) {
            router.push('/saas-admin')
            return
        }

        // Si solo hay UN tenant y está ACTIVO, auto-seleccionar
        if (activeTenants.length === 1 && inactiveTenants.length === 0) {
            // Evitar bucle infinito: solo seleccionar si es distinto al actual
            if (selectedTenantId !== activeTenants[0].id) {
                selectTenant(activeTenants[0].id)
                router.push('/pos')
            }
        }
    }, [token, availableTenants, router, selectTenant, user, activeTenants, inactiveTenants, selectedTenantId])

    const handleSelect = (tenantId: number) => {
        selectTenant(tenantId)
        router.push('/pos')
    }

    const handleLogout = () => {
        logout()
        router.push('/login')
    }

    // CASO A: No hay ninguna empresa asociada (ni activa ni inactiva)
    if (availableTenants.length === 0) {
        if (user?.is_superuser) {
            return <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 text-neutral-500 font-medium italic">Redirigiendo a Panel Global...</div>
        }

        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
                <div className="w-full max-w-sm text-center border-neutral-100 dark:border-neutral-800 space-y-6 bg-white dark:bg-neutral-900 p-10 rounded-3xl shadow-2xl border">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-neutral-50 dark:bg-neutral-800 text-neutral-400 rotate-3">
                        <Building2 className="w-10 h-10" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">Sin Empresas</h2>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                            No posees ninguna empresa asignada actualmente. Contacta al administrador para obtener acceso.
                        </p>
                    </div>
                    <Button variant="outline" className="w-full h-11 cursor-pointer" onClick={handleLogout}>
                        <LogOut className="mr-2 h-4 w-4" /> Cerrar Sesión
                    </Button>
                </div>
            </div>
        )
    }

    // CASO B: Hay empresas pero TODAS están desactivadas (Falta de pago)
    if (activeTenants.length === 0 && inactiveTenants.length > 0) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
                <div className="w-full max-w-sm relative overflow-hidden text-center space-y-6 bg-white dark:bg-neutral-900 p-10 rounded-3xl shadow-2xl border border-neutral-100 dark:border-neutral-800">
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[120px] font-black text-neutral-50 dark:text-neutral-800/20 select-none pointer-events-none leading-none opacity-50">
                        OFF
                    </div>

                    <div className="relative z-10 space-y-4">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-orange-50 dark:bg-orange-950/30 text-orange-500 dark:orange-400 rotate-3 border border-orange-100 dark:border-orange-900/30 shadow-sm">
                            <ShieldAlert className="w-10 h-10" />
                        </div>

                        <div className="space-y-4">
                            <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">
                                Suscripción inactiva
                            </h2>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed max-w-[280px] mx-auto">
                                Tu espacio de trabajo está pausado por una factura vencida. Completa el pago para reactivar el servicio inmediatamente.
                            </p>
                        </div>

                        <div className="pt-4 flex flex-col gap-3">
                            <Button
                                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg shadow-blue-600/20 cursor-pointer"
                                onClick={() => window.open('https://pagos.tu-sistema.com', '_blank')}
                            >
                                <Store className="mr-2 h-5 w-5" /> Reactivar mi cuenta
                            </Button>

                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full h-11 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                                onClick={handleLogout}
                            >
                                <LogOut className="mr-2 h-4 w-4" /> Volver más tarde
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // CASO C: Listado normal (incluye activeTenants y opcionalmente inactiveTenants como deshabilitados)
    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
            <div className="w-full max-w-md space-y-8 bg-white dark:bg-neutral-900 p-8 rounded-2xl shadow-xl border border-neutral-200 dark:border-neutral-800">
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 text-white mb-2 shadow-lg shadow-blue-600/20">
                        <Building2 className="w-6 h-6" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">
                        Selecciona tu Empresa
                    </h1>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        Elige la organización con la que deseas operar hoy:
                    </p>
                </div>

                <div className="space-y-3 mt-6">
                    {[...activeTenants, ...inactiveTenants].map((tenant) => (
                        <Button
                            key={tenant.id}
                            variant="outline"
                            disabled={!tenant.is_active}
                            className={`w-full h-auto p-4 justify-between group transition-all ${tenant.is_active
                                ? 'hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/50 cursor-pointer'
                                : 'opacity-60 cursor-not-allowed grayscale'
                                }`}
                            onClick={() => tenant.is_active && handleSelect(tenant.id)}
                        >
                            <div className="flex items-center gap-3 text-left">
                                <div className={`p-2 rounded-lg ${tenant.is_active
                                    ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 group-hover:bg-blue-100 group-hover:text-blue-600 dark:group-hover:bg-blue-900 dark:group-hover:text-blue-400'
                                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400'
                                    }`}>
                                    <Store className="w-5 h-5" />
                                </div>
                                <div className="relative">
                                    <div className={`font-semibold ${tenant.is_active ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500'}`}>
                                        {tenant.name}
                                    </div>
                                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                                        RUT: {tenant.rut} &bull; {tenant.is_active ? `Rol: ${tenant.role_name}` : 'SUSPENDIDO POR NO PAGO'}
                                    </div>
                                </div>
                            </div>
                            {tenant.is_active && (
                                <ArrowRight className="w-5 h-5 text-neutral-400 group-hover:text-blue-600 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                            )}
                        </Button>
                    ))}
                </div>

                <div className="pt-4 text-center">
                    <Button variant="ghost" size="sm" className="text-neutral-400 hover:text-neutral-600 cursor-pointer" onClick={handleLogout}>
                        <LogOut className="mr-2 h-4 w-4" /> Cambiar de Usuario
                    </Button>
                </div>
            </div>
        </div>
    )
}
