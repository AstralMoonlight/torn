'use client'

import { useEffect } from 'react'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import { useSessionStore } from '@/lib/store/sessionStore'
import { getSessionStatus } from '@/services/cash'

export default function AppShell({ children }: { children: React.ReactNode }) {
    const setSession = useSessionStore((s) => s.setSession)
    const setStatus = useSessionStore((s) => s.setStatus)
    const userId = useSessionStore((s) => s.userId)

    // Sync cash session with backend on mount
    useEffect(() => {
        getSessionStatus(userId || undefined)
            .then((session) => {
                if (session.status === 'OPEN') {
                    setSession(session.id, parseFloat(session.start_amount), session.start_time, session.user_id)
                } else {
                    setStatus('CLOSED')
                }
            })
            .catch(() => {
                // If 404 or error, assume closed if we don't have a session
                setStatus('CLOSED')
            })
    }, [setSession, setStatus, userId])

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
