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

export async function openSession(startAmount: number): Promise<CashSession> {
    const { data } = await api.post<CashSession>('/cash/open', {
        start_amount: startAmount,
    })
    return data
}

export async function getSessionStatus(): Promise<CashSession> {
    const { data } = await api.get<CashSession>('/cash/status')
    return data
}

export async function closeSession(finalCashDeclared: number): Promise<CashSession> {
    const { data } = await api.post<CashSession>('/cash/close', {
        final_cash_declared: finalCashDeclared,
    })
    return data
}
