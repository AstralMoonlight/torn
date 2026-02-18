'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionStore } from '@/lib/store/sessionStore'
import { login } from '@/services/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, Lock, Store } from 'lucide-react'

export default function LoginPage() {
    const router = useRouter()
    const { login: setAuth } = useSessionStore()

    const [rut, setRut] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!rut || !password) {
            toast.error('Ingresa RUT y contraseña')
            return
        }

        setLoading(true)
        try {
            const data = await login(rut, password)
            setAuth(data.access_token, data.user)
            toast.success(`Bienvenido, ${data.user.name}`)
            router.push('/pos')
        } catch (err: any) {
            console.error(err)
            toast.error('Credenciales incorrectas')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
            <div className="w-full max-w-sm space-y-8 bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800">
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 text-white mb-2 shadow-lg shadow-blue-600/20">
                        <Store className="w-6 h-6" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        Torn POS
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Inicia sesión para acceder al sistema
                    </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="rut">RUT o Email</Label>
                            <Input
                                id="rut"
                                placeholder="12.345.678-9"
                                value={rut}
                                onChange={(e) => setRut(e.target.value)}
                                disabled={loading}
                                className="h-10"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Contraseña</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={loading}
                                    className="pl-9 h-10"
                                />
                            </div>
                        </div>
                    </div>

                    <Button
                        type="submit"
                        className="w-full h-10 font-medium"
                        disabled={loading}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Ingresar
                    </Button>
                </form>

                <div className="text-center text-xs text-slate-400">
                    &copy; {new Date().getFullYear()} Torn. Todos los derechos reservados.
                </div>
            </div>
        </div>
    )
}
