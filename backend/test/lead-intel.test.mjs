// Lead scoring, hot-lead alerts and filament reorder predictions, against a
// real Postgres: the score's rules and reasons, which leads are scored, one
// alert per time a lead turns hot, the reorder model's three bases, which
// orders count, the Monday digest, and admin-only access.
//
//   tsx --test test/lead-intel.test.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
Object.assign(process.env, {
    DATABASE_URL: pg.url,
    JWT_SECRET: 'test-jwt-secret',
    AWS_LAMBDA_FUNCTION_NAME: 'lead-intel-test',
});

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const intel = await import('../src/services/lead-intel.service.js');
const leads = await import('../src/services/leads.service.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

const call = async (method, path, { userId } = {}) => {
    const headers = { 'content-type': 'application/json', host: 'example.lambda-url.ap-southeast-1.on.aws' };
    if (userId) headers.authorization = `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;
    const res = await handler({
        version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '', headers,
        requestContext: { http: { method, path, sourceIp: '203.0.113.7' }, domainName: 'example' },
        isBase64Encoded: false,
    }, {});
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

let n = 0;
const seedUser = async (role, name = 'Person') => {
    const id = (await db.one(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
        [`person${++n}@test.local`, name])).id;
    if (role) await db.none('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
    return id;
};
const seedProduct = async ({ name = 'Thing', price = 1000, category = '3d_printer', sub = null, specs = {} } = {}) => (await db.one(
    `INSERT INTO products (name, price, category, sub_category, specifications) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, price, category, sub, JSON.stringify(specs)])).id;
const seedLead = async ({ interest = 'printer', message = null, status = 'new', userId = null, phone, daysAgo = 0 } = {}) => (await db.one(
    `INSERT INTO leads (name, phone, interest, message, status, user_id, form, consent_text, last_submitted_at, created_at)
     VALUES ('Asha', $1, $2, $3, $4, $5, 'product_page', 'x', now() - make_interval(days => $6), now() - make_interval(days => $6))
     RETURNING id`,
    [phone ?? `9198${String(++n).padStart(8, '0')}`, interest, message, status, userId, daysAgo])).id;
/** Tracked events for a lead, each `[name, daysAgo, productId?]`. */
const seedEvents = async (leadId, events) => {
    const visitor = randomUUID();
    await db.none('INSERT INTO visitors (id, lead_id) VALUES ($1, $2)', [visitor, leadId]);
    for (const [name, daysAgo, productId] of events) {
        await db.none(`INSERT INTO visitor_events (visitor_id, name, product_id, created_at)
                       VALUES ($1, $2, $3, now() - make_interval(days => $4))`, [visitor, name, productId ?? null, daysAgo]);
    }
};
const seedOrder = async (userId, items, { daysAgo, status = 'delivered', phone = '9876543210' }) => {
    const id = (await db.one(
        `INSERT INTO orders (user_id, subtotal_amount, tax_amount, shipping_amount, total_amount, status, shipping_address, created_at)
         VALUES ($1, 1000, 0, 0, 1000, $2, $3, now() - make_interval(days => $4)) RETURNING id`,
        [userId, status, JSON.stringify({ fullName: 'Ship Name', phone }), daysAgo])).id;
    for (const [productId, quantity] of items) {
        await db.none('INSERT INTO order_items (order_id, product_id, quantity, price, line_total) VALUES ($1, $2, $3, 1000, 1000)', [id, productId, quantity]);
    }
};

beforeEach(async () => {
    await db.none('TRUNCATE tool_results, product_alerts, visitor_events, visitors, leads, order_items, orders, user_roles, users, products CASCADE');
});

const NOW = new Date('2026-10-21T06:00:00Z');
const signals = (over = {}) => ({
    interest: 'printer', product_views: 0, premium_views: 0, carts: 0, quotes: 0, tools: 0, alerts: 0, active_days: 0,
    verified: false, has_message: false, submissions: 1, orders: 0,
    last_submitted_at: NOW, last_event_at: null, ...over,
});

