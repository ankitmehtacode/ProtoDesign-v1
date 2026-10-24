/**
 * Festival sales, between fixed dates: an extra percentage off a category, or
 * fixed prices for named products.
 *
 * This file is the only source of truth for the sale. Every price a customer
 * sees or pays goes through festivalPrice(): the product list and page, the
 * cart, checkout (order.service.js) and the Merchant feed. Stored prices are
 * never changed, so a sale ends on its own at endsAt and there is nothing to
 * revert.
 *
 * Dates are IST and the end is exclusive. A sale is either
 *
 *   { percentOff: 3, category: '3d_printer', ... }   every product in the category, or
 *   { prices: { <product id>: <rupees> }, category: '3d_printer', ... }
 *
 * where a listed product sells at exactly that price. A listed price at or above
 * the stored one is ignored: a sale never raises a price. `headline` and `short`
 * are the banner's words for a fixed-price sale, which has no single percentage.
 * `gift` ({ productId, quantity, label }) comes free with each unit of a product
 * on sale; checkout adds it to the order (order.service.js) while stock lasts.
 * When a sale starts or ends while the site is up, the prerendered pages need a
 * rebuild (infra/template.yaml, *Rebuild schedules).
 */

export const FESTIVAL_REBUILD_EVENT_SOURCE = 'protodesign.festival-rebuild';

// Replaceable by tests only, so pricing tests do not depend on the live schedule.
export const schedule = {
    sales: Object.freeze([
        // Hydrotech 3D Chennai's Diwali prices (24 Oct to 7 Nov) plus 4%, each
        // rounded up to end in 99. Starts on deploy, ends with 7 Nov.
        Object.freeze({
            id: 'diwali-pre-2026',
            name: 'Pre-Diwali Sale',
            category: '3d_printer',
            headline: 'Pre-Diwali prices on Bambu Lab 3D printers, with a free PLA roll while stocks last',
            short: 'Bambu Lab + free PLA',
            gift: Object.freeze({ productId: 'd709994d-f4ba-471c-8fdd-82e8e12de3c7', quantity: 1, label: 'Free 1 kg PLA filament roll' }),
            startsAt: '2026-10-22T00:00:00+05:30',
            endsAt: '2026-11-08T00:00:00+05:30',
            prices: Object.freeze({
                '3e80ba86-3318-437e-895b-11f4bdef9b48': 32299, // A1 Mini Combo
                '0c43822c-c9ee-4a7f-91bf-23285f9e2ad5': 27099, // A1
                '4621092f-3ac1-4e51-8912-57ebbe568983': 40599, // A1 Combo
                '37c28fae-6435-4c71-bd0b-49df35d30888': 40599, // A2L
                '331f8102-c2e1-48b3-a5bc-2b120fb08ad1': 55199, // A2L Combo
                'f109b298-623f-4723-b82f-ab085de0611d': 45299, // P1S
                'cbc693da-3ad6-46cd-873a-de17f85f62d5': 60899, // P1S Combo
                '7173380f-c5b6-445e-8055-dbe03478dd7e': 60399, // P2S
                '47b66700-5d85-44cd-8fc8-cd246937a8da': 85299, // X2D
                'a4cf6b29-982d-4c79-976d-9787726fd6bd': 114399, // X2D Combo
                '707fa3a9-6a87-4568-a719-195524e74766': 152899, // H2S Combo
                '0d7c36c0-2053-4a99-9893-5dc917d14634': 176799, // H2D
                '6ac35214-cc92-403e-ab4d-0ab69349c99a': 267299, // H2C Combo
                // Added 24 Oct with a margin tiered by price: 5% under ₹50k,
                // 4% to ₹1.5L, 3% above.
                '2f1e8908-5bf4-47eb-a3b5-f6f622746613': 19499, // A1 Mini (offer ₹18,499)
                '95b1b400-8e94-4602-8ba9-3367b7b5353b': 84299, // P2S Combo (offer ₹80,999)
                '5fe14e9f-13bf-4d94-b632-39bf4b2c91ed': 128999, // H2S (offer ₹1,23,999)
                '6506f594-d110-467e-9801-ef43eb2d5398': 194699, // H2D Combo (offer ₹1,88,999)
            }),
        }),
    ]),
};

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
    if (!sale || !(listPrice > 0)) return out;
    const salePrice = sale.prices
        ? Number(sale.prices[product.id])
        : product.category === sale.category ? discounted(listPrice, sale.percentOff) : NaN;
    if (!(salePrice > 0 && salePrice < listPrice)) return out;

    const was = Math.max(Number(product.compare_at_price) || 0, listPrice);
    return {
        ...out,
        price: salePrice.toFixed(2),
        compare_at_price: was.toFixed(2),
        festival: {
            id: sale.id, name: sale.name, ends_at: sale.endsAt,
            // Off our own price, the claim we fully control.
            percent_off: sale.percentOff ?? Math.round((1 - salePrice / listPrice) * 100),
            ...(sale.gift && { gift: { product_id: sale.gift.productId, quantity: sale.gift.quantity, label: sale.gift.label } }),
        },
    };
}

/** Public schedule for the storefront banner and countdown. */
export function festivalStatus(now = clock.now()) {
    // percent_off is null for a fixed-price sale, whose discount differs by product.
    const pick = (s) => s && {
        id: s.id, name: s.name, percent_off: s.percentOff ?? null, category: s.category,
        headline: s.headline ?? null, short: s.short ?? null, gift: s.gift?.label ?? null, starts_at: s.startsAt, ends_at: s.endsAt,
    };
    return { now: new Date(now).toISOString(), active: pick(activeSale(now)), next: pick(nextSale(now)) };
}
