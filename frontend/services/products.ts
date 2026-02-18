import api from './api'

export interface Product {
    id: number
    codigo_interno: string
    nombre: string
    descripcion: string | null
    precio_neto: string // Decimal comes as string
    costo_unitario: string
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
    tax_id: number | null
    tax?: { id: number; name: string; rate: number } | null
    variants: Product[]
    full_name: string
    precio_bruto: string
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
    codigo_interno?: string
    nombre: string
    descripcion?: string
    precio_neto: number
    costo_unitario?: number
    unidad_medida?: string
    codigo_barras?: string
    controla_stock?: boolean
    stock_actual?: number
    stock_minimo?: number
    parent_id?: number
    brand_id?: number
    tax_id?: number
}

export interface VariantPayload {
    nombre: string
    codigo_interno?: string
    codigo_barras?: string
    precio_neto: number
    descripcion?: string
    stock_actual?: number
}

export interface ProductWithVariantsPayload {
    nombre: string
    codigo_interno?: string
    codigo_barras?: string
    descripcion?: string
    precio_neto?: number
    unidad_medida?: string
    controla_stock?: boolean
    stock_minimo?: number
    brand_id?: number
    tax_id?: number
    variants: VariantPayload[]
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

export async function createProductWithVariants(payload: ProductWithVariantsPayload): Promise<Product> {
    const { data } = await api.post<Product>('/products/with-variants', payload)
    return data
}
