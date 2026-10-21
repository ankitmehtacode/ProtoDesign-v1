// Visit tracking and lead capture through the real Lambda entrypoint, against
// a real Postgres: beacon parsing, first-touch attribution, the storage caps,
// lead de-duplication and its link to earlier visits, the admin endpoints,
// erasure, and the daily prune.
//
//   tsx --test test/leads.test.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'leads-test';

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const leads = await import('../src/services/leads.service.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

const call = async (method, path, { userId, body, contentType = 'application/json', ip = '203.0.113.7' } = {}) => {
    const headers = { 'content-type': contentType, host: 'example.lambda-url.ap-southeast-1.on.aws' };
    if (userId) headers.authorization = `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;
    const res = await handler({
        version: '2.0',
        routeKey: '$default',
        rawPath: path,
        rawQueryString: '',
        headers,
        requestContext: { http: { method, path, sourceIp: ip }, domainName: 'example' },
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        isBase64Encoded: false,
    }, {});
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

const beacon = (payload) => call('POST', '/api/track', { body: JSON.stringify(payload), contentType: 'text/plain;charset=UTF-8' });

let n = 0;
const seedUser = async (role) => {
    const id = (await db.one(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Person') RETURNING id`,
        [`person${++n}@test.local`])).id;
    if (role) await db.none('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
    return id;
};
const seedProduct = async (category = '3d_printer') => (await db.one(
    `INSERT INTO products (name, price, category) VALUES ('Bambu A1', 30000, $1) RETURNING id`, [category])).id;

const lead = (over = {}) => ({
    name: 'Asha', phone: '98765 43210', interest: 'printer', form: 'product_page',
    consent: true, consentVersion: 'lead-contact-v1', ...over,
});

beforeEach(async () => {
    await db.none('TRUNCATE visitor_events, visitors, leads CASCADE');
    delete process.env.TRACKING_DAILY_EVENT_CAP;
    delete process.env.LEADS_DAILY_CAP;
});

describe('classifySource', () => {
    const c = leads.classifySource;
    it('credits a Google Ads click to google / cpc', () => {
        assert.deepEqual([c({ gclid: 'abc', referrer_host: 'google.com' }).source, c({ gclid: 'abc' }).medium], ['google', 'cpc']);
    });
    it('prefers UTM tags over the referrer', () => {
        const t = c({ utm_source: 'Instagram', utm_medium: 'Story', utm_campaign: 'diwali', referrer_host: 'l.instagram.com' });
        assert.deepEqual([t.source, t.medium, t.campaign], ['instagram', 'story', 'diwali']);
    });
    it('sorts referrers into organic search, AI assistants, social and referral', () => {
        assert.deepEqual(c({ referrer_host: 'www.google.co.in' }), { ...c({ referrer_host: 'google.co.in' }) });
        assert.equal(c({ referrer_host: 'www.google.co.in' }).medium, 'organic');
        assert.equal(c({ referrer_host: 'search.yahoo.com' }).source, 'yahoo');
        assert.deepEqual([c({ referrer_host: 'gemini.google.com' }).source, c({ referrer_host: 'chatgpt.com' }).medium], ['gemini', 'ai']);
        assert.deepEqual([c({ referrer_host: 'm.facebook.com' }).source, c({ referrer_host: 't.co' }).medium], ['facebook', 'social']);
        assert.deepEqual([c({ referrer_host: 'blog.example.in' }).source, c({ referrer_host: 'blog.example.in' }).medium], ['blog.example.in', 'referral']);
        assert.deepEqual([c({}).source, c({}).medium], ['direct', 'none']);
    });
    it('does not count other Google services or look-alike hosts as search', () => {
        assert.equal(c({ referrer_host: 'mail.google.com' }).medium, 'referral');
        assert.equal(c({ referrer_host: 'google.evil.example' }).medium, 'referral');
    });
    it('keeps only on-site landing paths, without query strings that may hold secrets', () => {
        assert.equal(c({ landing_path: '/reset-password?token=secret#x' }).landing_path, '/reset-password');
        assert.equal(c({ landing_path: 'https://evil.example/' }).landing_path, null);
        assert.equal(c({ landing_path: '//evil.example/' }).landing_path, null);
    });
});

