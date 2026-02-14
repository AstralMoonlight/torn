'use client'

import { useEffect } from 'react'
import Sidebar from './Sidebar'
import { useSessionStore } from '@/lib/store/sessionStore'
import { getSessionStatus } from '@/services/cash'

export default function AppShell({ children }: { children: React.ReactNode }) {
    const setSession = useSessionStore((s) => s.setSession)
    const setStatus = useSessionStore((s) => s.setStatus)

    // Sync cash session with backend on mount
    useEffect(() => {
        getSessionStatus()
            .then((session) => {
                if (session.status === 'OPEN') {
                    setSession(session.id, parseFloat(session.start_amount), session.start_time)
                }
            })
            .catch(() => {
                setStatus('CLOSED')
            })
    }, [setSession, setStatus])

    return (
        <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-900">
                {children}
            </main>
        </div>
    )
}
