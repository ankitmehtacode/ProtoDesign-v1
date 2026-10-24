// Festival pricing: which sale applies when, and what a customer is shown and charged.
//
//   node --test test/festival.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeSale, festivalPrice, festivalStatus, nextSale, schedule } from '../src/services/festival.js';
import { TEST_SALES } from './helpers/festival-schedule.mjs';

// The live schedule, checked below before the tests swap it out.
const LIVE_SALES = schedule.sales;
schedule.sales = TEST_SALES;

const at = (iso) => new Date(iso).getTime();
const printer = { id: 'p1', category: '3d_printer', price: '40000.00', compare_at_price: null };

describe('festival schedule', () => {
    it('switches from Navratri to Diwali at midnight IST after Dussehra', () => {
        assert.equal(activeSale(at('2026-10-20T23:59:59+05:30')).id, 'navratri-2026');
        assert.equal(activeSale(at('2026-10-21T00:00:00+05:30')).id, 'diwali-2026');
    });

    it('ends after Bhai Dooj and is off before Navratri', () => {
        assert.equal(activeSale(at('2026-11-11T23:59:59+05:30')).id, 'diwali-2026');
        assert.equal(activeSale(at('2026-11-12T00:00:00+05:30')), null);
        assert.equal(activeSale(at('2026-10-10T23:59:59+05:30')), null);
    });

    it('reports the next sale for the "price goes up" notice', () => {
        assert.equal(nextSale(at('2026-10-15T12:00:00+05:30')).id, 'diwali-2026');
        assert.equal(nextSale(at('2026-10-25T12:00:00+05:30')), null);
        const s = festivalStatus(at('2026-10-15T12:00:00+05:30'));
        assert.equal(s.active.percent_off, 5);
        assert.equal(s.next.percent_off, 3);
    });
});

describe('festivalPrice', () => {
    it('takes 5% off a printer in Navratri and strikes the list price', () => {
        const p = festivalPrice(printer, at('2026-10-15T12:00:00+05:30'));
        assert.equal(p.price, '38000.00');
        assert.equal(p.list_price, '40000.00');
        assert.equal(p.compare_at_price, '40000.00');
        assert.equal(p.list_compare_at_price, null); // what the admin form must save back
        assert.equal(p.festival.name, 'Navratri Sale');
    });

    it('keeps a higher stored reference price as the struck price', () => {
        const p = festivalPrice({ ...printer, compare_at_price: '46999.00' }, at('2026-10-25T12:00:00+05:30'));
        assert.equal(p.price, '38800.00');
        assert.equal(p.compare_at_price, '46999.00');
    });

    it('rounds to whole rupees', () => {
        assert.equal(festivalPrice({ ...printer, price: '41649.00' }, at('2026-10-15T12:00:00+05:30')).price, '39567.00');
    });

    it('leaves other categories and out-of-sale dates untouched apart from list_price', () => {
        const filament = { ...printer, category: 'filament', price: '999.00' };
        assert.deepEqual(festivalPrice(filament, at('2026-10-15T12:00:00+05:30')), { ...filament, list_price: '999.00', list_compare_at_price: null });
        assert.deepEqual(festivalPrice(printer, at('2026-12-01T12:00:00+05:30')), { ...printer, list_price: '40000.00', list_compare_at_price: null });
    });
});

describe('fixed-price sale', () => {
    const fixed = Object.freeze([{
        id: 'fixed', name: 'Pre-Diwali Sale', category: '3d_printer', headline: 'Pre-Diwali prices', short: 'Printers',
        startsAt: '2026-10-22T00:00:00+05:30', endsAt: '2026-11-08T00:00:00+05:30',
        prices: { p1: 37999, p2: 41000 },
    }]);
    const during = at('2026-10-30T12:00:00+05:30');
    const withSales = (fn) => {
        const saved = schedule.sales;
        schedule.sales = fixed;
        try { return fn(); } finally { schedule.sales = saved; }
    };

    it('sells a listed product at exactly its price, striking our own', () => withSales(() => {
        const p = festivalPrice(printer, during);
        assert.equal(p.price, '37999.00');
        assert.equal(p.compare_at_price, '40000.00');
        assert.equal(p.list_price, '40000.00');
        assert.deepEqual([p.festival.name, p.festival.percent_off], ['Pre-Diwali Sale', 5]);
    }));

    it('leaves unlisted products alone, and never raises a price', () => withSales(() => {
        assert.equal(festivalPrice({ ...printer, id: 'other' }, during).festival, undefined);
        const dearer = festivalPrice({ ...printer, id: 'p2' }, during); // 41000 listed over a 40000 price
        assert.equal(dearer.price, '40000.00');
        assert.equal(dearer.festival, undefined);
    }));

    it('ends at its end, and tells the banner it has no single percentage', () => withSales(() => {
        assert.equal(festivalPrice(printer, at('2026-11-08T00:00:00+05:30')).price, '40000.00');
        const { active } = festivalStatus(during);
        assert.deepEqual([active.percent_off, active.headline, active.short], [null, 'Pre-Diwali prices', 'Printers']);
    }));
});

describe('live schedule', () => {
    it('lists real products at whole prices ending in 99, until the end of 7 Nov 2026', () => {
        for (const sale of LIVE_SALES) {
            assert.ok(Date.parse(sale.startsAt) < Date.parse(sale.endsAt));
            for (const [id, price] of Object.entries(sale.prices ?? {})) {
                assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
                assert.ok(Number.isInteger(price) && price % 100 === 99, `${id}: ${price}`);
            }
        }
        const preDiwali = LIVE_SALES.find((s) => s.id === 'diwali-pre-2026');
        assert.equal(Object.keys(preDiwali.prices).length, 17);
        assert.equal(new Date(preDiwali.endsAt).toISOString(), '2026-11-07T18:30:00.000Z'); // midnight IST after 7 Nov
    });
});