describe('normalizePhone', () => {
    it('turns the ways Indians type a mobile number into E.164 digits', () => {
        for (const raw of ['9876543210', '98765 43210', '+91 98765-43210', '09876543210', '919876543210']) {
            assert.equal(leads.normalizePhone(raw), '919876543210', raw);
        }
        assert.equal(leads.normalizePhone('+44 7700 900123'), '447700900123');
    });
    it('rejects numbers that cannot be an Indian mobile', () => {
        for (const raw of ['12345', '5876543210', '+91 1234567890', 'call me']) {
            assert.throws(() => leads.normalizePhone(raw), /valid/, raw);
        }
    });
});

describe('POST /api/track', () => {
    it('creates the visitor with first-touch attribution and stores the events', async () => {
        const visitorId = randomUUID();
        const productId = await seedProduct();
        const res = await beacon({
            visitorId,
            attribution: { referrer_host: 'www.google.com', landing_path: '/printers' },
            events: [{ name: 'page_view', path: '/printers' }, { name: 'product_view', path: '/product/a1', productId }],
        });
        assert.equal(res.status, 204);

        // A later visit from Instagram does not overwrite how they first arrived.
        await beacon({ visitorId, attribution: { utm_source: 'instagram' }, events: [{ name: 'page_view', path: '/' }] });

        const v = await db.one('SELECT * FROM visitors WHERE id = $1', [visitorId]);
        assert.deepEqual([v.source, v.medium, v.landing_path], ['google', 'organic', '/printers']);
        const events = await db.any('SELECT name, product_id FROM visitor_events WHERE visitor_id = $1 ORDER BY id', [visitorId]);
        assert.deepEqual(events.map((e) => e.name), ['page_view', 'product_view', 'page_view']);
        assert.equal(events[1].product_id, productId);
    });

    it('drops unknown event names and stores an unknown product as NULL', async () => {
        const visitorId = randomUUID();
        await beacon({ visitorId, events: [{ name: 'drop_table' }, { name: 'product_view', productId: randomUUID() }] });
        const events = await db.any('SELECT name, product_id FROM visitor_events WHERE visitor_id = $1', [visitorId]);
        assert.deepEqual(events, [{ name: 'product_view', product_id: null }]);
    });

    it('never stores a query string, so a reset token in the URL cannot leak', async () => {
        const visitorId = randomUUID();
        await beacon({ visitorId, attribution: { landing_path: '/reset-password?token=abc' },
            events: [{ name: 'page_view', path: '/reset-password?token=abc' }] });
        const rows = await db.any(`SELECT v.landing_path, e.path FROM visitors v JOIN visitor_events e ON e.visitor_id = v.id`);
        assert.deepEqual(rows, [{ landing_path: '/reset-password', path: '/reset-password' }]);
    });

    it('rejects a malformed body, a bad visitor id and oversized batches', async () => {
        assert.equal((await call('POST', '/api/track', { body: '{nope', contentType: 'text/plain' })).status, 400);
        for (const body of ['null', '5', '"x"', '[]']) {
            assert.equal((await call('POST', '/api/track', { body, contentType: 'text/plain' })).status, 400, body);
        }
        assert.equal((await beacon({ visitorId: 'x', events: [{ name: 'page_view' }] })).status, 400);
        const many = Array.from({ length: 21 }, () => ({ name: 'page_view' }));
        assert.equal((await beacon({ visitorId: randomUUID(), events: many })).status, 400);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM visitors')).n, 0);
    });

    it('stops storing once the daily cap is reached', async () => {
        process.env.TRACKING_DAILY_EVENT_CAP = '3';
        const visitorId = randomUUID();
        await beacon({ visitorId, events: [{ name: 'page_view' }, { name: 'page_view' }] });
        const res = await beacon({ visitorId, events: [{ name: 'page_view' }, { name: 'page_view' }] });
        assert.equal(res.status, 204);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM visitor_events')).n, 2);
    });

    it('caps new visitor ids per network per day, but not returning ones', async () => {
        const known = randomUUID();
        await beacon({ visitorId: known, events: [{ name: 'page_view' }] });
        for (let i = 0; i < 99; i++) await beacon({ visitorId: randomUUID(), events: [{ name: 'page_view' }] });
        await beacon({ visitorId: randomUUID(), events: [{ name: 'page_view' }] });
        assert.equal((await db.one('SELECT count(*)::int AS n FROM visitors')).n, 100);
        await beacon({ visitorId: known, events: [{ name: 'page_view' }] });
        assert.equal((await db.one('SELECT count(*)::int AS n FROM visitor_events WHERE visitor_id = $1', [known])).n, 2);
        // Another network is unaffected.
        await call('POST', '/api/track', { body: JSON.stringify({ visitorId: randomUUID(), events: [{ name: 'page_view' }] }),
            contentType: 'text/plain', ip: '198.51.100.9' });
        assert.equal((await db.one('SELECT count(*)::int AS n FROM visitors')).n, 101);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM visitors WHERE ip_hash IS NULL')).n, 0);
    });

    it('deletes a browser’s visits when the visitor withdraws consent', async () => {
        const visitorId = randomUUID();
        await beacon({ visitorId, events: [{ name: 'page_view' }] });
        const res = await call('POST', '/api/track/forget', { body: JSON.stringify({ visitorId }), contentType: 'text/plain' });
        assert.equal(res.status, 204);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM visitor_events')).n, 0);
    });

    it('links a signed-in customer to their browser, once', async () => {
        const visitorId = randomUUID();
        await beacon({ visitorId, events: [{ name: 'page_view' }] });
        const [first, second] = [await seedUser(), await seedUser()];
        assert.equal((await call('POST', '/api/track/identify', { userId: first, body: { visitorId } })).status, 204);
        await call('POST', '/api/track/identify', { userId: second, body: { visitorId } });
        assert.equal((await db.one('SELECT user_id FROM visitors WHERE id = $1', [visitorId])).user_id, first);
        assert.equal((await call('POST', '/api/track/identify', { body: { visitorId } })).status, 401);
    });
});

