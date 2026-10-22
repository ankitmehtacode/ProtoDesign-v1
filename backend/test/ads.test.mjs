// Google Ads, opt-in only, through the real Lambda entrypoint and a real
// Postgres: both consents recorded only when given and never rewritten, the
// conversions feed (who is in it, its exact format, its secret), and the
// hashed Customer Match file (consenting leads, verified contacts only).
//
//   tsx --test test/ads.test.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
const SECRET = 'feed-secret-0123456789abcdef';
Object.assign(process.env, {
    DATABASE_URL: pg.url,
    JWT_SECRET: 'test-jwt-secret',
    AWS_LAMBDA_FUNCTION_NAME: 'ads-test',
    ADS_FEED_SECRET: SECRET,
});

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const ads = await import('../src/services/ads.service.js');
const leads = await import('../src/services/leads.service.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

const call = async (method, path, { userId, body, query = '', headers = {}, contentType = 'application/json' } = {}) => {
    const h = { 'content-type': contentType, host: 'example.lambda-url.ap-southeast-1.on.aws', ...headers };
    if (userId) h.authorization = `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;
    const res = await handler({
        version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: query, headers: h,
        requestContext: { http: { method, path, sourceIp: '203.0.113.7' }, domainName: 'example' },
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        isBase64Encoded: false,
    }, {});
    const json = (res.headers?.['content-type'] || '').includes('json');
    return { status: res.statusCode, headers: res.headers, body: json && res.body ? JSON.parse(res.body) : res.body };
};
const beacon = (path, payload) => call('POST', path, { body: JSON.stringify(payload), contentType: 'text/plain;charset=UTF-8' });

let n = 0;
const seedUser = async (role) => {
    const id = (await db.one(`INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'P') RETURNING id`,
        [`p${++n}@test.local`])).id;
    if (role) await db.none('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
    return id;
};
const LEAD = { name: 'Asha', interest: 'printer', form: 'product_page', consent: true, consentVersion: 'lead-contact-v1' };
const sha = (s) => createHash('sha256').update(s).digest('hex');

beforeEach(async () => {
    await db.none('TRUNCATE ads_feed_fetches, product_alerts, whatsapp_contacts, visitor_events, visitors, leads, order_items, orders, user_roles, users CASCADE');
});

describe('consent', () => {
    const V = 'ads-measurement-v1';
    const events = [{ name: 'page_view', path: '/' }];
    const visit = (visitorId, attribution) => beacon('/api/track', { visitorId, events, attribution });
    const row = (id) => db.one('SELECT gclid, gclid_at, ads_consent_at, ads_consent_version FROM visitors WHERE id = $1', [id]);

    it('records ad measurement only when ticked, under known wording, for a visit from an ad', async () => {
        const [ok, noTick, noClick, noVersion] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        await visit(ok, { gclid: 'Cj0KCQjw-click-1', ads: true, adsVersion: V });
        await visit(noTick, { gclid: 'Cj0KCQjw-click-2' });
        await visit(noClick, { ads: true, adsVersion: V });
        await visit(noVersion, { gclid: 'Cj0KCQjw-click-3', ads: true });
        assert.equal((await row(ok)).ads_consent_version, V);
        assert.ok((await row(ok)).gclid_at);
        for (const id of [noTick, noClick, noVersion]) assert.equal((await row(id)).ads_consent_at, null);
    });

    it('stores only real click ids, so nothing else reaches Google\'s file', async () => {
        const v = randomUUID();
        await visit(v, { gclid: 'abc\r\nX,ProtoDesign purchase,2026-10-20 10:00:00,999999,INR', ads: true, adsVersion: V });
        assert.deepEqual(await row(v), { gclid: null, gclid_at: null, ads_consent_at: null, ads_consent_version: null });
    });

    it('lets the choice change later, and only for a visit from an ad', async () => {
        const v = randomUUID();
        await visit(v, { gclid: 'Cj0KCQjw-click-1' });
        assert.equal((await beacon('/api/track/ads', { visitorId: v, granted: true })).status, 400); // no version
        assert.equal((await beacon('/api/track/ads', { visitorId: v, granted: true, version: V })).status, 204);
        assert.equal((await row(v)).ads_consent_version, V);
        await beacon('/api/track/ads', { visitorId: v, granted: false });
        assert.equal((await row(v)).ads_consent_at, null);

        await db.none('UPDATE visitors SET gclid = NULL');
        await beacon('/api/track/ads', { visitorId: v, granted: true, version: V });
        assert.equal((await row(v)).ads_consent_at, null);
    });

    it('takes a returning visitor\'s new ad click with that visit\'s own answer', async () => {
        const v = randomUUID();
        await visit(v, { utm_source: 'newsletter' }); // first visit, not from an ad
        await visit(v, { gclid: 'Cj0KCQjw-click-1', ads: true, adsVersion: V });
        assert.equal((await row(v)).gclid, 'Cj0KCQjw-click-1');
        assert.ok((await row(v)).ads_consent_at);
        // The same click in a second tab cannot take the consent away...
        await visit(v, { gclid: 'Cj0KCQjw-click-1' });
        assert.ok((await row(v)).ads_consent_at);
        // ...but a new click starts unconsented until that visit says yes.
        await visit(v, { gclid: 'Cj0KCQjw-click-2' });
        assert.deepEqual([(await row(v)).gclid, (await row(v)).ads_consent_at], ['Cj0KCQjw-click-2', null]);
        assert.equal((await db.one('SELECT source FROM visitors')).source, 'newsletter'); // first touch kept
    });

    it('stores the Customer Match consent with its wording, ignoring a forged version', async () => {
        await call('POST', '/api/leads', { body: { ...LEAD, phone: '9876543211', adsConsent: true, adsConsentVersion: 'made-up' } });
        assert.equal((await db.one('SELECT ads_consented_at FROM leads')).ads_consented_at, null);
        await call('POST', '/api/leads', { body: { ...LEAD, phone: '9876543210', adsConsent: true, adsConsentVersion: 'lead-ads-v1' } });
        const { ads_consent_text: text } = await db.one(`SELECT ads_consent_text FROM leads WHERE phone = '919876543210'`);
        assert.equal(text, leads.ADS_CONSENT_TEXTS['lead-ads-v1']);
    });

    it('lets no one else opt an existing lead in by typing their number, and never rewrites a consent', async () => {
        await call('POST', '/api/leads', { body: { ...LEAD, phone: '9876543210' } });
        await call('POST', '/api/leads', { body: { ...LEAD, phone: '9876543210', adsConsent: true, adsConsentVersion: 'lead-ads-v1' } });
        assert.equal((await db.one('SELECT ads_consented_at FROM leads')).ads_consented_at, null);

        // The signed-in account the lead belongs to may, once.
        const owner = await seedUser();
        await db.none('UPDATE leads SET user_id = $1', [owner]);
        const optIn = { userId: owner, body: { ...LEAD, phone: '9876543210', adsConsent: true, adsConsentVersion: 'lead-ads-v1' } };
        await call('POST', '/api/leads', optIn);
        const first = await db.one('SELECT ads_consent_text, ads_consented_at FROM leads');
        assert.ok(first.ads_consented_at);
        await call('POST', '/api/leads', optIn);
        assert.deepEqual(await db.one('SELECT ads_consent_text, ads_consented_at FROM leads'), first);
    });

    it('can be withdrawn by the admin on request', async () => {
        await call('POST', '/api/leads', { body: { ...LEAD, phone: '9876543210', adsConsent: true, adsConsentVersion: 'lead-ads-v1' } });
        const { id } = await db.one('SELECT id FROM leads');
        const res = await call('PATCH', `/api/leads/admin/${id}`, { userId: await seedUser('admin'), body: { withdraw_ads: true } });
        assert.equal(res.status, 200);
        assert.deepEqual(await db.one('SELECT ads_consent_text, ads_consented_at FROM leads'), { ads_consent_text: null, ads_consented_at: null });
    });
});

describe('conversions feed', () => {
    const visitor = async ({ gclid = 'CLICK', consent = true, userId = null, leadId = null, daysAgo = 3 } = {}) => {
        const id = randomUUID();
        await db.none(`INSERT INTO visitors (id, gclid, ads_consent_at, user_id, lead_id, first_seen_at)
                       VALUES ($1, $2, CASE WHEN $3 THEN now() END, $4, $5, now() - make_interval(days => $6))`,
            [id, gclid, consent, userId, leadId, daysAgo]);
        return id;
    };
    const lead = async (daysAgo = 1) => (await db.one(
        `INSERT INTO leads (phone, interest, form, consent_text, created_at) VALUES ($1, 'printer', 'product_page', 'x', now() - make_interval(days => $2)) RETURNING id`,
        [`9198${String(++n).padStart(8, '0')}`, daysAgo])).id;
    const order = async (userId, { status = 'processing', paid = true, daysAgo = 1, total = 45999 } = {}) => db.none(
        `INSERT INTO orders (user_id, subtotal_amount, tax_amount, shipping_amount, total_amount, status, payment_status, created_at, updated_at)
         VALUES ($1, $2, 0, 0, $2, $3, $4, now() - make_interval(days => $5), now() - make_interval(days => $5))`,
        [userId, total, status, paid ? 'paid' : 'pending', daysAgo]);

    it('lists only consenting ad visitors\' enquiries and paid orders, within the click window', async () => {
        await visitor({ gclid: 'LEAD-OK', leadId: await lead() });
        await visitor({ gclid: 'LEAD-NO-CONSENT', consent: false, leadId: await lead() });
        await visitor({ gclid: null, leadId: await lead() });
        await visitor({ gclid: 'LEAD-OLD', leadId: await lead(10), daysAgo: 12 }); // outside the 7-day feed
        const buyer = await seedUser();
        await visitor({ gclid: 'ORDER-OK', userId: buyer });
        await order(buyer);
        await order(buyer, { status: 'pending', paid: false });
        await order(buyer, { status: 'cancelled' }); // paid after it was cancelled: a refund, not a sale
        await order(buyer, { status: 'refunded' }); // paid back: not a sale
        const late = await seedUser();
        await visitor({ gclid: 'ORDER-LATE', userId: late, daysAgo: 95 }); // click over 90 days before the order
        await order(late);

        const rows = await ads.conversions();
        assert.deepEqual(rows.map((r) => [r.gclid, r.name, r.value]).sort(),
            [['LEAD-OK', 'ProtoDesign lead', null], ['ORDER-OK', 'ProtoDesign purchase', 45999]]);
        assert.match(rows[0].time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('gives the conversion time in India time, matching the TimeZone row', async () => {
        const id = await lead();
        await db.none(`UPDATE leads SET created_at = date_trunc('day', now()) - interval '1 day' + interval '20 hours 15 minutes' WHERE id = $1`, [id]);
        await visitor({ gclid: 'TZ', leadId: id });
        const { created_at: utc } = await db.one('SELECT created_at::text FROM leads WHERE id = $1', [id]);
        const [row] = await ads.conversions();
        // 20:15 UTC is 01:45 the next day in India.
        assert.match(utc, / 20:15:00$/);
        assert.match(row.time, / 01:45:00$/);
    });

    it('counts cash on delivery once delivered, and a late-confirmed order still makes the feed', async () => {
        const cod = await seedUser();
        await visitor({ gclid: 'COD-CLICK', userId: cod, daysAgo: 20 });
        await order(cod, { status: 'processing', paid: false, daysAgo: 12, total: 1500 });
        assert.equal((await ads.conversions()).length, 0); // not delivered yet
        await db.none(`UPDATE orders SET status = 'delivered', updated_at = now()`);
        const [row] = await ads.conversions();
        assert.deepEqual([row.gclid, row.name, row.value], ['COD-CLICK', 'ProtoDesign purchase', 1500]);
    });

    it('is written in Google\'s import format', () => {
        const csv = ads.conversionsCsv([
            { gclid: 'A', name: 'ProtoDesign lead', time: '2026-10-20 18:04:05', value: null },
            { gclid: 'B', name: 'ProtoDesign purchase', time: '2026-10-21 09:00:00', value: 45999 },
        ]);
        assert.equal(csv, 'Parameters:TimeZone=Asia/Kolkata\n'
            + 'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency\n'
            + 'A,ProtoDesign lead,2026-10-20 18:04:05,,\n'
            + 'B,ProtoDesign purchase,2026-10-21 09:00:00,45999,INR\n');
    });

    it('is served only with the secret, and each fetch is recorded', async () => {
        await visitor({ gclid: 'LEAD-OK', leadId: await lead() });
        assert.equal((await call('GET', '/api/ads/conversions.csv')).status, 401);
        assert.equal((await call('GET', '/api/ads/conversions.csv', { query: 'key=wrong' })).status, 401);

        const basic = `Basic ${Buffer.from(`google:${SECRET}`).toString('base64')}`;
        const res = await call('GET', '/api/ads/conversions.csv', { headers: { authorization: basic } });
        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /^text\/csv/);
        assert.match(res.body, /^Parameters:TimeZone=Asia\/Kolkata\n.*\nLEAD-OK,ProtoDesign lead,/s);
        assert.equal((await call('GET', '/api/ads/conversions.csv', { query: `key=${SECRET}` })).status, 200);
        const lower = `basic ${Buffer.from(`google:${SECRET}`).toString('base64')}`;
        assert.equal((await call('GET', '/api/ads/conversions.csv', { headers: { authorization: lower } })).status, 200);
        assert.equal(ads.conversionsCsv([{ gclid: 'a\rb', name: 'n', time: 't', value: null }]).split('\n')[2], '"a\rb",n,t,,');
        assert.equal((await db.one('SELECT count(*)::int AS n FROM ads_feed_fetches')).n, 3);
    });

    it('does not exist while the secret is unset or too short', async () => {
        const saved = process.env.ADS_FEED_SECRET;
        try {
            process.env.ADS_FEED_SECRET = 'short';
            assert.equal((await call('GET', '/api/ads/conversions.csv', { query: 'key=short' })).status, 404);
            delete process.env.ADS_FEED_SECRET;
            assert.equal((await call('GET', '/api/ads/conversions.csv')).status, 404);
        } finally {
            process.env.ADS_FEED_SECRET = saved;
        }
    });
});

describe('Customer Match', () => {
    const consented = async ({ phone, email, interest = 'printer', ads: ok = true }) => (await db.one(
        `INSERT INTO leads (phone, email, interest, form, consent_text, ads_consent_text, ads_consented_at)
         VALUES ($1, $2, $3, 'product_page', 'x', CASE WHEN $4 THEN 'y' END, CASE WHEN $4 THEN now() - interval '3 days' END) RETURNING id`,
        [phone, email, interest, ok])).id;
    /** An inbound WhatsApp message from `waId`, `daysAgo` days ago. */
    const messaged = async (waId, daysAgo = 1) => {
        const { id } = await db.one(
            `INSERT INTO whatsapp_contacts (wa_id, last_inbound_at) VALUES ($1, now())
             ON CONFLICT (wa_id) DO UPDATE SET last_inbound_at = now() RETURNING id`, [waId]);
        await db.none(`INSERT INTO whatsapp_messages (contact_id, direction, message_type, status, created_at)
                       VALUES ($1, 'inbound', 'text', 'received', now() - make_interval(days => $2))`, [id, daysAgo]);
    };

    it('normalises like Google before hashing', () => {
        assert.equal(ads.normalizeEmail('  Ravi.Kumar@Gmail.com '), 'ravikumar@gmail.com');
        assert.equal(ads.normalizeEmail('ravi.kumar@outlook.com'), 'ravi.kumar@outlook.com');
        assert.equal(ads.normalizePhone('919876543210'), '+919876543210');
        assert.equal(ads.normalizePhone('12'), null);
    });

    it('includes only opted-in leads, and only contact details proved after opting in', async () => {
        await consented({ phone: '919876543210', email: 'Ravi.Kumar@gmail.com' });
        await consented({ phone: '919800000002', email: 'unverified@example.com' });
        await consented({ phone: '919800000003', ads: false });
        await consented({ phone: '919800000004', interest: 'filament' });
        await consented({ phone: '919800000005' });
        await messaged('919876543210');
        await messaged('919800000003');
        await messaged('919800000004');
        await messaged('919800000005', 10); // only before the opt-in: someone else may have ticked it
        await db.none(`INSERT INTO products (id, name, price, category) VALUES ('00000000-0000-4000-8000-000000000001', 'P', 1, 'filament')`);
        await db.none(`INSERT INTO product_alerts (product_id, email, kind, baseline_price, token, consent_text, confirmed_at)
                       VALUES ('00000000-0000-4000-8000-000000000001', 'ravi.kumar@gmail.com', 'back_in_stock', 1, 't', 'x', now()),
                              ('00000000-0000-4000-8000-000000000001', 'unverified@example.com', 'price_drop', 1, 't2', 'x', now() - interval '30 days')`);

        const rows = await ads.customerMatchRows();
        assert.deepEqual(rows, [
            { email: sha('ravikumar@gmail.com'), phone: sha('+919876543210') },
            { email: '', phone: sha('+919800000004') },
        ]);
        assert.equal((await ads.customerMatchRows({ interest: 'filament' })).length, 1);

        // A number that sent STOP on WhatsApp is left out.
        await db.none(`UPDATE whatsapp_contacts SET opted_out_at = now() WHERE wa_id = '919800000004'`);
        assert.equal((await ads.customerMatchRows()).length, 1);
    });

    it('is an admin-only download, beside the feed status', async () => {
        await consented({ phone: '919876543210' });
        await messaged('919876543210');
        assert.equal((await call('GET', '/api/leads/ads/customer-match.csv')).status, 401);
        assert.equal((await call('GET', '/api/leads/ads', { userId: await seedUser() })).status, 403);

        const admin = await seedUser('admin');
        const file = await call('GET', '/api/leads/ads/customer-match.csv', { userId: admin, query: 'interest=printer' });
        assert.equal(file.status, 200);
        assert.equal(file.body, `Email,Phone\n,${sha('+919876543210')}\n`);

        const status = await call('GET', '/api/leads/ads', { userId: admin });
        assert.equal(status.body.feedEnabled, true);
        assert.equal(status.body.match_consented, 1);
        assert.equal(status.body.matchRows, 1);
        assert.equal(status.body.lastFetch, null);
    });
});

describe('maintenance', () => {
    it('prunes old feed fetch records', async () => {
        await db.none(`INSERT INTO ads_feed_fetches (fetched_at, conversions) VALUES (now() - interval '61 days', 1), (now(), 2)`);
        const result = await leads.runLeadMaintenance();
        assert.equal(result.adsFetchesDeleted, 1);
    });
});
