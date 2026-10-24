import { Gift } from 'lucide-react';

interface Gifted {
    festival?: { gift?: { label: string; quantity: number } } | null;
}

/**
 * "Free 1 kg PLA filament roll, while stocks last" under a sale product's
 * price. The server adds the gift to the order at checkout (order.service.js)
 * while the gift product has stock; without it the order still goes through
 * and the shop is alerted.
 */
export function FreeGiftNote({ product, quantity = 1, className = '' }: { product: Gifted; quantity?: number; className?: string }) {
    const gift = product.festival?.gift;
    if (!gift) return null;
    const count = gift.quantity * quantity;
    return (
        <p className={`flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--festive))] ${className}`}>
            <Gift className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{count > 1 ? `${count} × ` : '+ '}{gift.label}<span className="font-normal text-muted-foreground">, while stocks last</span></span>
        </p>
    );
}
