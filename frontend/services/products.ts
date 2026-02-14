import api from './api'

export interface Product {
    id: number
    codigo_interno: string
    nombre: string
    descripcion: string | null
    precio_neto: string // Decimal comes as string
    unidad_medida: string
    codigo_barras: string | null
    controla_stock: boolean
    stock_actual: string
    stock_minimo: string
    is_active: boolean
    created_at: string
    updated_at: string | null
    parent_id: number | null
    variants: Product[]
}

export async function getProducts(): Promise<Product[]> {
    const { data } = await api.get<Product[]>('/products/')
    return data
}

export async function getProductBySku(sku: string): Promise<Product> {
    const { data } = await api.get<Product>(`/products/${sku}`)
    return data
}
