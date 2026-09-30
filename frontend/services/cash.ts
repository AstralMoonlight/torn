import api from './api'
import { useSessionStore } from '@/lib/store/sessionStore'

export interface CashSession {
    id: number
    user_id: number
    start_time: string
    end_time: string | null
    start_amount: string
    final_cash_system: string
    final_cash_declared: string
    difference: string
    status: 'OPEN' | 'CLOSED'
}

export async function openSession(startAmount: number, userId: number, forceClosePrevious: boolean = false): Promise<CashSession> {
    const { data } = await api.post<CashSession>('/cash/open', {
        start_amount: startAmount,
        user_id: userId,
        force_close_previous: forceClosePrevious,
    })
    return data
}

export async function getSessionStatus(userId?: number): Promise<CashSession> {
    const { data } = await api.get<CashSession>('/cash/status', {
        params: { user_id: userId }
    })
    return data
}

/** Trae el turno del servidor al store. El estado guardado en el navegador puede
 * ser de otra empresa o de antes de que alguien abriera la caja en otra pestaña. */
export async function sincronizarCaja(): Promise<void> {
    const { setSession, setStatus } = useSessionStore.getState()
    try {
        const s = await getSessionStatus()
        if (s.status === 'OPEN') setSession(s.id, parseFloat(s.start_amount), s.start_time, s.user_id)
        else setStatus('CLOSED')
    } catch {
        setStatus('CLOSED')
    }
}

export async function closeSession(finalCashDeclared: number): Promise<CashSession> {
    const { data } = await api.post<CashSession>('/cash/close', {
        final_cash_declared: finalCashDeclared,
    })
    return data
}

/** El administrador cierra el turno de otro usuario (uno olvidado, por ejemplo). */
export async function closeOtherSession(sessionId: number, finalCashDeclared: number): Promise<CashSession> {
    const { data } = await api.post<CashSession>(`/cash/sessions/${sessionId}/close`, {
        final_cash_declared: finalCashDeclared,
    })
    return data
}

export interface CashSessionWithUser extends CashSession {
    user: {
        id: number
        name: string
        full_name: string | null
        email: string
        rut: string | null
    }
}

export async function getAllSessions(): Promise<CashSessionWithUser[]> {
    const { data } = await api.get<CashSessionWithUser[]>('/cash/sessions')
    return data
}
