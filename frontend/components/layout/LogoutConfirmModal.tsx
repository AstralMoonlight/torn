'use client'

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { LogOut } from 'lucide-react'
import { useSessionStore } from '@/lib/store/sessionStore'

interface LogoutConfirmModalProps {
    children: React.ReactNode
}

export function LogoutConfirmModal({ children }: LogoutConfirmModalProps) {
    const handleConfirm = (e: React.MouseEvent) => {
        // Ejecuta el cierre de sesión y redirecciona al login
        useSessionStore.getState().logout()
        window.location.href = '/login'
    }

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                {children}
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
                <AlertDialogHeader className="gap-2">
                    <AlertDialogTitle className="flex items-center gap-2 text-xl text-neutral-900 dark:text-neutral-100">
                        <LogOut className="h-5 w-5 text-red-500" />
                        ¿Seguro que deseas cerrar sesión?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-neutral-500 dark:text-neutral-400">
                        Tu sesión actual se cerrará y tendrás que volver a ingresar tus credenciales para acceder al sistema.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-6 gap-3 sm:gap-2">
                    <AlertDialogCancel className="mt-0 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:text-neutral-300">
                        Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleConfirm}
                        className="bg-red-600 hover:bg-red-700 text-white cursor-pointer"
                    >
                        Cerrar Sesión
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