describe('POST /api/leads', () => {
    it('stores a lead with the server-side consent wording and the visitor’s first touch', async () => {
        const visitorId = randomUUID();
        const productId = await seedProduct();
        await beacon({ visitorId, attribution: { gclid: 'g-1', utm_campaign: 'a1-launch' }, events: [{ name: 'product_view', productId }] });

        const res = await call('POST', '/api/leads', { body: lead({ visitorId, productId, consentText: 'I agree to anything' }) });
        assert.equal(res.status, 201);

        const row = await db.one('SELECT * FROM leads');
        assert.equal(row.phone, '919876543210');
        assert.equal(row.consent_text, leads.CONSENT_TEXTS['lead-contact-v1']);
        assert.deepEqual([row.source, row.medium, row.campaign, row.gclid], ['google', 'cpc', 'a1-launch', 'g-1']);
        assert.equal(row.product_id, productId);
        assert.equal((await db.one('SELECT lead_id FROM visitors WHERE id = $1', [visitorId])).lead_id, row.id);
        const names = (await db.any('SELECT name FROM visitor_events WHERE visitor_id = $1 ORDER BY id', [visitorId])).map((e) => e.name);
        assert.deepEqual(names, ['product_view', 'lead_submit']);
    });

    it('matches on email when the phone is new, and never rewrites the original consent', async () => {
        await call('POST', '/api/leads', { body: lead({ phone: '', email: 'asha@example.in' }) });
        const before = await db.one('SELECT consented_at, consent_text FROM leads');
        await new Promise((r) => setTimeout(r, 20));
        await call('POST', '/api/leads', { body: lead({ phone: '9123456780', email: 'ASHA@example.in' }) });

        const rows = await db.any('SELECT * FROM leads');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].phone, '919123456780');
        assert.equal(rows[0].submissions, 2);
        assert.deepEqual([rows[0].consented_at, rows[0].consent_text], [before.consented_at, before.consent_text]);
    });

    it('caps new leads per network per day, and Telegram alerts per hour', async () => {
        const phones = Array.from({ length: 11 }, (_, i) => `98000000${String(i).padStart(2, '0')}`);
        const statuses = [];
        for (const phone of phones) statuses.push((await call('POST', '/api/leads', { body: lead({ phone }) })).status);
        assert.deepEqual(statuses, [...Array(10).fill(201), 503]);
        const res = await leads.captureLead(leads.validateLead(lead({ phone: '9811111111' })), { ipHash: 'other-network' });
        assert.equal(res.alert, false, 'the 11th new lead within an hour is stored without an alert');
    });

    it('merges a repeat enquiry from the same number instead of duplicating it', async () => {
        await call('POST', '/api/leads', { body: lead({ message: 'Price for A1?' }) });
        await db.none(`UPDATE leads SET status = 'lost'`);
        await call('POST', '/api/leads', { body: lead({ phone: '+91 98765 43210', name: 'Someone else', email: 'asha@example.in', interest: 'filament' }) });

        const rows = await db.any('SELECT * FROM leads');
        assert.equal(rows.length, 1);
        assert.deepEqual([rows[0].name, rows[0].email, rows[0].interest, rows[0].message, rows[0].submissions, rows[0].status],
            ['Asha', 'asha@example.in', 'filament', 'Price for A1?', 2, 'new']);
    });

    it('requires consent and a way to reach the person', async () => {
        assert.equal((await call('POST', '/api/leads', { body: lead({ consent: false }) })).status, 400);
        assert.equal((await call('POST', '/api/leads', { body: lead({ consentVersion: 'made-up' }) })).status, 400);
        assert.equal((await call('POST', '/api/leads', { body: lead({ phone: '' }) })).status, 400);
        assert.equal((await call('POST', '/api/leads', { body: lead({ phone: '', email: 'not-an-email' }) })).status, 400);
        assert.equal((await call('POST', '/api/leads', { body: lead({ phone: '', email: 'ok@example.in' }) })).status, 201);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM leads')).n, 1);
    });

    it('pretends to accept a bot that fills the honeypot, and stores nothing', async () => {
        const res = await call('POST', '/api/leads', { body: lead({ website: 'http://spam.example' }) });
        assert.equal(res.status, 201);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM leads')).n, 0);
    });

    it('refuses new leads past the daily cap but still updates known ones', async () => {
        process.env.LEADS_DAILY_CAP = '1';
        assert.equal((await call('POST', '/api/leads', { body: lead() })).status, 201);
        assert.equal((await call('POST', '/api/leads', { body: lead({ phone: '9123456780' }) })).status, 503);
        assert.equal((await call('POST', '/api/leads', { body: lead({ message: 'again' }) })).status, 201);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM leads')).n, 1);
    });
});

