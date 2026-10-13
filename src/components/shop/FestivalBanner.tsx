import { Link } from 'react-router-dom';
import { saleDay, useCountdown, useFestival } from '@/hooks/use-festival';

const pad = (n: number) => String(n).padStart(2, '0');
// The last day of a sale whose end is exclusive midnight.
const lastDay = (endsAt: string) => saleDay(new Date(new Date(endsAt).getTime() - 1000).toISOString());

/**
 * The running festival sale, its real deadline and, when the next sale is
 * smaller, the price rise that follows. Every number here comes from the
 * server schedule that also sets checkout prices, so none of it is decoration.
 */
export function FestivalBanner({ showShopLink }: { showShopLink?: boolean }) {
    const status = useFestival();
    const sale = status?.active ?? null;
    const left = useCountdown(sale?.ends_at);
    if (!sale || !left) return null;

    const next = status?.next;
    const priceRises = next && next.category === sale.category && next.percent_off < sale.percent_off;

    return (
        <section
            aria-label={sale.name}
            className="mt-6 overflow-hidden rounded-2xl bg-[hsl(var(--ember))] px-5 py-4 text-neutral-950 md:flex md:items-center md:justify-between md:gap-6 md:px-6"
        >
            <div>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em]">{sale.name}</p>
                <p className="mt-1 text-lg font-bold leading-snug md:text-xl">
                    Extra {sale.percent_off}% off every 3D printer, on top of our deal prices
                </p>
                <p className="mt-1 text-sm font-medium text-neutral-950/80">
                    {priceRises
                        ? `Ends ${lastDay(sale.ends_at)}. From ${saleDay(next.starts_at)} it drops to ${next.percent_off}% off, so prices go up.`
                        : `Ends ${lastDay(sale.ends_at)}. Prices return to normal after that.`}
                    {showShopLink && <> <Link to="/printers" className="font-semibold underline underline-offset-2">Shop printers</Link></>}
                </p>
            </div>
            <p className="mt-3 flex shrink-0 items-baseline gap-1 font-display tabular-nums md:mt-0" aria-live="off">
                <span className="sr-only">Ends in </span>
                {left.d > 0 && <><span className="text-3xl font-bold">{left.d}</span><span className="mr-2 text-xs font-semibold">d</span></>}
                <span className="text-3xl font-bold">{pad(left.h)}</span><span className="mr-2 text-xs font-semibold">h</span>
                <span className="text-3xl font-bold">{pad(left.m)}</span><span className="mr-2 text-xs font-semibold">m</span>
                <span className="text-3xl font-bold">{pad(left.s)}</span><span className="text-xs font-semibold">s</span>
            </p>
        </section>
    );
}
