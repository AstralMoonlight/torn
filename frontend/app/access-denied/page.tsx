'use client'

import { ShieldAlert, ArrowLeft, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function AccessDenied() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
            <div className="w-full max-w-md space-y-8 bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 text-center">
                <div className="space-y-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 mb-2">
                        <ShieldAlert className="w-10 h-10" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                        Acceso Denegado
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        No tienes los permisos necesarios para acceder a esta sección.
                        Si crees que esto es un error, contacta al administrador del sistema.
                    </p>
                </div>

                <div className="space-y-4 pt-4">
                    <Button asChild className="w-full h-12 text-base font-medium" variant="default">
                        <Link href="/pos" className="flex items-center justify-center gap-2">
                            <Store className="w-5 h-5" />
                            Ir al Terminal POS
                        </Link>
                    </Button>

                    <Button asChild className="w-full h-12 text-base font-medium" variant="outline">
                        <Link href="/login" className="flex items-center justify-center gap-2">
                            <ArrowLeft className="w-5 h-5" />
                            Volver al Inicio
                        </Link>
                    </Button>
                </div>

                <div className="text-center text-xs text-slate-400 pt-4 border-t border-slate-100 dark:border-slate-800">
                    &copy; {new Date().getFullYear()} Torn. Sistema de Gestión y Seguridad.
                </div>
            </div>
        </div>
    )
}
