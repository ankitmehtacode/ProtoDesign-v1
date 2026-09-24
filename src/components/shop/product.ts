export interface ProductImage {
    id: string;
    image_url?: string;
    image_data?: string;
    display_order: number;
}

export interface Product {
    id: string;
    slug?: string;
    name: string;
    description: string;
    short_description?: string;
    price: number;
    stock: number;
    likes_count: number;
    average_rating?: number;
    review_count?: number;
    image_url: string | null;
    category: string;
    created_at?: string;
    product_images?: ProductImage[];
    images?: ProductImage[];
    is_archived?: boolean;
}

export const CATEGORY_LABELS: Record<string, string> = {
    '3d_printer': 'Printer',
    filament: 'Filament',
    resin: 'Resin',
    '3dprintables': 'Printable',
    accessory: 'Accessory',
    spare_part: 'Spare part',
};