describe('scoreLead', () => {
    it('adds up readable reasons, largest first', () => {
        const { score, reasons } = intel.scoreLead(signals({
            product_views: 3, premium_views: 1, carts: 1, has_message: true,
        }), NOW);
        assert.equal(score, 15 + 9 + 10 + 15 + 5 + 15);
        assert.equal(intel.band(score), 'hot');
        assert.deepEqual(reasons[0], { label: 'Wants a printer', points: 15 });
        assert.ok(reasons.some((r) => r.label === 'Viewed 3 product pages' && r.points === 9));
        for (let i = 1; i < reasons.length; i++) assert.ok(reasons[i - 1].points >= reasons[i].points);
    });

    it('rates a bare enquiry warm, and a long-quiet one cold', () => {
        assert.equal(intel.band(intel.scoreLead(signals({ has_message: true }), NOW).score), 'warm');
        const quiet = intel.scoreLead(signals({ interest: 'other', last_submitted_at: new Date(NOW - 40 * 86_400_000) }), NOW);
        assert.equal(quiet.score, 0);
        assert.deepEqual(quiet.reasons.at(-1), { label: 'Quiet for 40 days', points: -15 });
    });

    it('counts the newest of the enquiry and tracked activity, and stays within 0-100', () => {
        const old = new Date(NOW - 20 * 86_400_000);
        const s = intel.scoreLead(signals({ last_submitted_at: old, last_event_at: new Date(NOW - 3600_000) }), NOW);
        assert.ok(s.reasons.some((r) => r.label === 'Active in the last 2 days'));
        const max = intel.scoreLead(signals({ product_views: 9, premium_views: 2, carts: 3, quotes: 1, tools: 1, alerts: 1,
            active_days: 6, verified: true, has_message: true, submissions: 3, orders: 2 }), NOW);
        assert.equal(max.score, 100);
    });
});

