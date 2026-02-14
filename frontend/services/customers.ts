import api from './api'
import type { CustomerOut } from './sales'

export interface CustomerCreate {
    rut: string
    razon_social: string
    giro?: string
    direccion?: string
    comuna?: string
    ciudad?: string
    email?: string
}

export async function getCustomerByRut(rut: string): Promise<CustomerOut> {
    const { data } = await api.get<CustomerOut>(`/customers/${rut}`)
    return data
}

export async function createCustomer(customer: CustomerCreate): Promise<CustomerOut> {
    const { data } = await api.post<CustomerOut>('/customers/', customer)
    return data
}
