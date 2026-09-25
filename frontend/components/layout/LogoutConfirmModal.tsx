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
    const handleConfirm = () => {
        // Ejecuta el cierre de sesión y redirecciona al login
        useSessionStore.getState().logout()
        window.location.href = '/login'
    }

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                {children}
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-border">
                <AlertDialogHeader className="gap-2">
                    <AlertDialogTitle className="flex items-center gap-2 text-xl text-foreground">
                        <LogOut className="h-5 w-5 text-destructive" />
                        ¿Seguro que deseas cerrar sesión?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-muted-foreground">
                        Tu sesión actual se cerrará y tendrás que volver a ingresar tus credenciales para acceder al sistema.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-6 gap-3 sm:gap-2">
                    <AlertDialogCancel className="mt-0 border-border hover:bg-accent">
                        Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleConfirm}
                        className="bg-destructive hover:bg-destructive/90 text-destructive-foreground cursor-pointer"
                    >
                        Cerrar sesión
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