describe('runLeadScoring', () => {
    it('scores open leads from their tracked activity and leaves closed ones alone', async () => {
        const premium = await seedProduct({ price: 45_000 });
        const hot = await seedLead({ message: 'Need one for my studio' });
        await seedEvents(hot, [['product_view', 0, premium], ['product_view', 1, premium], ['add_to_cart', 0, premium]]);
        const won = await seedLead({ status: 'won' });

        const alerts = [];
        const result = await intel.runLeadScoring({ alert: async (m) => alerts.push(m), frontendUrl: 'https://shop.example' });
        assert.equal(result.scored, 1);

        const row = await db.one('SELECT score, score_reasons, scored_at, hot_alerted_at FROM leads WHERE id = $1', [hot]);
        assert.ok(row.score >= intel.HOT_SCORE);
        assert.ok(row.score_reasons.some((r) => r.label === 'Added to cart'));
        assert.ok(row.score_reasons.some((r) => r.label === 'Came back on 2 days in two weeks'));
        assert.ok(row.hot_alerted_at);
        assert.equal((await db.one('SELECT score FROM leads WHERE id = $1', [won])).score, null);

        assert.equal(alerts.length, 1);
        assert.match(alerts[0], /^🔥 Hot lead \(\d+\/100\): Asha/);
        assert.match(alerts[0], /Why: .*added to cart/);
        assert.match(alerts[0], /https:\/\/shop\.example\/admin\?tab=leads$/);
    });

    it('alerts once while hot, and again only after cooling down and heating up', async () => {
        const premium = await seedProduct({ price: 45_000 });
        const lead = await seedLead({ message: 'hi' });
        await seedEvents(lead, [['add_to_cart', 0, premium], ['product_view', 0, premium]]);
        const alerts = [];
        const alert = async (m) => alerts.push(m);

        await intel.runLeadScoring({ alert });
        await intel.runLeadScoring({ alert });
        assert.equal(alerts.length, 1);

        // A month of silence: below 45, so the alert is re-armed.
        await db.none(`UPDATE visitor_events SET created_at = now() - interval '40 days'`);
        await db.none(`UPDATE leads SET last_submitted_at = now() - interval '40 days'`);
        await intel.runLeadScoring({ alert });
        assert.equal((await db.one('SELECT hot_alerted_at FROM leads')).hot_alerted_at, null);

        await seedEvents(lead, [['add_to_cart', 0, premium], ['product_view', 0, premium], ['quote_start', 0]]);
        await intel.runLeadScoring({ alert });
        assert.equal(alerts.length, 2);
    });

    it('sends five alerts one by one and the rest in one message', async () => {
        const premium = await seedProduct({ price: 45_000 });
        for (let i = 0; i < 7; i++) {
            const id = await seedLead({ message: 'hi' });
            await seedEvents(id, [['add_to_cart', 0, premium], ['product_view', 0, premium]]);
        }
        const alerts = [];
        const result = await intel.runLeadScoring({ alert: async (m) => alerts.push(m) });
        assert.equal(result.alerted, 7);
        assert.equal(alerts.length, 6);
        assert.match(alerts[5], /^🔥 2 more leads turned hot: Asha, Asha/);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM leads WHERE hot_alerted_at IS NOT NULL')).n, 7);
    });

    const hotLead = async () => {
        const premium = await seedProduct({ price: 45_000 });
        const id = await seedLead({ message: 'hi' });
        await seedEvents(id, [['add_to_cart', 0, premium], ['product_view', 0, premium]]);
        return id;
    };

    it('alerts once even when two runs overlap', async () => {
        await hotLead();
        const alerts = [];
        const alert = async (m) => { alerts.push(m); return true; };
        await Promise.all([intel.runLeadScoring({ alert }), intel.runLeadScoring({ alert })]);
        assert.equal(alerts.length, 1);
    });

    it('keeps an undelivered alert for the next run', async () => {
        await hotLead();
        const first = await intel.runLeadScoring({ alert: async () => false });
        assert.deepEqual([first.alerted, first.unsent], [0, 1]);
        assert.equal((await db.one('SELECT hot_alerted_at FROM leads')).hot_alerted_at, null);
        const sent = [];
        const second = await intel.runLeadScoring({ alert: async (m) => { sent.push(m); return true; } });
        assert.equal(second.alerted, 1);
        assert.equal(sent.length, 1);
    });

    it('sends nothing with too little time left, and leaves it for the next run', async () => {
        await hotLead();
        const sent = [];
        const result = await intel.runLeadScoring({ alert: async (m) => { sent.push(m); return true; }, remainingMs: () => 1000 });
        assert.equal(sent.length, 0);
        assert.equal(result.unsent, 1);
        assert.equal((await db.one('SELECT hot_alerted_at FROM leads')).hot_alerted_at, null);
    });

    it('drops the score of a won or lost lead', async () => {
        const id = await hotLead();
        const other = await hotLead();
        await intel.runLeadScoring({ alert: async () => true });
        await leads.updateLead(id, { status: 'lost' });
        assert.equal((await db.one('SELECT score FROM leads WHERE id = $1', [id])).score, null);
        // Closed some other way (a script, the SQL editor): the next run clears it.
        await db.none(`UPDATE leads SET status = 'won' WHERE id = $1`, [other]);
        await intel.runLeadScoring({});
        assert.deepEqual(await db.one('SELECT score, hot_alerted_at FROM leads WHERE id = $1', [other]), { score: null, hot_alerted_at: null });
    });

    it('does not move updated_at by scoring alone', async () => {
        const id = await seedLead();
        await db.none(`UPDATE leads SET updated_at = '2026-01-01' WHERE id = $1`, [id]);
        await intel.runLeadScoring({});
        assert.equal((await db.one('SELECT updated_at::date::text AS d FROM leads')).d, '2026-01-01');
        await leads.updateLead(id, { admin_notes: 'called' });
        assert.notEqual((await db.one('SELECT updated_at::date::text AS d FROM leads')).d, '2026-01-01');
    });

    it('rewrites nothing that has not changed', async () => {
        await seedLead({ interest: 'filament' });
        const first = await intel.runLeadScoring({});
        const second = await intel.runLeadScoring({});
        assert.equal(first.updated, 1);
        assert.equal(second.updated, 0);
    });

    it('counts a confirmed contact and an earlier purchase', async () => {
        const user = await seedUser();
        const lead = await seedLead({ interest: 'filament', userId: user });
        await db.none(`INSERT INTO tool_results (tool, inputs, result, lead_id, delivered_at)
                       VALUES ('filament_estimator', '{}', '{}', $1, now())`, [lead]);
        await seedOrder(user, [], { daysAgo: 30 });
        await intel.runLeadScoring({});
        const { score_reasons: reasons } = await db.one('SELECT score_reasons FROM leads');
        assert.ok(reasons.some((r) => r.label === 'Confirmed their number or email'));
        assert.ok(reasons.some((r) => r.label === 'Already a customer'));
    });

    it('reports a failure instead of throwing', async () => {
        const alerts = [];
        await db.none('ALTER TABLE leads RENAME COLUMN score_reasons TO score_reasons_x');
        try {
            await seedLead();
            const result = await intel.runLeadScoring({ alert: async (m) => alerts.push(m) });
            assert.equal(result.status, 'failed');
            assert.match(alerts[0], /Lead scoring failed/);
        } finally {
            await db.none('ALTER TABLE leads RENAME COLUMN score_reasons_x TO score_reasons');
        }
    });

    it('puts scores in the admin overview', async () => {
        await seedLead({ message: 'hello' });
        await intel.runLeadScoring({});
        const { leads: list } = await leads.adminOverview();
        assert.ok(list[0].score > 0);
        assert.ok(Array.isArray(list[0].score_reasons));
    });
});

