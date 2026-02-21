'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionStore } from '@/lib/store/sessionStore'
import { Button } from '@/components/ui/button'
import { ShieldAlert, Users, Building, LogOut } from 'lucide-react'
import ThemeToggle from '@/components/layout/ThemeToggle'

export default function SaaSAdminPage() {
    const router = useRouter()
    const { user, token, logout } = useSessionStore()
    const [isMounted, setIsMounted] = useState(false)

    useEffect(() => {
        setIsMounted(true)
    }, [])

    useEffect(() => {
        if (!isMounted) return
        if (!token) {
            router.push('/login')
            return
        }
        if (!user?.is_superuser) {
            router.push('/access-denied')
        }
    }, [token, user, isMounted, router])

    const handleLogout = () => {
        logout()
        router.push('/login')
    }

    if (!isMounted || !user?.is_superuser) return null

    return (
        <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6 md:p-12">
            <div className="max-w-5xl mx-auto space-y-8">

                {/* Header Container */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm w-full">
                    <div className="flex items-center gap-4">
                        <div className="h-14 w-14 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/30">
                            <ShieldAlert className="h-7 w-7" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Panel Superadministrador</h1>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400">Bienvenido, {user.full_name || user.name || user.email}</p>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3">
                        <ThemeToggle />
                        <Button variant="outline" className="border-neutral-200 text-neutral-700 bg-white dark:bg-neutral-900 dark:border-neutral-800 dark:text-neutral-300 hover:bg-neutral-50 cursor-pointer w-full sm:w-auto px-6" onClick={() => router.push('/select-tenant')}>
                            Entrar al POS
                        </Button>
                        <Button variant="outline" onClick={handleLogout} className="w-full sm:w-auto gap-2 shrink-0 border-neutral-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-neutral-800 dark:text-red-400 dark:hover:bg-red-900/20 cursor-pointer px-6">
                            <LogOut className="h-4 w-4" />
                            Cerrar Sesión
                        </Button>
                    </div>
                </div>

                {/* Modules Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Tenants Module */}
                    <div className="bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex flex-col items-start gap-6 hover:border-blue-500/50 transition-all duration-300 group">
                        <div className="h-14 w-14 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                            <Building className="h-7 w-7" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-neutral-900 dark:text-white mb-2">Empresas (Tenants)</h2>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                                Gestiona las instancias, esquemas provisionados, RUT y límites de usuarios de forma centralizada.
                            </p>
                        </div>
                        <Button className="mt-auto w-full bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-sm shadow-blue-600/20 py-6 text-base" onClick={() => router.push('/saas-admin/tenants')}>
                            Ver Todas las Empresas
                        </Button>
                    </div>

                    {/* Users Module */}
                    <div className="bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex flex-col items-start gap-6 hover:border-neutral-500/50 transition-all duration-300 group opacity-90">
                        <div className="h-14 w-14 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 dark:text-neutral-500">
                            <Users className="h-7 w-7" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-neutral-900 dark:text-white mb-2">Usuarios Globales</h2>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                                Administra cuentas SaaS físicas y los permisos transversales para el acceso al panel global.
                            </p>
                        </div>
                        <Button variant="outline" disabled className="mt-auto w-full border-neutral-200 text-neutral-400 dark:border-neutral-800 dark:text-neutral-600 py-6 text-base">
                            Próximamente
                        </Button>
                    </div>
                </div>

            </div>
        </div>
    )
}
