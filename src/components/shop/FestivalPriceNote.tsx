import { formatINR } from '@/lib/currency';
import { saleDay, useCountdown, useFestival } from '@/hooks/use-festival';

interface PricedProduct {
    category: string;
    list_price?: number | string;
    festival?: { name: string; ends_at: string } | null;
}

/**
 * Under the price on a product page: when this festival price ends and, if
 * the next sale is smaller, the price after it. Mirrors the rounding in
 * backend/src/services/festival.js, which is what checkout will charge.
 */
export function FestivalPriceNote({ product }: { product: PricedProduct }) {
    const status = useFestival();
    const left = useCountdown(product.festival?.ends_at);
    if (!product.festival || !left) return null;

    const next = status?.next;
    const list = Number(product.list_price);
    const nextPrice = next && next.category === product.category && list > 0
        ? Math.round(list * (100 - next.percent_off) / 100)
        : null;
    const ends = left.d > 0 ? `${left.d}d ${left.h}h` : `${left.h}h ${left.m}m ${left.s}s`;

    return (
        <p className="mt-2 text-sm font-medium text-[hsl(var(--ember))]">
            {product.festival.name.replace(/ Sale$/, '')} price ends in {ends}.
            {nextPrice !== null && <> From {saleDay(next!.starts_at)}: {formatINR(nextPrice)}.</>}
        </p>
    );
}