describe('reorder predictions', () => {
    const day = 86_400_000;
    const history = (over) => ({ user_id: randomUUID(), name: 'A', email: 'a@x', phone: null, materials: ['PLA'],
        assumedKg: false, orders: 1, lastOrderAt: new Date(NOW - 20 * day), lastKg: 1, historyRate: null, ...over });

    it('uses the customer\'s own rhythm, then their calculator answer, then the typical rate', () => {
        const own = history({ orders: 3, historyRate: 2 / 60, lastKg: 2, lastOrderAt: new Date(NOW - 50 * day) });
        const calc = history({ lastKg: 1, lastOrderAt: new Date(NOW - 10 * day) });
        const typical = history({ lastOrderAt: new Date(NOW - 25 * day) });
        const out = intel.predictReorders([own, calc, typical], new Map([[calc.user_id, 3000]]), NOW);
        const by = Object.fromEntries(out.map((c) => [c.basis, c]));
        assert.equal(by.history.daysLeft, 10); // 2 kg at 1 kg a month, bought 50 days ago
        assert.equal(by.calculator.daysLeft, 0); // 1 kg at 3 kg a month, bought 10 days ago
        assert.equal(by.calculator.kgPerMonth, 3);
        assert.equal(by.typical.daysLeft, 5); // 1 kg at the default 1 kg a month
        assert.deepEqual(out.map((c) => c.basis), ['calculator', 'typical', 'history']);
    });

    it('learns the typical rate from five repeat buyers', () => {
        const repeat = Array.from({ length: 5 }, () => history({ orders: 2, historyRate: 1 / 60, lastOrderAt: new Date(NOW - 100 * day) }));
        const once = history({ lastOrderAt: new Date(NOW - 50 * day) });
        const out = intel.predictReorders([...repeat, once], new Map(), NOW);
        assert.equal(out.find((c) => c.user_id === once.user_id).daysLeft, 10); // 1 kg at 0.5 kg a month
    });

    it('treats an order within a week of the last as the same purchase', () => {
        const u = randomUUID();
        const line = (order, daysAgo, quantity = 1) => ({ user_id: u, full_name: 'C', email: 'c@x', phone: null, sub_category: 'PLA',
            specifications: {}, order_id: order, created_at: new Date(NOW - daysAgo * day), quantity, product_name: 'PLA 1kg' });
        const [h] = intel.buyingHistory([line('a', 62), line('b', 2), line('c', 0)]);
        assert.equal(h.orders, 2);
        assert.equal(h.lastKg, 2);
        assert.ok(Math.abs(h.historyRate - 1 / 60) < 1e-9);
        assert.equal(h.lastOrderAt.getTime(), NOW.getTime());
    });

    it('rounds the weight it shows', () => {
        const [h] = intel.buyingHistory([{ user_id: 'u', full_name: 'D', email: null, phone: null, sub_category: 'PLA', specifications: {},
            order_id: 'o', created_at: NOW, quantity: 3, product_name: 'PLA sample 100g' }]);
        assert.equal(h.lastKg, 0.3);
    });

    it('lists from 45 days overdue to 21 days ahead', () => {
        const out = intel.predictReorders([
            history({ lastOrderAt: new Date(NOW - 80 * day) }), // ran out 50 days ago: lapsed
            history({ lastOrderAt: new Date(NOW - 70 * day) }), // 40 days overdue
            history({ lastOrderAt: new Date(NOW - 5 * day) }), // 25 days ahead
        ], new Map(), NOW);
        assert.deepEqual(out.map((c) => c.daysLeft), [-40]);
    });

    it('reads spool weights, and merges lines into purchases', () => {
        const u = randomUUID();
        const base = { user_id: u, full_name: 'B', email: 'b@x', phone: '98', sub_category: 'PLA', specifications: {} };
        const h = intel.buyingHistory([
            { ...base, order_id: 'o1', created_at: new Date(NOW - 60 * day), quantity: 2, product_name: 'PLA 1kg' },
            { ...base, order_id: 'o1', created_at: new Date(NOW - 60 * day), quantity: 1, product_name: 'PETG 500g', sub_category: 'PETG' },
            { ...base, order_id: 'o2', created_at: new Date(NOW - 0 * day), quantity: 1, product_name: 'Mystery spool' },
        ]);
        assert.equal(h.length, 1);
        assert.equal(h[0].orders, 2);
        assert.equal(h[0].lastKg, 1); // assumed
        assert.equal(h[0].assumedKg, true);
        assert.ok(Math.abs(h[0].historyRate - 2.5 / 60) < 1e-9);
        assert.deepEqual(h[0].materials.sort(), ['PETG', 'PLA']);
    });

    it('counts only confirmed filament orders, with the phone from the shipping address', async () => {
        const pla = await seedProduct({ name: 'PLA Black', category: 'filament', sub: 'PLA', specs: { Weight: '1 kg' } });
        const printer = await seedProduct({ name: 'Printer', price: 30_000 });
        const buyer = await seedUser(null, 'Ravi');
        await seedOrder(buyer, [[pla, 1]], { daysAgo: 28 });
        await seedOrder(buyer, [[pla, 5]], { daysAgo: 2, status: 'cancelled' });
        await seedOrder(buyer, [[printer, 1]], { daysAgo: 1 });
        const unpaid = await seedUser();
        await seedOrder(unpaid, [[pla, 1]], { daysAgo: 28, status: 'pending' });

        const { customers, buyers } = await intel.reorderPredictions();
        assert.equal(buyers, 1);
        assert.equal(customers.length, 1);
        assert.equal(customers[0].name, 'Ravi');
        assert.equal(customers[0].phone, '9876543210');
        assert.equal(customers[0].lastKg, 1);
        assert.equal(customers[0].basis, 'typical');
        assert.ok(customers[0].daysLeft >= 1 && customers[0].daysLeft <= 3);
    });

    it('uses a linked filament-calculator answer', async () => {
        const pla = await seedProduct({ name: 'PLA 1kg', category: 'filament', sub: 'PLA' });
        const buyer = await seedUser();
        await seedOrder(buyer, [[pla, 1]], { daysAgo: 5 });
        const lead = await seedLead({ interest: 'filament', userId: buyer });
        await db.none(`INSERT INTO tool_results (tool, inputs, result, lead_id) VALUES ('filament_estimator', '{}', $1, $2)`,
            [JSON.stringify({ grams_per_month: 6000 }), lead]);
        const [c] = (await intel.reorderPredictions()).customers;
        assert.equal(c.basis, 'calculator');
        assert.equal(c.daysLeft, 0);
    });
});

