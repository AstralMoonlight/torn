'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionStore } from '@/lib/store/sessionStore'
import { Button } from '@/components/ui/button'
import { ShieldAlert, Users, Building, LogOut } from 'lucide-react'
import ThemeToggle from '@/components/layout/ThemeToggle'
import { LogoutConfirmModal } from '@/components/layout/LogoutConfirmModal'
import { useHydrated } from '@/lib/hooks/useHydrated'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'

export default function SaaSAdminPage() {
    const router = useRouter()
    const { user, token } = useSessionStore()
    const isMounted = useHydrated()

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

    if (!isMounted || !user?.is_superuser) return null

    return (
        <PageContainer>
                <PageHeader
                    icon={ShieldAlert}
                    title="Panel Superadministrador"
                    description={`Bienvenido, ${user.full_name || user.email}`}
                    actions={<>
                        <ThemeToggle />
                        <Button variant="outline" onClick={() => router.push('/select-tenant')}>
                            Entrar al POS
                        </Button>
                        <LogoutConfirmModal>
                            <Button variant="outline" className="gap-2 text-destructive hover:bg-destructive/10">
                                <LogOut className="h-4 w-4" />
                                Cerrar Sesión
                            </Button>
                        </LogoutConfirmModal>
                    </>}
                />

                {/* Modules Grid */}
                <div data-section="saas-admin.modulos" className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Tenants Module */}
                    <div className="bg-card p-8 rounded-2xl border border-border shadow-sm flex flex-col items-start gap-6 hover:border-primary/50 transition-all duration-300 group">
                        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                            <Building className="h-7 w-7" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-foreground mb-2">Empresas (Tenants)</h2>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                Gestiona las instancias, esquemas provisionados, RUT y límites de usuarios de forma centralizada.
                            </p>
                        </div>
                        <Button className="mt-auto w-full cursor-pointer shadow-sm shadow-primary/20 py-6 text-base" onClick={() => router.push('/saas-admin/tenants')}>
                            Ver Todas las Empresas
                        </Button>
                    </div>

                    {/* Users Module */}
                    <div className="bg-card p-8 rounded-2xl border border-border shadow-sm flex flex-col items-start gap-6 hover:border-muted-foreground/50 transition-all duration-300 group opacity-90">
                        <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground dark:text-muted-foreground">
                            <Users className="h-7 w-7" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-foreground mb-2">Usuarios Globales</h2>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                Administra cuentas SaaS físicas y los permisos transversales para el acceso al panel global.
                            </p>
                        </div>
                        <Button variant="outline" disabled className="mt-auto w-full border-border text-muted-foreground dark:text-muted-foreground py-6 text-base">
                            Próximamente
                        </Button>
                    </div>
                </div>

        </PageContainer>
    )
}
