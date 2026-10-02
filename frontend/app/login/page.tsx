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
import { formatCLP } from '@/lib/format'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

const marca = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '800'] })

const TINTA = '#16173A'

// El login no sabe quién entra, así que no usa el color que cada usuario elige en
// Configuración: sortea uno de estos (y arma un documento) en cada carga.
const VARIANTES = [
    { fondo: '#3B35E0', texto: '#FFFFFF', impresora: '#F1F2FA' },
    { fondo: '#C6F432', texto: TINTA, impresora: TINTA },
    { fondo: '#FF5FA2', texto: TINTA, impresora: TINTA },
]

type Documento = {
    emisor: string
    titulo: string
    numero: string
    receptor?: string
    lineas: [string, string][]
    subtotales?: [string, string][]
    total: string
}

type Item = [string, number]

// Negocios de rubros distintos, para no parecer de una sola empresa. Cada documento
// sale de uno y lleva dos productos normales y uno gracioso de ese mismo rubro.
const NEGOCIOS: { nombre: string; rut: string; items: Item[]; graciosos: Item[] }[] = [
    {
        nombre: 'Almacén Doña Rosa', rut: '76.123.456-0',
        items: [['Pan amasado x2', 2400], ['Leche entera 1 L', 1190], ['Arroz grado 1 kg', 1590], ['Aceite 1 L', 2690], ['Huevos x12', 3990]],
        graciosos: [['Fiado hasta el viernes', 5000], ['Copucha del barrio', 0], ['Bolsa para las bolsas', 100], ['Vuelto en dulces', 50], ['Marraqueta con conversa', 350]],
    },
    {
        nombre: 'Ferretería El Clavo Feliz', rut: '77.845.210-3',
        items: [['Martillo carpintero', 8990], ['Tornillos x50', 1890], ['Silicona transparente', 3490], ['Huincha de medir 5 m', 4290], ['Cinta aislante', 990]],
        graciosos: [['Tornillo que sobra', 50], ['Manual que nadie lee', 0], ['Llave que no es de nada', 1200], ['Clavo pal cuadro chueco', 150], ['Silicona pa todo', 2990]],
    },
    {
        nombre: 'Peluquería Tijeras Locas', rut: '76.550.319-1',
        items: [['Corte de pelo', 7000], ['Lavado y secado', 5000], ['Tintura', 18000], ['Corte niño', 5500], ['Barba perfilada', 4000]],
        graciosos: [['Solo las puntitas', 7000], ['Copucha incluida', 0], ['Flequillo arrepentido', 3500], ['Cara de quedó lindo', 0], ['Café mientras seca', 1000]],
    },
    {
        nombre: 'Panadería La Hallulla', rut: '78.012.664-7',
        items: [['Marraqueta 1 kg', 2290], ['Hallulla 1 kg', 2290], ['Kuchen de nuez', 6990], ['Empanada de pino', 2800], ['Berlín', 900]],
        graciosos: [['Pan pa la once eterna', 2290], ['Miga para las palomas', 0], ['Calugas para la abuela', 1500], ['Pan comido en el camino', 1150], ['Berlín sin manjar', 900]],
    },
    {
        nombre: 'Librería La Goma', rut: '76.345.678-1',
        items: [['Cuaderno universitario', 1990], ['Lápiz pasta azul', 350], ['Corrector', 1290], ['Block de dibujo', 1890], ['Pegamento en barra', 990]],
        graciosos: [['Goma que no borra', 300], ['Lápiz que se roban', 350], ['Tarea de último minuto', 2990], ['Cartulina pa mañana', 590], ['Regla que no es recta', 490]],
    },
    {
        nombre: 'Veterinaria Patitas', rut: '77.112.233-7',
        items: [['Alimento perro 3 kg', 12990], ['Consulta', 15000], ['Antipulgas', 9990], ['Arena gato 5 kg', 4990], ['Collar ajustable', 3990]],
        graciosos: [['Juguete que ignorará', 3990], ['Cama que no usará', 14990], ['Snack por portarse bien', 990], ['Caja de cartón favorita', 0], ['Disculpas al cartero', 0]],
    },
    {
        nombre: 'Taller El Pistón', rut: '76.998.120-9',
        items: [['Cambio de aceite', 25000], ['Pastillas de freno', 32000], ['Alineación', 15000], ['Ampolleta foco', 3990], ['Lavado de auto', 8000]],
        graciosos: [['Revisar ese ruidito', 9990], ['Ruidito que se fue solo', 0], ['Aromatizante pino', 1490], ['Apagar la luz del check', 4990], ['Paciencia para el taco', 990]],
    },
    {
        nombre: 'Bazar El Cachureo', rut: '77.501.402-4',
        items: [['Cargador USB-C', 4990], ['Pilas AA x4', 2490], ['Ampolleta LED 9 W', 1290], ['Alargador 3 tomas', 3990], ['Audífonos', 5990]],
        graciosos: [['Cargador que sí carga', 6990], ['Control remoto perdido', 3490], ['Calcetín sin su par', 500], ['Tupper con su tapa', 4990], ['Paraguas pa la sequía', 5990]],
    },
]

