import { formatINR } from '@/lib/currency';
import { saleDay, serverNow, shortLeft, useCountdown, useFestival } from '@/hooks/use-festival';

interface PricedProduct {
    category: string;
    list_price?: number | string;
    festival?: { id: string; name: string; ends_at: string } | null;
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
    // Only a sale still to come: a status fetched before a boundary can name one that has already started.
    const nextPrice = next && next.category === product.category && list > 0
        && Date.parse(next.starts_at) > serverNow() && next.id !== product.festival.id
        ? Math.round(list * (100 - next.percent_off) / 100)
        : null;

    return (
        <p className="mt-2 text-sm font-medium text-[hsl(var(--ember))]">
            {product.festival.name.replace(/ Sale$/, '')} price ends in {shortLeft(left)}.
            {nextPrice !== null && <> From {saleDay(next!.starts_at)}: {formatINR(nextPrice)}.</>}
        </p>
    );
}