describe('admin endpoints', () => {
    it('are for admins only', async () => {
        const customer = await seedUser();
        assert.equal((await call('GET', '/api/leads/admin')).status, 401);
        assert.equal((await call('GET', '/api/leads/admin', { userId: customer })).status, 403);
    });

    it('report channels with their lead counts, the lead list and one lead’s journey', async () => {
        const admin = await seedUser('admin');
        const productId = await seedProduct();
        const [a, b] = [randomUUID(), randomUUID()];
        await beacon({ visitorId: a, attribution: { referrer_host: 'google.com', landing_path: '/printers' },
            events: [{ name: 'page_view', path: '/printers' }, { name: 'product_view', productId }] });
        await beacon({ visitorId: b, attribution: { referrer_host: 'google.com' }, events: [{ name: 'page_view', path: '/' }] });
        await call('POST', '/api/leads', { body: lead({ visitorId: a, productId }) });

        const { status, body } = await call('GET', '/api/leads/admin', { userId: admin });
        assert.equal(status, 200);
        assert.deepEqual(body.channels, [{ source: 'google', medium: 'organic', visitors: 2, leads: 1 }]);
        assert.deepEqual([body.totals.visitors_30d, body.totals.leads_30d, body.totals.converted_30d, body.totals.leads_new], [2, 1, 1, 1]);
        assert.equal(body.products[0].views, 1);
        assert.equal(body.leads[0].product_name, 'Bambu A1');
        assert.equal(body.leads[0].product_views, 1);
        assert.ok(body.storage.bytes > 0);

        const detail = await call('GET', `/api/leads/admin/${body.leads[0].id}`, { userId: admin });
        assert.deepEqual(detail.body.events.map((e) => e.name), ['page_view', 'product_view', 'lead_submit']);
        assert.equal((await call('GET', `/api/leads/admin/${randomUUID()}`, { userId: admin })).status, 404);
    });

    it('show a lead only the orders of its linked account, not of whoever owns its typed email', async () => {
        const admin = await seedUser('admin');
        const customer = await seedUser();
        const { email } = await db.one('SELECT email FROM users WHERE id = $1', [customer]);
        await db.none(`INSERT INTO orders (user_id, subtotal_amount, tax_amount, shipping_amount, total_amount, status)
                       VALUES ($1, 10, 0, 0, 10, 'delivered')`, [customer]);
        await call('POST', '/api/leads', { body: lead({ phone: '', email }) });
        const { id } = await db.one('SELECT id FROM leads');
        assert.deepEqual((await call('GET', `/api/leads/admin/${id}`, { userId: admin })).body.orders, []);

        await call('POST', '/api/leads', { userId: customer, body: lead({ phone: '', email }) });
        assert.equal((await call('GET', `/api/leads/admin/${id}`, { userId: admin })).body.orders.length, 1);
    });

    it('update status and notes, and reject an unknown status', async () => {
        const admin = await seedUser('admin');
        await call('POST', '/api/leads', { body: lead() });
        const { id } = await db.one('SELECT id FROM leads');

        const res = await call('PATCH', `/api/leads/admin/${id}`, { userId: admin, body: { status: 'contacted', admin_notes: 'Wants EMI' } });
        assert.deepEqual(res.body, { id, status: 'contacted', admin_notes: 'Wants EMI' });
        // Notes left out of the request are kept.
        await call('PATCH', `/api/leads/admin/${id}`, { userId: admin, body: { status: 'qualified' } });
        assert.equal((await db.one('SELECT admin_notes FROM leads')).admin_notes, 'Wants EMI');
        assert.equal((await call('PATCH', `/api/leads/admin/${id}`, { userId: admin, body: { status: 'vip' } })).status, 400);
    });

    it('erase a lead with its anonymous visits on request', async () => {
        const admin = await seedUser('admin');
        const visitorId = randomUUID();
        await beacon({ visitorId, events: [{ name: 'page_view' }] });
        await call('POST', '/api/leads', { body: lead({ visitorId }) });
        const { id } = await db.one('SELECT id FROM leads');

        assert.equal((await call('DELETE', `/api/leads/admin/${id}`, { userId: admin })).status, 204);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM leads')).n, 0);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM visitor_events')).n, 0);
    });
});

