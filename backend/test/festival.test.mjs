// Festival pricing: which sale applies when, and what a customer is shown and charged.
//
//   node --test test/festival.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeSale, festivalPrice, festivalStatus, nextSale, schedule } from '../src/services/festival.js';
import { TEST_SALES } from './helpers/festival-schedule.mjs';

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