const sortear = <T,>(lista: T[]) => lista[Math.floor(Math.random() * lista.length)]
// ponytail: sort aleatorio sesgado, da igual para un adorno
const barajar = <T,>(lista: T[]) => [...lista].sort(() => Math.random() - 0.5)
const folio = () => `N° ${(100 + Math.floor(Math.random() * 3000)).toLocaleString('es-CL')}`

function armarDocumento(): Documento {
    const [negocio, cliente] = barajar(NEGOCIOS)
    const items = barajar([sortear(negocio.graciosos), ...barajar(negocio.items).slice(0, 2)])
    const lineas = items.map(([n, p]): [string, string] => [n, formatCLP(p)])
    const suma = items.reduce((t, [, p]) => t + p, 0)
    const emisor = `${negocio.nombre} - ${negocio.rut}`
    if (Math.random() < 0.5) {
        return { emisor, titulo: 'Boleta electrónica', numero: folio(), lineas, total: formatCLP(suma) }
    }
    // En la factura los precios son netos.
    const iva = Math.round(suma * 0.19)
    return {
        emisor,
        titulo: 'Factura electrónica',
        numero: folio(),
        receptor: `Cliente: ${cliente.nombre} - ${cliente.rut}`,
        lineas,
        subtotales: [['Neto', formatCLP(suma)], ['IVA 19%', formatCLP(iva)]],
        total: formatCLP(suma + iva),
    }
}

function Fila({ izq, der }: { izq: string; der: string }) {
    return (
        <div className="flex justify-between gap-3">
            <span>{izq}</span>
            <span>{der}</span>
        </div>
    )
}

// Impresora térmica de 80 mm con el documento saliendo por la ranura.
function Impresion({ doc, variante }: { doc: Documento; variante: (typeof VARIANTES)[number] }) {
    return (
        <div aria-hidden className="flex flex-col items-center">
            <div className="w-72 overflow-hidden">
                <div className="boleta-imprime">
                    {/* Borde cortado */}
                    <div
                        className="h-3"
                        style={{
                            background: 'linear-gradient(45deg, #fff 6px, transparent 0) 0 0 / 12px 12px repeat-x, linear-gradient(-45deg, #fff 6px, transparent 0) 0 0 / 12px 12px repeat-x',
                        }}
                    />
                    <div className="bg-white px-6 pt-4 pb-6 font-mono text-[13px] leading-6" style={{ color: TINTA }}>
                        <p className="mb-2 text-center text-[11px] leading-5">{doc.emisor}</p>
                        <p className="text-center font-semibold">{doc.titulo}</p>
                        <p className="text-center opacity-60">{doc.numero}</p>
                        {doc.receptor && <p className="mt-1 text-center text-[11px] leading-5 opacity-60">{doc.receptor}</p>}
                        <div className="mt-3">
                            {doc.lineas.map(([n, p]) => <Fila key={n} izq={n} der={p} />)}
                        </div>
                        <div className="my-2 border-t border-dashed" style={{ borderColor: TINTA }} />
                        {doc.subtotales?.map(([n, p]) => <Fila key={n} izq={n} der={p} />)}
                        <div className="flex justify-between text-base font-bold">
                            <span>Total</span>
                            <span>{doc.total}</span>
                        </div>
                        {/* Timbre electrónico */}
                        <div
                            className="mx-auto mt-4 h-12 w-52"
                            style={{
                                background: `repeating-linear-gradient(90deg, ${TINTA} 0 2px, transparent 2px 3px, ${TINTA} 3px 4px, transparent 4px 7px, ${TINTA} 7px 10px, transparent 10px 11px)`,
                            }}
                        />
                        <p className="mt-1 text-center text-[11px] opacity-60">Timbre electrónico SII</p>
                        {/* Mismo pie que el documento impreso (LEYENDA_PIE en dte_impreso.py) */}
                        <p className="mt-3 text-center text-[11px]">Factureando.cl: Hazla simple!</p>
                    </div>
                </div>
            </div>
            <div
                className="relative h-24 w-[21rem] rounded-[1.75rem] shadow-[0_24px_48px_-16px_rgba(10,11,30,0.55)]"
                style={{ background: variante.impresora }}
            >
                {/* Ranura */}
                <div className="absolute left-1/2 top-0 h-3 w-[19.5rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0A0B1E]" />
                {/* Luz de encendido y botón de avance de papel */}
                <div className="absolute bottom-6 left-7 h-2 w-2 rounded-full bg-[#4ADE80]" />
                <div className="absolute bottom-5 right-7 h-4 w-12 rounded-full" style={{ background: variante.fondo }} />
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
    const [variante] = useState(() => sortear(VARIANTES))
    const [documento] = useState(armarDocumento)

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
                className="relative flex flex-col justify-between gap-2 overflow-hidden px-6 py-8 lg:gap-8 lg:px-14 lg:py-12"
                style={{ background: variante.fondo, color: variante.texto }}
            >
                <p className={`${marca.className} text-3xl font-extrabold tracking-tight lg:text-4xl`}>
                    Factureando
                </p>

                <div className="hidden justify-center lg:flex">
                    <Impresion doc={documento} variante={variante} />
                </div>

                <p className={`${marca.className} text-right text-2xl font-extrabold leading-none tracking-tight lg:text-7xl`}>
                    ¡Hazla simple!
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
                            className="h-12 w-full rounded-xl text-base font-semibold hover:opacity-90"
                            style={{ background: variante.fondo, color: variante.texto }}
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
