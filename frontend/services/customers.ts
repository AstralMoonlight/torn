import api from './api'

export interface Customer {
    id: number
    rut: string
    razon_social: string
    giro: string | null
    direccion: string | null
    comuna: string | null
    ciudad: string | null
    email: string | null
    current_balance: string
    is_active: boolean
}

export interface CustomerCreate {
    rut: string
    razon_social: string
    giro?: string
    direccion?: string
    comuna?: string
    ciudad?: string
    email?: string
}

export interface CustomerUpdate {
    rut?: string
    razon_social?: string
    giro?: string
    direccion?: string
    comuna?: string
    ciudad?: string
    email?: string
}

export async function getCustomers(): Promise<Customer[]> {
    const { data } = await api.get<Customer[]>('/customers/')
    return data
}

export async function getCustomerByRut(rut: string): Promise<Customer> {
    const { data } = await api.get<Customer>(`/customers/${rut}`)
    return data
}

export async function createCustomer(customer: CustomerCreate): Promise<Customer> {
    const { data } = await api.post<Customer>('/customers/', customer)
    return data
}

export async function updateCustomer(rut: string, customer: CustomerUpdate): Promise<Customer> {
    const { data } = await api.put<Customer>(`/customers/${rut}`, customer)
    return data
}

export async function deleteCustomer(rut: string): Promise<void> {
    await api.delete(`/customers/${rut}`)
}

export async function searchCustomers(query: string): Promise<Customer[]> {
    const { data } = await api.get<Customer[]>(`/customers/search?q=${encodeURIComponent(query)}`)
    return data
}
