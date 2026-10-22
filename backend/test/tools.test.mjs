// The printer advisor, the filament estimator and product alerts through the
// real Lambda entrypoint, against a real Postgres: ranking from catalogue
// specs, the signed WhatsApp code delivering the server's own result and
// creating a lead with the verified number, alert subscription and the hourly
// sender (claimed once, released on a failed send), and unsubscribing.
//
//   tsx --test test/tools.test.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
const APP_SECRET = 'test-app-secret';
Object.assign(process.env, {
    DATABASE_URL: pg.url,
    JWT_SECRET: 'test-jwt-secret',
    AWS_LAMBDA_FUNCTION_NAME: 'tools-test',
    WHATSAPP_MODE: 'mock',
    WHATSAPP_BUSINESS_NUMBER: '918249581682',
    WHATSAPP_VERIFY_TOKEN: 'verify',
    META_APP_SECRET: APP_SECRET,
    FRONTEND_URL: 'https://shop.example',
    BACKEND_URL: 'https://api.example',
});

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const tools = await import('../src/services/tools.service.js');
const leads = await import('../src/services/leads.service.js');
const alerts = await import('../src/services/product-alerts.service.js');
const wa = await import('../src/services/whatsapp.service.js');
const { runWorker } = await import('../src/services/whatsapp.worker.js');
const { emailService } = await import('../src/services/email.service.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};
wa.dispatch.kick = async () => {};

let mail = [];
let mailFails = false;
const record = (type) => async (to, data) => {
    if (mailFails) throw new Error('smtp down');
    mail.push({ type, to, ...data });
};
emailService.sendAlertConfirmation = record('confirmation');
emailService.sendProductAlert = record('alert');
emailService.sendAdminAlert = async () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

const call = async (method, path, { body, headers = {}, ip = '203.0.113.7' } = {}) => {
    const res = await handler({
        version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '',
        headers: { 'content-type': 'application/json', host: 'example.lambda-url.ap-southeast-1.on.aws', ...headers },
        requestContext: { http: { method, path, sourceIp: ip }, domainName: 'example' },
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        isBase64Encoded: false,
    }, {});
    const json = (res.headers?.['content-type'] || '').includes('json');
    return { status: res.statusCode, body: json && res.body ? JSON.parse(res.body) : res.body };
};

const product = (over) => db.one(
    `INSERT INTO products (name, slug, price, stock, category, sub_category, specifications)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [over.name, over.slug ?? over.name.toLowerCase().replace(/\W+/g, '-'), over.price, over.stock ?? 5,
        over.category ?? '3d_printer', over.sub_category ?? 'FDM', JSON.stringify(over.specs ?? {})]
).then((r) => r.id);

beforeEach(async () => {
    await db.none('TRUNCATE product_alerts, tool_results, visitor_events, visitors, leads, whatsapp_messages, whatsapp_contacts, products CASCADE');
    mail = [];
    mailFails = false;
});

const seedPrinters = async () => ({
    budget: await product({ name: 'Starter One', price: 18000, specs: { 'Bed Levelling': 'Auto', 'Max Nozzle Temperature': '260' } }),
    hot: await product({ name: 'Forge Pro', price: 55000, specs: [{ key: 'Max Hotend Temperature:', value: '320 °C' }, { key: 'Build Volume', value: '256 x 256 x 256 mm' }] }),
    combo: await product({ name: 'Rainbow AMS Combo', price: 58000, specs: { 'Max Nozzle Temperature': '300' } }),
    resin: await product({ name: 'Mini Resin 8K', price: 25000, sub_category: 'SLA', specs: { Technology: 'MSLA' } }),
    big: await product({ name: 'Large XL', price: 45000, specs: { 'Build Size (mm)\t': '350*350*400', 'Max Nozzle Temperature': '280' } }),
    pen: await product({ name: 'Doodle Pen', price: 2000, sub_category: '3D Pen' }),
    gone: await product({ name: 'Sold Out Ultra', price: 20000, stock: 0, specs: { Technology: 'MSLA' }, sub_category: 'SLA' }),
});

describe('printer advisor', () => {
    const advise = async (inputs) => (await call('POST', '/api/tools/printer-advisor', { body: { inputs } })).body;

    it('ranks by what the answers need, from spec keys in any of their forms', async () => {
        const ids = await seedPrinters();
        const first = async (inputs) => (await advise(inputs)).result.picks[0].id;
        assert.equal(await first({ budget: '30k_60k', use: 'detail', material: 'pla' }), ids.resin);
        assert.equal(await first({ budget: '30k_60k', use: 'functional', material: 'engineering' }), ids.hot);
        assert.equal(await first({ budget: '30k_60k', use: 'multicolour', material: 'pla' }), ids.combo);
        assert.equal(await first({ budget: '30k_60k', use: 'large', material: 'petg_abs' }), ids.big);
        assert.equal(await first({ budget: 'under_30k', use: 'first_printer', material: 'pla' }), ids.budget);
    });

    it('keeps to the budget, never suggests pens or out-of-stock machines, and says when nothing fits', async () => {
        const ids = await seedPrinters();
        const { result } = await advise({ budget: 'under_30k', use: 'functional', material: 'pla' });
        assert.ok(result.picks.every((p) => p.price <= 30000));
        assert.ok(!result.picks.some((p) => [ids.pen, ids.gone].includes(p.id)));
        assert.equal(result.note, null);

        await db.none(`UPDATE products SET price = price + 40000`);
        const over = (await advise({ budget: 'under_30k', use: 'functional', material: 'pla' })).result;
        assert.equal(over.picks.length, 1);
        assert.match(over.note, /closest one above/);
    });

    it('rejects unknown answers', async () => {
        const res = await call('POST', '/api/tools/printer-advisor', { body: { inputs: { budget: 'free', use: 'detail', material: 'pla' } } });
        assert.equal(res.status, 400);
    });

    it('gives a code and wa.me link that delivers the server’s own result and makes a lead with the verified number', async () => {
        await seedPrinters();
        const visitorId = randomUUID();
        await call('POST', '/api/track', { body: JSON.stringify({ visitorId, events: [{ name: 'page_view', path: '/printer-advisor' }] }),
            headers: { 'content-type': 'text/plain' } });
        const out = (await call('POST', '/api/tools/printer-advisor',
            { body: { inputs: { budget: '30k_60k', use: 'detail', material: 'pla' }, visitorId } })).body;
        assert.match(out.code, /^A-[0-9A-F]{8}-[A-Z2-7]{8}$/);
        assert.equal(out.whatsappUrl, `https://wa.me/918249581682?text=${encodeURIComponent(`Send me my ProtoDesign printer picks: ${out.code}`)}`);

        const waId = '919812345678';
        await whatsappSays(waId, `Send me my ProtoDesign printer picks: ${out.code}`);

        const sent = await db.one(`SELECT body FROM whatsapp_messages WHERE direction = 'outbound' ORDER BY created_at DESC LIMIT 1`);
        assert.equal(sent.body, out.result.summary);
        const lead = await db.one('SELECT * FROM leads');
        assert.deepEqual([lead.phone, lead.interest, lead.form, lead.name], [waId, 'printer', 'printer_advisor', 'Asha']);
        assert.equal(lead.consent_text, leads.CONSENT_TEXTS['whatsapp-tool-v1']);
        const result = await db.one('SELECT lead_id, delivered_at FROM tool_results WHERE id = $1', [out.id]);
        assert.equal(result.lead_id, lead.id);
        assert.ok(result.delivered_at);
        assert.equal((await db.one('SELECT lead_id FROM visitors WHERE id = $1', [visitorId])).lead_id, lead.id);
    });

    it('answers a forged code with an apology, not someone’s words', async () => {
        await seedPrinters();
        const out = (await call('POST', '/api/tools/printer-advisor', { body: { inputs: { budget: '30k_60k', use: 'detail', material: 'pla' } } })).body;
        const forged = out.code.replace(/-[A-Z2-7]{8}$/, '-AAAAAAAA');
        await whatsappSays('919812345679', forged);
        const sent = await db.one(`SELECT body FROM whatsapp_messages WHERE direction = 'outbound' ORDER BY created_at DESC LIMIT 1`);
        assert.match(sent.body, /couldn't find that result/);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM leads')).n, 0);
    });

    it('accepts only its own answers, not object properties like toString, and 400s on a missing body', async () => {
        const bad = await call('POST', '/api/tools/printer-advisor',
            { body: { inputs: { budget: 'constructor', use: 'toString', material: 'hasOwnProperty' } } });
        assert.equal(bad.status, 400);
        assert.equal((await call('POST', '/api/tools/printer-advisor', { body: { inputs: null } })).status, 400);
        assert.equal((await call('POST', '/api/tools/filament-estimator', { body: { inputs: null } })).status, 400);
    });

    it('links only the first sender of a forwarded code to the visitor who ran the tool', async () => {
        await seedPrinters();
        const visitorId = randomUUID();
        await call('POST', '/api/track', { body: JSON.stringify({ visitorId, events: [{ name: 'page_view' }] }), headers: { 'content-type': 'text/plain' } });
        const out = (await call('POST', '/api/tools/printer-advisor',
            { body: { inputs: { budget: '30k_60k', use: 'detail', material: 'pla' }, visitorId } })).body;
        await whatsappSays('919812345601', out.code);
        await whatsappSays('919812345602', out.code); // a friend it was forwarded to

        const [first, friend] = await Promise.all(['919812345601', '919812345602'].map((p) => db.one('SELECT id FROM leads WHERE phone = $1', [p])));
        assert.equal((await db.one('SELECT lead_id FROM visitors WHERE id = $1', [visitorId])).lead_id, first.id);
        assert.equal((await db.one('SELECT lead_id FROM tool_results WHERE id = $1', [out.id])).lead_id, first.id);
        assert.notEqual(first.id, friend.id);
    });

    it('stops storing results past the daily cap across all networks', async () => {
        await seedPrinters();
        process.env.TOOL_RESULTS_DAILY_CAP = '1';
        try {
            const inputs = { budget: '30k_60k', use: 'detail', material: 'pla' };
            assert.equal((await call('POST', '/api/tools/printer-advisor', { body: { inputs } })).status, 200);
            assert.equal((await call('POST', '/api/tools/printer-advisor', { body: { inputs }, ip: '198.51.100.2' })).status, 429);
        } finally {
            delete process.env.TOOL_RESULTS_DAILY_CAP;
        }
    });

    it('caps results per network per day', async () => {
        await seedPrinters();
        const inputs = { budget: '30k_60k', use: 'detail', material: 'pla' };
        await db.none(`INSERT INTO tool_results (tool, inputs, result, ip_hash)
                       SELECT 'printer_advisor', '{}', '{}', $1 FROM generate_series(1, 60)`, [leads.ipHash('203.0.113.7')]);
        assert.equal((await call('POST', '/api/tools/printer-advisor', { body: { inputs } })).status, 429);
        assert.equal((await call('POST', '/api/tools/printer-advisor', { body: { inputs }, ip: '198.51.100.1' })).status, 200);
    });
});

