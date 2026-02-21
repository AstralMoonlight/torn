import api from './api'

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

export async function closeSession(finalCashDeclared: number): Promise<CashSession> {
    const { data } = await api.post<CashSession>('/cash/close', {
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
