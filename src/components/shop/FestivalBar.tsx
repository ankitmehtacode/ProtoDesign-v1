import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { shortLeft, useCountdown, useFestival } from '@/hooks/use-festival';

// Catalogue pages carry the full FestivalBanner; checkout, admin and sign-in
// are no place to send a shopper off to browse.
const HIDDEN_ON = /^\/(shop|printers|printables|filaments|accessories|spare-parts|resins|checkout|admin|bulk-upload|auth|forgot-password|reset-password)(\/|$)/;

// The bar sits inside the fixed navigation, so the page below must move down by
// its height. Layout reads this variable rather than knowing about the bar.
const HEIGHT_VAR = '--sale-bar-h';
const HEIGHT = '2.25rem';

// The home page is a run of pinned, screen-tall scroll scenes sized to clear the
// navigation alone. There the bar overlays the hero's empty top edge instead of
// pushing the page down, and steps aside once the visitor scrolls into them.
const OVERLAY_ON = '/';

const dismissKey = (saleId: string) => `festival-bar-dismissed:${saleId}`;

function wasDismissed(saleId: string) {
    try {
        return localStorage.getItem(dismissKey(saleId)) === '1';
    } catch {
        return false; // storage blocked: show the bar, it is still dismissible for this visit
    }
}

/**
 * One line above the navigation on every page that does not already show the
 * sale: what it is, when it really ends, and the way to the printers. Gone
 * for the rest of the sale once dismissed; a new sale shows it again.
 */
export function FestivalBar() {
    const { pathname } = useLocation();
    const sale = useFestival()?.active ?? null;
    const left = useCountdown(sale?.ends_at);
    const [dismissed, setDismissed] = useState<string | null>(null);
    const overlay = pathname === OVERLAY_ON;
    const nearTop = useNearTop(overlay);

    const visible = !!sale && !!left && !HIDDEN_ON.test(pathname)
        && dismissed !== sale.id && !wasDismissed(sale.id) && (!overlay || nearTop);

    useEffect(() => {
        const root = document.documentElement.style;
        if (visible && !overlay) root.setProperty(HEIGHT_VAR, HEIGHT);
        else root.removeProperty(HEIGHT_VAR);
        return () => { root.removeProperty(HEIGHT_VAR); };
    }, [visible, overlay]);

    if (!visible) return null;

    const dismiss = () => {
        try {
            localStorage.setItem(dismissKey(sale.id), '1');
        } catch {
            // storage blocked: dismissed for this visit only
        }
        setDismissed(sale.id);
    };

    return (
        <div className="relative bg-[hsl(var(--ember))] text-neutral-950" style={{ height: HEIGHT }}>
            <Link
                to="/printers"
                className="group flex h-full items-center justify-center gap-2 pl-3 pr-10 text-xs font-semibold sm:px-10 sm:text-sm"
            >
                <span className="truncate">
                    <span className="hidden sm:inline">{sale.name}: extra {sale.percent_off}% off every 3D printer</span>
                    <span className="sm:hidden">{sale.name.replace(/ Sale$/, '')}: {sale.percent_off}% off printers</span>
                    <span className="mx-2 opacity-60" aria-hidden="true">·</span>
                    <span className="tabular-nums"><span className="hidden sm:inline">ends in </span>{shortLeft(left)}<span className="sm:hidden"> left</span></span>
                </span>
                <span className="hidden items-center gap-1 underline underline-offset-2 sm:inline-flex">
                    Shop printers
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
            </Link>
            <button
                type="button"
                onClick={dismiss}
                aria-label={`Hide the ${sale.name} bar`}
                className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full hover:bg-neutral-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

/** Whether the page is scrolled less than half a screen; tracked only when `enabled`. */
function useNearTop(enabled: boolean) {
    const [nearTop, setNearTop] = useState(true);
    useEffect(() => {
        if (!enabled) return;
        const update = () => setNearTop(window.scrollY < window.innerHeight / 2);
        update();
        window.addEventListener('scroll', update, { passive: true });
        return () => window.removeEventListener('scroll', update);
    }, [enabled]);
    return nearTop;
}