describe('filament estimator', () => {
    it('prices monthly use from the cheapest spool per kg of that material', async () => {
        await product({ name: 'PETG Basic 1kg', price: 1200, category: 'filament', sub_category: 'PETG' });
        const cheap = await product({ name: 'PETG Value Pack', price: 2000, category: 'filament', sub_category: 'PETG', specs: { Weight: '2 kg' } });
        await product({ name: 'PLA 1kg', price: 500, category: 'filament', sub_category: 'PLA' });

        const { result } = (await call('POST', '/api/tools/filament-estimator',
            { body: { inputs: { material: 'PETG', printsPerWeek: 10, gramsPerPrint: 150 } } })).body;
        assert.equal(result.grams_per_month, 6500);
        assert.equal(result.pick.id, cheap);
        assert.equal(result.spools_per_month, 3.3);
        assert.equal(result.cost_per_month, 6500);
        assert.equal(result.bulk, true);
        assert.match(result.summary, /bulk order/);
    });

    it('rejects impossible inputs', async () => {
        const res = await call('POST', '/api/tools/filament-estimator',
            { body: { inputs: { material: 'PETG', printsPerWeek: 0, gramsPerPrint: 150 } } });
        assert.equal(res.status, 400);
    });

    it('reads spool weights from names and specs', () => {
        assert.equal(tools.spoolKg({ name: 'PLA 500g White' }), 0.5);
        assert.equal(tools.spoolKg({ name: 'Nylon', specifications: [{ key: 'Net weight', value: '1 KG' }] }), 1);
        assert.equal(tools.spoolKg({ name: 'PLA' }), null);
        assert.equal(tools.spoolKg({ name: 'PETG', specifications: { Density: '1.27 g/cm3', Weight: '1 kg' } }), 1);
    });
});