describe('daily maintenance', () => {
    it('deletes idle anonymous visitors and old events, keeps leads’ recent visits, and alerts on size', async () => {
        const [idle, known] = [randomUUID(), randomUUID()];
        await beacon({ visitorId: idle, events: [{ name: 'page_view' }] });
        await beacon({ visitorId: known, events: [{ name: 'page_view' }] });
        await call('POST', '/api/leads', { body: lead({ visitorId: known }) });
        await db.none(`UPDATE visitors SET last_seen_at = now() - interval '31 days'`);
        await db.none(`INSERT INTO visitor_events (visitor_id, name, created_at) VALUES ($1, 'page_view', now() - interval '200 days')`, [known]);

        const alerts = [];
        process.env.STORAGE_ALERT_BYTES = '1';
        const result = await handler({ source: leads.MAINTENANCE_EVENT_SOURCE }, {});
        delete process.env.STORAGE_ALERT_BYTES;

        assert.equal(result.visitorsDeleted, 1);
        assert.equal(result.eventsDeleted, 1);
        assert.deepEqual((await db.any('SELECT id FROM visitors')).map((v) => v.id), [known]);
        assert.deepEqual((await db.any('SELECT name FROM visitor_events ORDER BY id')).map((e) => e.name), ['page_view', 'lead_submit']);

        await leads.runLeadMaintenance({ alert: async (text) => alerts.push(text) });
        assert.equal(alerts.length, 0, 'default threshold is far above a test database');
        process.env.STORAGE_ALERT_BYTES = '1';
        await leads.runLeadMaintenance({ alert: async (text) => alerts.push(text) });
        delete process.env.STORAGE_ALERT_BYTES;
        assert.match(alerts[0], /free tier/);
    });
});
