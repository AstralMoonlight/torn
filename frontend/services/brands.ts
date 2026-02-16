import api from './api'

export interface Brand {
    id: number
    name: string
}

export interface BrandCreate {
    name: string
}

export async function getBrands(): Promise<Brand[]> {
    const { data } = await api.get<Brand[]>('/brands/')
    return data
}

export async function createBrand(brand: BrandCreate): Promise<Brand> {
    const { data } = await api.post<Brand>('/brands/', brand)
    return data
}

export async function updateBrand(id: number, brand: BrandCreate): Promise<Brand> {
    const { data } = await api.put<Brand>(`/brands/${id}`, brand)
    return data
}

export async function deleteBrand(id: number): Promise<void> {
    await api.delete(`/brands/${id}`)
}