describe('reorder digest and access', () => {
    it('lists customers due within a week, and says nothing when none are', async () => {
        const alerts = [];
        const alert = async (m) => alerts.push(m);
        assert.deepEqual(await intel.runReorderDigest({ alert }), { status: 'ok', due: 0 });
        assert.equal(alerts.length, 0);

        const pla = await seedProduct({ name: 'PLA 1kg', category: 'filament', sub: 'PLA' });
        await seedOrder(await seedUser(null, 'Meera'), [[pla, 1]], { daysAgo: 27 });
        await seedOrder(await seedUser(null, 'Later'), [[pla, 1]], { daysAgo: 5 });
        const result = await intel.runReorderDigest({ alert, frontendUrl: 'https://shop.example' });
        assert.equal(result.due, 1);
        assert.match(alerts[0], /^🧵 1 customer likely to need filament this week\n• Meera \(PLA\): runs out ~/);
        assert.match(alerts[0], /9876543210/);
    });

    it('leaves customers more than two weeks overdue out of the digest', async () => {
        const pla = await seedProduct({ name: 'PLA 1kg', category: 'filament', sub: 'PLA' });
        await seedOrder(await seedUser(null, 'Long gone'), [[pla, 1]], { daysAgo: 60 });
        const alerts = [];
        assert.equal((await intel.runReorderDigest({ alert: async (m) => alerts.push(m) })).due, 0);
        assert.equal((await intel.reorderPredictions()).customers.length, 1); // still on the admin list
    });

    it('keeps the reorder list for admins', async () => {
        assert.equal((await call('GET', '/api/leads/reorders')).status, 401);
        assert.equal((await call('GET', '/api/leads/reorders', { userId: await seedUser() })).status, 403);
        const res = await call('GET', '/api/leads/reorders', { userId: await seedUser('admin') });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { customers: [], buyers: 0, repeatBuyers: 0 });
    });
});
