import api from './api'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PriceItem {
    product_id: number
    fixed_price: string | number
}

export interface PriceListRead {
    id: number
    name: string
    description: string | null
}

export interface PriceListDetail extends PriceListRead {
    items: PriceItem[]
}

export interface PriceListCreate {
    name: string
    description?: string
}

export interface PriceListUpdate {
    name?: string
    description?: string
}

export interface ResolvedPrice {
    product_id: number
    customer_id: number | null
    price_list_id: number | null
    resolved_price: string
    source: 'price_list' | 'base_price'
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getPriceLists(): Promise<PriceListRead[]> {
    const { data } = await api.get<PriceListRead[]>('/price-lists/')
    return data
}

export async function getPriceList(id: number): Promise<PriceListDetail> {
    const { data } = await api.get<PriceListDetail>(`/price-lists/${id}`)
    return data
}

export async function createPriceList(payload: PriceListCreate): Promise<PriceListRead> {
    const { data } = await api.post<PriceListRead>('/price-lists/', payload)
    return data
}

export async function updatePriceList(id: number, payload: PriceListUpdate): Promise<PriceListRead> {
    const { data } = await api.put<PriceListRead>(`/price-lists/${id}`, payload)
    return data
}

export async function deletePriceList(id: number): Promise<void> {
    await api.delete(`/price-lists/${id}`)
}

// ── Assignments ──────────────────────────────────────────────────────────────

export async function assignProducts(id: number, items: PriceItem[]): Promise<PriceListDetail> {
    const { data } = await api.put<PriceListDetail>(`/price-lists/${id}/products`, { items })
    return data
}

export async function assignCustomers(id: number, customer_ids: number[]): Promise<{ detail: string }> {
    const { data } = await api.put<{ detail: string }>(`/price-lists/${id}/customers`, { customer_ids })
    return data
}

// ── POS Price Resolution ──────────────────────────────────────────────────────

export async function resolvePrice(product_id: number, customer_id?: number): Promise<ResolvedPrice> {
    const params = customer_id ? { customer_id } : {}
    const { data } = await api.get<ResolvedPrice>(`/price-lists/resolve-price/${product_id}`, { params })
    return data
}