describe('product alerts', () => {
    const sub = (over, ip) => call('POST', '/api/alerts', { ip, body: {
        email: 'asha@example.in', consent: true, consentVersion: 'product-alert-v1', ...over } });
    const tokenOf = (m) => m.confirmUrl.split('/').pop();
    const confirmVia = (m) => call('POST', `/api/alerts/confirm/${tokenOf(m)}`, { body: '', headers: { 'content-type': 'application/x-www-form-urlencoded' } });

    it('sends only a confirmation until the owner confirms; the lead exists from then', async () => {
        const id = await product({ name: 'Sold Out Ultra', price: 20000, stock: 0 });
        assert.equal((await sub({ productId: id, kind: 'back_in_stock' })).status, 201);
        assert.equal((await sub({ productId: id, kind: 'back_in_stock', email: 'ASHA@example.in' })).status, 200);
        assert.equal(mail.length, 1, 'a repeat sign-up sends nothing');
        assert.match(mail[0].confirmUrl, /^https:\/\/api\.example\/api\/alerts\/confirm\/[A-Za-z0-9_-]{32}$/);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM leads')).n, 0);
        const mail0 = mail[0];

        await db.none('UPDATE products SET stock = 4');
        mail = [];
        assert.equal((await alerts.runProductAlerts()).sent, 0, 'unconfirmed alerts send nothing');

        // Opening the link (a mail scanner does) changes nothing; the button does.
        const page = await call('GET', `/api/alerts/confirm/${tokenOf(mail0)}`);
        assert.match(page.body, /<form method="post">/);
        assert.equal((await db.one('SELECT confirmed_at FROM product_alerts')).confirmed_at, null);
    });

    it('confirms by POST, records the lead with the now-verified address, and is idempotent', async () => {
        const id = await product({ name: 'Sold Out Ultra', price: 20000, stock: 0 });
        await sub({ productId: id, kind: 'back_in_stock' });
        assert.equal((await confirmVia(mail[0])).status, 200);
        assert.equal((await confirmVia(mail[0])).status, 200);
        const lead = await db.one('SELECT * FROM leads');
        assert.deepEqual([lead.email, lead.form, lead.product_id, lead.submissions], ['asha@example.in', 'stock_alert', id, 1]);
    });

    it('offers only the alert that can still happen', async () => {
        const inStock = await product({ name: 'In Stock', price: 20000, stock: 3 });
        const outOfStock = await product({ name: 'Out', price: 20000, stock: 0 });
        assert.equal((await sub({ productId: inStock, kind: 'back_in_stock' })).status, 400);
        assert.equal((await sub({ productId: outOfStock, kind: 'price_drop' })).status, 400);
        assert.equal((await sub({ productId: inStock, kind: 'price_drop', consent: false })).status, 400);
    });

    it('emails confirmed alerts once when they come true, and retries a failed send', async () => {
        const stock = await product({ name: 'Sold Out Ultra', price: 20000, stock: 0 });
        const price = await product({ name: 'Forge Pro', price: 55000, stock: 2 });
        await sub({ productId: stock, kind: 'back_in_stock' });
        await sub({ productId: price, kind: 'price_drop' });
        for (const m of mail) await confirmVia(m);
        mail = [];

        assert.equal((await alerts.runProductAlerts()).sent, 0, 'nothing has changed yet');
        await db.none('UPDATE products SET stock = 4 WHERE id = $1', [stock]);
        await db.none('UPDATE products SET price = 49999 WHERE id = $1', [price]);

        mailFails = true;
        assert.equal((await alerts.runProductAlerts()).failed, 2);
        mailFails = false;
        const run = await handler({ source: alerts.ALERTS_EVENT_SOURCE }, { getRemainingTimeInMillis: () => 15_000 });
        assert.equal(run.sent, 2);
        assert.deepEqual(mail.map((m) => [m.kind, m.price, m.was]).sort(),
            [['back_in_stock', 20000, null], ['price_drop', 49999, 55000]]);
        assert.equal((await alerts.runProductAlerts()).sent, 0, 'each alert is sent once');
    });

    it('tells a price-drop subscriber when a sale price ends', async () => {
        const { schedule } = await import('../src/services/festival.js');
        const saved = schedule.sales;
        schedule.sales = [{ id: 't', name: 'Test Sale', category: '3d_printer', prices: { x: 900 },
            startsAt: '2000-01-01T00:00:00Z', endsAt: '2999-01-01T00:00:00Z' }];
        try {
            const printer = { id: 'x', price: '1000', category: '3d_printer', stock: 1, is_archived: false };
            assert.deepEqual(alerts.alertDue({ kind: 'price_drop', baseline_price: 1000 }, printer),
                { price: 900, was: 1000, saleEnds: '2999-01-01T00:00:00Z' });
            assert.deepEqual(alerts.alertDue({ kind: 'price_drop', baseline_price: 1000 }, { ...printer, id: 'y', price: '950' }),
                { price: 950, was: 1000, saleEnds: null });
        } finally {
            schedule.sales = saved;
        }
    });

    it('gives up on an address after three failures, so it cannot hold up others', async () => {
        const id = await product({ name: 'Sold Out Ultra', price: 20000, stock: 0 });
        await sub({ productId: id, kind: 'back_in_stock' });
        await confirmVia(mail[0]);
        await db.none('UPDATE products SET stock = 4');
        mailFails = true;
        for (let i = 0; i < 4; i++) await alerts.runProductAlerts();
        mailFails = false;
        const row = await db.one('SELECT attempts, failed_at, claimed_at FROM product_alerts');
        assert.equal(row.attempts, 3);
        assert.ok(row.failed_at);
        assert.equal(row.claimed_at, null);
    });

    it('takes over a lease left by a killed run, and stops before the Lambda runs out of time', async () => {
        const id = await product({ name: 'Sold Out Ultra', price: 20000, stock: 4 });
        await db.none(`INSERT INTO product_alerts (product_id, email, kind, baseline_price, token, consent_text, confirmed_at, claimed_at)
                       VALUES ($1, 'a@example.in', 'back_in_stock', 20000, 'tok-aaaaaaaaaaaaaaaaaaaa', 'x', now(), now() - interval '20 minutes'),
                              ($1, 'b@example.in', 'back_in_stock', 20000, 'tok-bbbbbbbbbbbbbbbbbbbb', 'x', now(), now())`, [id]);
        const stats = await alerts.runProductAlerts();
        assert.deepEqual(mail.map((m) => m.unsubscribeUrl.split('/').pop()), ['tok-aaaaaaaaaaaaaaaaaaaa']);
        assert.equal(stats.sent, 1);

        await db.none(`UPDATE product_alerts SET claimed_at = NULL, notified_at = NULL`);
        mail = [];
        assert.equal((await alerts.runProductAlerts({ remainingMs: () => 1000 })).deferred, 2);
        assert.equal(mail.length, 0);
    });

    it('keeps alert email within the daily budget shared with order email', async () => {
        process.env.ALERT_EMAILS_DAILY = '2';
        try {
            const ids = [await product({ name: 'A', price: 1, stock: 0 }), await product({ name: 'B', price: 1, stock: 0 }), await product({ name: 'C', price: 1, stock: 0 })];
            const statuses = [];
            for (const productId of ids) statuses.push((await sub({ productId, kind: 'back_in_stock' })).status);
            assert.deepEqual(statuses, [201, 201, 429]);
            assert.equal(mail.length, 2);
        } finally {
            delete process.env.ALERT_EMAILS_DAILY;
        }
    });

    it('stops an alert by POST from its unsubscribe link, not by merely opening it', async () => {
        const id = await product({ name: 'Sold Out Ultra', price: 20000, stock: 0 });
        await sub({ productId: id, kind: 'back_in_stock' });
        await confirmVia(mail[0]);
        const token = mail[0].unsubscribeUrl.split('/').pop();

        await call('GET', `/api/alerts/unsubscribe/${token}`);
        assert.equal((await db.one('SELECT unsubscribed_at FROM product_alerts')).unsubscribed_at, null);
        const page = await call('POST', `/api/alerts/unsubscribe/${token}`, { body: '', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
        assert.equal(page.status, 200);
        assert.match(page.body, /unsubscribed/);
        assert.equal((await call('POST', '/api/alerts/unsubscribe/not-a-real-token-at-all', { body: '', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 404);

        await db.none('UPDATE products SET stock = 4');
        mail = [];
        await alerts.runProductAlerts();
        assert.equal(mail.length, 0);
    });

    it('caps new alerts per network per day', async () => {
        const id = await product({ name: 'In Stock', price: 20000, stock: 3 });
        const statuses = [];
        for (let i = 0; i < 11; i++) statuses.push((await sub({ productId: id, kind: 'price_drop', email: `p${i}@example.in` })).status);
        assert.deepEqual(statuses, [...Array(10).fill(201), 429]);
    });

    it('are erased with the lead, by address', async () => {
        const admin = (await db.one(`INSERT INTO users (email, password_hash) VALUES ('admin@test.local', 'x') RETURNING id`)).id;
        await db.none(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [admin]);
        const a = await product({ name: 'A', price: 1, stock: 0 });
        const b = await product({ name: 'B', price: 1, stock: 0 });
        await sub({ productId: a, kind: 'back_in_stock' });
        await confirmVia(mail[0]);
        await sub({ productId: b, kind: 'back_in_stock' }); // unconfirmed, not linked to the lead
        const { id } = await db.one('SELECT id FROM leads');
        const jwt = (await import('jsonwebtoken')).default;
        const res = await call('DELETE', `/api/leads/admin/${id}`, { headers: { authorization: `Bearer ${jwt.sign({ userId: admin }, process.env.JWT_SECRET)}` } });
        assert.equal(res.status, 204);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM product_alerts')).n, 0);
    });
});

// ---- WhatsApp -----------------------------------------------------------------

async function whatsappSays(waId, text) {
    const payload = { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { phone_number_id: '1' },
        contacts: [{ wa_id: waId, profile: { name: 'Asha' } }],
        messages: [{ from: waId, id: `wamid.${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
    } }] }] };
    const raw = JSON.stringify(payload);
    const res = await call('POST', '/api/webhooks/whatsapp', { body: raw, headers: {
        'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}` } });
    assert.equal(res.status, 200);
    await runWorker();
}
