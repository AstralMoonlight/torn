'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionStore } from '@/lib/store/sessionStore'
import { login } from '@/services/auth'
import { getApiErrorMessage } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, Lock, Store } from 'lucide-react'

export default function LoginPage() {
    const router = useRouter()
    const { login: setAuth } = useSessionStore()

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!email || !password) {
            toast.error('Ingresa email y contraseña')
            return
        }

        setLoading(true)
        try {
            const data = await login(email, password)
            setAuth(data.access_token, data.user, data.available_tenants)

            toast.success(`Bienvenido, ${data.user.full_name || data.user.email}`)

            // Si es superadmin, siempre al panel de administración
            if (data.user.is_superuser) {
                router.push('/saas-admin')
            } else {
                const activeTenants = data.available_tenants.filter(t => t.is_active)
                if (data.available_tenants.length === 1 && activeTenants.length === 1) {
                    router.push('/pos')
                } else {
                    router.push('/select-tenant')
                }
            }

        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Credenciales incorrectas'))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="w-full max-w-sm space-y-8 bg-white  p-8 rounded-2xl shadow-xl border border-border">
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-white mb-2 shadow-lg shadow-primary/20">
                        <Store className="w-6 h-6" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">
                        Torn POS
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Inicia sesión para acceder al sistema
                    </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email de Acceso</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="nombre@empresa.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={loading}
                                className="h-10"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Contraseña</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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

                <div className="text-center text-xs text-muted-foreground">
                    &copy; {new Date().getFullYear()} Torn. Todos los derechos reservados.
                </div>
            </div>
        </div>
    )
}
