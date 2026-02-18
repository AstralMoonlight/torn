'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import { useSessionStore } from '@/lib/store/sessionStore'
import { getSessionStatus } from '@/services/cash'

export default function AppShell({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()

    const setSession = useSessionStore((s) => s.setSession)
    const setStatus = useSessionStore((s) => s.setStatus)
    const userId = useSessionStore((s) => s.userId)
    const token = useSessionStore((s) => s.token)

    const [isMounted, setIsMounted] = useState(false)

    useEffect(() => {
        setIsMounted(true)
    }, [])

    // Auth Protection
    useEffect(() => {
        if (!isMounted) return

        if (!token && pathname !== '/login') {
            router.push('/login')
        }

        if (token && pathname === '/login') {
            router.push('/pos')
        }
    }, [token, pathname, router, isMounted])

    // Sync cash session with backend on mount
    useEffect(() => {
        if (!token || !userId) return

        getSessionStatus(userId)
            .then((session) => {
                if (session.status === 'OPEN') {
                    setSession(session.id, parseFloat(session.start_amount), session.start_time, session.user_id)
                } else {
                    setStatus('CLOSED')
                }
            })
            .catch(() => {
                setStatus('CLOSED')
            })
    }, [setSession, setStatus, userId, token])

    if (!isMounted) return null // Prevent hydration mismatch

    if (pathname === '/login') {
        return <main className="min-h-screen bg-slate-50 dark:bg-slate-950">{children}</main>
    }

    if (!token) return null // Wait for redirect

    return (
        <div className="flex h-[100dvh] overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900 pb-16 md:pb-0">
                {children}
            </main>
            <MobileNav />
        </div>
    )
}
