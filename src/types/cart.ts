export interface CartItem {
    id: string;
    product_id: string;
    quantity: number;
    product: {
        id: string;
        name: string;
        price: number;
        image_url?: string;
        category: string;
        stock: number;
        // Admin-entered JSON; checkout reads its allow_cod_override flag.
        specifications?: Record<string, string> | Array<{ key: string; value: string }>;
    };
}

export interface CartContextType {
    items: CartItem[];
    loading: boolean;
    addToCart: (productId: string, quantity?: number) => Promise<void>;
    removeFromCart: (productId: string) => Promise<void>;
    updateQuantity: (productId: string, quantity: number) => Promise<void>;
    clearCart: () => Promise<void>;
    total: number;
    itemCount: number;
    isAuthenticated: boolean;
    loadCart: (silent?: boolean) => Promise<void>;
}