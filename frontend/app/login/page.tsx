'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bricolage_Grotesque } from 'next/font/google'
import { useSessionStore } from '@/lib/store/sessionStore'
import { login } from '@/services/auth'
import { getApiErrorMessage } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertaError } from '@/components/ui/alerta-error'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

const marca = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '800'] })

// Colores de la marca: el login no usa el color que cada empresa elige en Configuración.
const INDIGO = '#3B35E0'
const TINTA = '#16173A'

const ITEMS_BOLETA = [
    ['Pan amasado x2', '$2.400'],
    ['Café en grano 250 g', '$8.990'],
    ['Queso mantecoso', '$4.650'],
]

function Boleta() {
    return (
        <div aria-hidden className="relative w-80 overflow-hidden pt-3">
            {/* Ranura de la impresora */}
            <div className="absolute inset-x-0 top-0 z-10 h-3 rounded-full" style={{ background: TINTA }} />
            <div className="boleta-imprime">
                <div className="bg-white px-6 pt-7 pb-5 font-mono text-[13px] leading-6" style={{ color: TINTA }}>
                    <p className="text-center font-semibold">Boleta electrónica</p>
                    <p className="mb-3 text-center opacity-60">N° 1.204</p>
                    {ITEMS_BOLETA.map(([nombre, precio]) => (
                        <div key={nombre} className="flex justify-between">
                            <span>{nombre}</span>
                            <span>{precio}</span>
                        </div>
                    ))}
                    <div className="my-2 border-t border-dashed" style={{ borderColor: TINTA }} />
                    <div className="flex justify-between text-base font-bold">
                        <span>Total</span>
                        <span>$16.040</span>
                    </div>
                    {/* Timbre electrónico */}
                    <div
                        className="mx-auto mt-5 h-12 w-56"
                        style={{
                            background: `repeating-linear-gradient(90deg, ${TINTA} 0 2px, transparent 2px 3px, ${TINTA} 3px 4px, transparent 4px 7px, ${TINTA} 7px 10px, transparent 10px 11px)`,
                        }}
                    />
                    <p className="mt-2 text-center opacity-60">Timbre electrónico SII</p>
                </div>
                {/* Borde cortado */}
                <div
                    className="h-3"
                    style={{
                        background: 'linear-gradient(135deg, #fff 6px, transparent 0) 0 0 / 12px 12px repeat-x, linear-gradient(225deg, #fff 6px, transparent 0) 0 0 / 12px 12px repeat-x',
                    }}
                />
            </div>
        </div>
    )
}

export default function LoginPage() {
    const router = useRouter()
    const { login: setAuth } = useSessionStore()

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [verPassword, setVerPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        if (!email || !password) {
            setError('Escribe tu correo y tu contraseña.')
            return
        }

        setLoading(true)
        try {
            const data = await login(email, password)
            setAuth(data.access_token, data.user, data.available_tenants)

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
            setError(getApiErrorMessage(err, 'El correo o la contraseña no coinciden.'))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen grid grid-rows-[auto_1fr] lg:grid-rows-1 lg:grid-cols-2 bg-background">
            <section
                data-section="login.marca"
                className="relative flex flex-col justify-between gap-8 overflow-hidden px-6 py-8 text-white lg:px-14 lg:py-12"
                style={{ background: INDIGO }}
            >
                <p className={`${marca.className} text-3xl font-extrabold tracking-tight lg:text-4xl`}>
                    Factureando
                </p>

                <div className="hidden justify-center lg:flex">
                    <Boleta />
                </div>

                <p className={`${marca.className} hidden max-w-sm text-2xl font-semibold leading-snug lg:block`}>
                    Vendes, cobras y la boleta sale sola.
                </p>
            </section>

            <main className="flex items-center justify-center px-6 py-10 lg:px-14">
                <div data-section="login.formulario" className="w-full max-w-sm space-y-8">
                    <div className="space-y-2">
                        <h1 className={`${marca.className} text-3xl font-extrabold tracking-tight text-foreground`}>
                            Hola de nuevo
                        </h1>
                        <p className="text-base text-muted-foreground">
                            Entra con tu correo para empezar a vender.
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-5">
                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-base">Correo</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="nombre@empresa.cl"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    disabled={loading}
                                    className="h-12 rounded-xl text-base md:text-base"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password" className="text-base">Contraseña</Label>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={verPassword ? 'text' : 'password'}
                                        autoComplete="current-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        disabled={loading}
                                        className="h-12 rounded-xl pr-12 text-base md:text-base"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setVerPassword(v => !v)}
                                        aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                        aria-pressed={verPassword}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        {verPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <AlertaError mensaje={error} />

                        <Button
                            type="submit"
                            className="h-12 w-full rounded-xl text-base font-semibold text-white hover:opacity-90"
                            style={{ background: INDIGO }}
                            disabled={loading}
                        >
                            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
                            Ingresar
                        </Button>
                    </form>

                    <p className="text-sm text-muted-foreground">
                        &copy; {new Date().getFullYear()} Factureando
                    </p>
                </div>
            </main>
        </div>
    )
}
