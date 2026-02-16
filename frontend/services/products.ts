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
    brand_id: number | null
    brand?: { id: number; name: string } | null
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

export interface ProductCreatePayload {
    codigo_interno: string
    nombre: string
    descripcion?: string
    precio_neto: number
    unidad_medida?: string
    codigo_barras?: string
    controla_stock?: boolean
    stock_actual?: number
    stock_minimo?: number
    parent_id?: number
    brand_id?: number
}

// Update a product
export async function updateProduct(id: number, data: Partial<Product>): Promise<Product> {
    const response = await api.put<Product>(`/products/${id}`, data)
    return response.data
}

// Soft delete a product
export async function deleteProduct(id: number): Promise<void> {
    await api.delete(`/products/${id}`)
}

export async function createProduct(payload: ProductCreatePayload): Promise<Product> {
    const { data } = await api.post<Product>('/products/', payload)
    return data
}
