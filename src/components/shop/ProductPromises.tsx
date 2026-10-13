import type { LucideIcon } from 'lucide-react';
import { Clock, Headset, ReceiptText, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { Product, isMadeToOrder } from './product';

type ProductPromise = { icon: LucideIcon; text: string };

/** A product's own "Warranty" specification, if the admin recorded one. */
function warrantySpec(product: Pick<Product, 'specifications'>): string | null {
    const specs = product.specifications;
    if (!specs) return null;
    const entries = Array.isArray(specs) ? specs : Object.entries(specs).map(([key, value]) => ({ key, value }));
    const value = entries.find((s) => typeof s?.key === 'string' && s.key.trim().toLowerCase() === 'warranty')?.value;
    return value ? String(value).trim() : null;
}

/**
 * What buying this product here comes with. Each line is a rule the site
 * enforces or a policy it publishes; none is decoration:
 *  - shipping: backend/src/services/order.service.js (printer orders ship free)
 *  - dispatch, returns: the shipping and return policies (src/pages/Legal.tsx)
 *  - warranty: the maker's, which the return policy refers claims to
 *  - support hours: the contact page
 */
function productPromises(product: Pick<Product, 'category' | 'specifications'>): ProductPromise[] {
    const printer = product.category === '3d_printer';
    const warranty = warrantySpec(product) ?? (printer ? "Manufacturer's warranty" : null);
    return [
        { icon: Truck, text: printer ? 'Free shipping across India' : '₹199 shipping across India' },
        { icon: Clock, text: isMadeToOrder(product) ? 'Made to order for you' : 'Dispatched in 2–3 business days' },
        ...(warranty ? [{ icon: ShieldCheck, text: warranty }] : []),
        { icon: ReceiptText, text: 'GST invoice' },
        { icon: RotateCcw, text: '7-day returns if damaged or defective' },
        { icon: Headset, text: 'Support Mon–Sat, 10 AM–7 PM' },
    ];
}

export function ProductPromises({ product }: { product: Pick<Product, 'category' | 'specifications'> }) {
    return (
        <ul className="grid grid-cols-1 gap-3 rounded-xl border border-border/50 bg-secondary/10 p-4 text-sm text-muted-foreground sm:grid-cols-2">
            {productPromises(product).map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2">
                    <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    {text}
                </li>
            ))}
        </ul>
    );
}
