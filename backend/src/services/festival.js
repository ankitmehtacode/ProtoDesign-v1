/**
 * Festival sales: an extra percentage off a category, between fixed dates.
 *
 * This file is the only source of truth for the sale. Every price a customer
 * sees or pays goes through festivalPrice(): the product list and page, the
 * cart, checkout (order.service.js) and the Merchant feed. Stored prices are
 * never changed, so a sale ends on its own at endsAt and there is nothing to
 * revert.
 *
 * Dates are IST and the end is exclusive. No sale is scheduled (the 2026
 * Navratri and Diwali sales were ended on 2026-10-20). Add an entry to
 * schedule.sales to run one again, e.g.
 *
 *   { id: 'diwali-2026', name: 'Diwali Sale', percentOff: 3, category: '3d_printer',
 *     startsAt: '2026-10-21T00:00:00+05:30', endsAt: '2026-11-12T00:00:00+05:30' }
 */

export const FESTIVAL_REBUILD_EVENT_SOURCE = 'protodesign.festival-rebuild';

// Replaceable by tests only, so pricing tests do not depend on the live schedule.
export const schedule = { sales: Object.freeze([]) };

const ms = (iso) => new Date(iso).getTime();

// Replaceable by tests only, so pricing assertions do not depend on the date they run.
export const clock = { now: () => Date.now() };

/** The sale running at `now`, or null. */
export function activeSale(now = clock.now()) {
    return schedule.sales.find((s) => ms(s.startsAt) <= now && now < ms(s.endsAt)) ?? null;
}

/** The next sale to start after `now`, or null. */
export function nextSale(now = clock.now()) {
    return schedule.sales.find((s) => ms(s.startsAt) > now) ?? null;
}

/** Whole rupees: listed prices are shown and charged without paise. */
const discounted = (price, percentOff) => Math.round(Number(price) * (100 - percentOff) / 100);

/**
 * A product row as customers see it at `now`. Adds list_price and
 * list_compare_at_price (the stored values, which admin editors must read and
 * write) and, during a sale, lowers
 * price and sets compare_at_price to the higher of the stored reference price
 * and the list price, so the struck price is one we really charged or quoted.
 * Rows outside a sale come back with only those two fields added.
 */
export function festivalPrice(product, now = clock.now()) {
    const listPrice = Number(product.price);
    const out = { ...product, list_price: product.price, list_compare_at_price: product.compare_at_price ?? null };
    const sale = activeSale(now);
    if (!sale || product.category !== sale.category || !(listPrice > 0)) return out;

    const was = Math.max(Number(product.compare_at_price) || 0, listPrice);
    return {
        ...out,
        price: discounted(listPrice, sale.percentOff).toFixed(2),
        compare_at_price: was.toFixed(2),
        festival: { id: sale.id, name: sale.name, percent_off: sale.percentOff, ends_at: sale.endsAt },
    };
}

/** Public schedule for the storefront banner and countdown. */
export function festivalStatus(now = clock.now()) {
    const pick = (s) => s && { id: s.id, name: s.name, percent_off: s.percentOff, category: s.category, starts_at: s.startsAt, ends_at: s.endsAt };
    return { now: new Date(now).toISOString(), active: pick(activeSale(now)), next: pick(nextSale(now)) };
}
