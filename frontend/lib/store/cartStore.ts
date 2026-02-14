import { create } from 'zustand'

export interface Product {
    id: number
    name: string
    price: number
}

interface CartItem extends Product {
    quantity: number
}

interface CartState {
    items: CartItem[]
    addItem: (product: Product) => void
    removeItem: (productId: number) => void
    clearCart: () => void
    total: () => number
}

export const useCartStore = create<CartState>((set, get) => ({
    items: [],
    addItem: (product) =>
        set((state) => {
            const existingItem = state.items.find((item) => item.id === product.id)
            if (existingItem) {
                return {
                    items: state.items.map((item) =>
                        item.id === product.id
                            ? { ...item, quantity: item.quantity + 1 }
                            : item
                    ),
                }
            }
            return { items: [...state.items, { ...product, quantity: 1 }] }
        }),
    removeItem: (productId) =>
        set((state) => ({
            items: state.items.filter((item) => item.id !== productId),
        })),
    clearCart: () => set({ items: [] }),
    total: () => {
        const { items } = get()
        return items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    },
}))
