import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { saleDay, serverNow, useCountdown, useFestival } from '@/hooks/use-festival';
import { festivalArt } from './festival-art';

const pad = (n: number) => String(n).padStart(2, '0');
// The last day of a sale whose end is exclusive midnight.
const lastDay = (endsAt: string) => saleDay(new Date(new Date(endsAt).getTime() - 1000).toISOString());

const GOLD = 'text-[hsl(var(--festive-on-dark))]';

/**
 * The running festival sale, its real deadline and, when the next sale is
 * smaller, the price rise that follows. Every number here comes from the
 * server schedule that also sets checkout prices, so none of it is decoration.
 *
 * Always the site's dark surface with the sale's photo, in either theme: the
 * banner reads as a festive card, not a warning strip.
 */
export function FestivalBanner({ showShopLink }: { showShopLink?: boolean }) {
    const status = useFestival();
    const sale = status?.active ?? null;
    const left = useCountdown(sale?.ends_at);
    if (!sale || !left) return null;

    const next = status?.next;
    const priceRises = next && next.category === sale.category && next.percent_off !== null && sale.percent_off !== null
        && next.percent_off < sale.percent_off
        && Date.parse(next.starts_at) > serverNow();
    const art = festivalArt(sale.id);

    return (
        <section
            aria-label={sale.name}
            className="relative isolate mb-3 mt-6 overflow-hidden rounded-2xl bg-[hsl(160_30%_7%)] text-white shadow-[0_18px_50px_-24px_hsl(42_96%_40%/0.45)] ring-1 ring-[hsl(var(--festive-on-dark)/0.3)]"
        >
            {art && (
                <>
                    <img
                        src={art}
                        alt=""
                        decoding="async"
                        className="absolute inset-0 -z-20 h-full w-full object-cover md:left-auto md:w-[62%]"
                    />
                    {/* Phones: the copy sits on the photo, so darken all of it. Wider: fade the photo in from the right. */}
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 bg-[hsl(160_30%_7%/0.78)] md:bg-transparent md:[background:linear-gradient(90deg,hsl(160_30%_7%)_38%,hsl(160_30%_7%/0.75)_55%,hsl(160_30%_7%/0.1)_100%)]"
                    />
                </>
            )}

            <div className="relative flex flex-col gap-5 px-5 py-6 md:flex-row md:items-center md:justify-between md:gap-8 md:px-8 md:py-8">
                <div className="max-w-xl">
                    <p className={`font-mono text-[11px] font-semibold uppercase tracking-[0.24em] ${GOLD}`}>{sale.name}</p>
                    <p className="mt-2 text-2xl font-bold leading-tight tracking-tight md:text-3xl">
                        {sale.percent_off !== null
                            ? <>Extra <span className={GOLD}>{sale.percent_off}% off</span> every 3D printer</>
                            : sale.headline}
                    </p>
                    <p className="mt-2 text-sm text-white/75 md:text-base">
                        {sale.percent_off !== null
                            ? 'On top of our deal prices, with free shipping. '
                            : 'Lower prices on selected models, GST included, with free shipping. '}
                        {priceRises
                            ? `Ends ${lastDay(sale.ends_at)}. From ${saleDay(next.starts_at)} it drops to ${next.percent_off}% off, so prices go up.`
                            : `Ends ${lastDay(sale.ends_at)}. Prices return to normal after that.`}
                    </p>
                    {showShopLink && (
                        <Link
                            to="/printers"
                            className={`group mt-4 inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline ${GOLD}`}
                        >
                            Shop printers
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                    )}
                </div>

                <p className="flex shrink-0 items-stretch gap-2 font-display tabular-nums" aria-live="off">
                    <span className="sr-only">Ends in </span>
                    {left.d > 0 && <Unit value={String(left.d)} label="days" />}
                    <Unit value={pad(left.h)} label="hrs" />
                    <Unit value={pad(left.m)} label="min" />
                    <Unit value={pad(left.s)} label="sec" />
                </p>
            </div>
        </section>
    );
}

function Unit({ value, label }: { value: string; label: string }) {
    return (
        <span className="flex min-w-[3.5rem] flex-col items-center rounded-xl bg-white/10 px-2.5 py-2 ring-1 ring-white/15 backdrop-blur-md">
            <span className="text-2xl font-bold leading-none md:text-3xl">{value}</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">{label}</span>
        </span>
    );
}
