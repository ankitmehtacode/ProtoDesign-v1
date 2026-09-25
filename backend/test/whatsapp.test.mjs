// WhatsApp Cloud API integration: webhook security, idempotency, consent,
// the free-window rule, and failure isolation from orders/quotes/payments.
//
// Real disposable Postgres with the project's migrations; webhooks go through
// the real Lambda entrypoint (so raw-body signature checking is exercised on
// the path production uses). Only external boundaries are stubbed: Meta's
// Graph API (global fetch), SMTP, S3 and PhonePe. No message leaves the machine.
//
//   tsx --test test/whatsapp.test.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
const APP_SECRET = 'test-app-secret';
const VERIFY = 'test-verify-token';
const PHONE_NUMBER_ID = '1000000001';
Object.assign(process.env, {
    DATABASE_URL: pg.url,
    JWT_SECRET: 'test-jwt-secret',
    AWS_LAMBDA_FUNCTION_NAME: 'whatsapp-test',
    NODE_ENV: 'production',
    WHATSAPP_MODE: 'live',
    WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    WHATSAPP_BUSINESS_NUMBER: '918249581682',
    WHATSAPP_VERIFY_TOKEN: VERIFY,
    META_APP_SECRET: APP_SECRET,
    FRONTEND_URL: 'https://shop.example',
    S3_STL_BUCKET: 'test-bucket'
});
const BASE_ENV = { ...process.env };

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const wa = await import('../src/services/whatsapp.service.js');
const { runWorker } = await import('../src/services/whatsapp.worker.js');
const orders = await import('../src/services/order.service.js');
const { emailService } = await import('../src/services/email.service.js');
const { storageService } = await import('../src/services/storage.service.js');

// ---- boundaries -------------------------------------------------------------
const logs = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = (...a) => logs.push(a.join(' '));
const logged = (event) => logs.some((l) => l.includes(`"event":"${event}"`));

// The worker is run explicitly by each test; a kick only counts.
let kicks = 0;
wa.dispatch.kick = async () => { kicks++; };

const alerts = [];
emailService.sendAdminAlert = async (subject) => { alerts.push(subject); };
emailService.sendOrderStatusEmail = async () => {};

const stored = [];
storageService.storeModel = async ({ ownerKey, filename, contentLength }) => {
    stored.push({ ownerKey, filename, contentLength });
    return `quotes/models/${ownerKey}/${randomUUID()}.obj`;
};

// Graph API stub: records every call, answers from `graph.next`.
const graph = { calls: [], next: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('graph.facebook.com') && !u.includes('lookaside.fbsbx.com')) return realFetch(url, init);
    graph.calls.push({ url: u, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    const respond = graph.next.shift();
    if (respond) return respond(u);
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${randomUUID()}` }] }), { status: 200 });
};
const graphError = (status, code, message = 'error') => () =>
    new Response(JSON.stringify({ error: { code, message } }), { status });
const sentBodies = () => graph.calls.filter((c) => c.url.endsWith('/messages')).map((c) => c.body);

after(async () => {
    Object.assign(console, realConsole);
    globalThis.fetch = realFetch;
    await pgp.end();
    pg.stop();
});

beforeEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in BASE_ENV)) delete process.env[k];
    Object.assign(process.env, BASE_ENV);
    graph.calls.length = 0;
    graph.next.length = 0;
    alerts.length = 0;
    kicks = 0;
});

// ---- helpers ----------------------------------------------------------------
const sign = (raw, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

async function http(method, path, { body, headers = {}, query = '' } = {}) {
    const raw = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const res = await handler({
        version: '2.0',
        routeKey: '$default',
        rawPath: path,
        rawQueryString: query,
        headers: { 'content-type': 'application/json', host: 'example.lambda-url.ap-southeast-1.on.aws', ...headers },
        requestContext: { http: { method, path, sourceIp: '203.0.113.7' }, domainName: 'example' },
        body: raw,
        isBase64Encoded: false
    }, { getRemainingTimeInMillis: () => 15000 });
    let parsed = res.body;
    try { parsed = JSON.parse(res.body); } catch { /* text */ }
    return { status: res.statusCode, body: parsed };
}

const postWebhook = (payload, signature) => {
    const raw = JSON.stringify(payload);
    return http('POST', '/api/webhooks/whatsapp', {
        body: raw,
        headers: signature === null ? {} : { 'x-hub-signature-256': signature ?? sign(raw) }
    });
};

const delivery = ({ messages = [], statuses = [], contacts = [], phoneNumberId = PHONE_NUMBER_ID }) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, contacts, messages, statuses
    } }] }]
});

let phoneSeq = 0;
const newWaId = () => `9198765${String(10000 + ++phoneSeq).slice(-5)}`;
const nowSec = () => String(Math.floor(Date.now() / 1000));

function inbound(waId, { text, type = 'text', extra = {}, id = `wamid.in.${randomUUID()}`, timestamp = nowSec() } = {}) {
    const message = { from: waId, id, timestamp, type, ...extra };
    if (type === 'text') message.text = { body: text };
    return delivery({ messages: [message], contacts: [{ wa_id: waId, profile: { name: 'Asha' } }] });
}

async function customerSays(waId, text, opts) {
    const res = await postWebhook(inbound(waId, { text, ...opts }));
    assert.equal(res.status, 200);
    await runWorker();
}

const contactFor = (waId) => db.oneOrNone('SELECT * FROM whatsapp_contacts WHERE wa_id = $1', [waId]);
const outbound = (contactId) => db.any(
    `SELECT * FROM whatsapp_messages WHERE contact_id = $1 AND direction = 'outbound' ORDER BY created_at`, [contactId]);

let userSeq = 0;
async function seedUser({ admin = false } = {}) {
    const u = await db.one(`INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Buyer') RETURNING id`, [`wa${++userSeq}@test.local`]);
    await db.none('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [u.id, admin ? 'admin' : 'user']);
    return u.id;
}
const tokenFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET);

async function seedOrder(userId, status = 'pending') {
    const p = await db.one(`INSERT INTO products (name, price, stock) VALUES ('Spool', 100, 10) RETURNING id`);
    const o = await db.one(
        `INSERT INTO orders (user_id, subtotal_amount, tax_amount, shipping_amount, total_amount, payment_gateway, status)
         VALUES ($1, 100, 18, 0, 118, 'phonepe', $2) RETURNING *`, [userId, status]);
    await db.none('INSERT INTO order_items (order_id, product_id, quantity, price, line_total) VALUES ($1, $2, 1, 100, 100)', [o.id, p.id]);
    return o;
}
const seedQuote = (userId) => db.one(
    `INSERT INTO quotes (user_id, email, phone, file_url, file_name, specifications)
     VALUES ($1, 'q@test.local', '9876543210', 'quotes/models/x/a.stl', 'a.stl', '{}') RETURNING *`, [userId]);

/** Customer links an order/quote the way the site does: via the signed link. */
async function linkViaWhatsApp(userId, kind, id, waId) {
    const res = await http('GET', '/api/whatsapp/link', {
        query: `kind=${kind}&id=${id}`, headers: { authorization: `Bearer ${tokenFor(userId)}` }
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const text = decodeURIComponent(new URL(res.body.url).searchParams.get('text'));
    await customerSays(waId, text);
    return text;
}

// =============================================================================

describe('webhook verification (GET)', () => {
    it('echoes the challenge for the right verify token', async () => {
        const res = await http('GET', '/api/webhooks/whatsapp', { query: `hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345` });
        assert.equal(res.status, 200);
        assert.equal(String(res.body), '12345');
    });

    it('rejects a wrong verify token with 403', async () => {
        const res = await http('GET', '/api/webhooks/whatsapp', { query: 'hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345' });
        assert.equal(res.status, 403);
    });
});

describe('webhook signature (POST)', () => {
    it('rejects an invalid signature and stores nothing', async () => {
        const res = await postWebhook(inbound(newWaId(), { text: 'hi' }), sign('something else'));
        assert.equal(res.status, 401);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM whatsapp_events')).n, 0);
    });

    it('rejects a missing signature', async () => {
        assert.equal((await postWebhook(inbound(newWaId(), { text: 'hi' }), null)).status, 401);
    });

    it('rejects a signature made with another secret', async () => {
        const payload = inbound(newWaId(), { text: 'hi' });
        assert.equal((await postWebhook(payload, sign(JSON.stringify(payload), 'wrong-secret'))).status, 401);
    });

    it('accepts a valid signature, stores the event and kicks the worker', async () => {
        const res = await postWebhook(inbound(newWaId(), { text: 'hi' }));
        assert.equal(res.status, 200);
        assert.equal(kicks, 1);
    });

    it('ignores events addressed to a different phone number id', async () => {
        const before = (await db.one('SELECT count(*)::int AS n FROM whatsapp_events')).n;
        const res = await postWebhook(delivery({
            messages: [{ from: newWaId(), id: `wamid.${randomUUID()}`, timestamp: nowSec(), type: 'text', text: { body: 'x' } }],
            phoneNumberId: '999'
        }));
        assert.equal(res.status, 200);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM whatsapp_events')).n, before);
    });
});

describe('inbound messages', () => {
    it('processes a duplicate delivery once', async () => {
        const waId = newWaId();
        const payload = inbound(waId, { text: 'hello', id: `wamid.dup.${randomUUID()}` });
        assert.equal((await postWebhook(payload)).status, 200);
        assert.equal((await postWebhook(payload)).status, 200);
        await runWorker();
        const contact = await contactFor(waId);
        const { n } = await db.one(`SELECT count(*)::int AS n FROM whatsapp_messages WHERE contact_id = $1 AND direction = 'inbound'`, [contact.id]);
        assert.equal(n, 1);
        assert.equal((await outbound(contact.id)).length, 1, 'one acknowledgement, not two');
    });

    it('creates the contact, acknowledges a new conversation once, and alerts the shop', async () => {
        const waId = newWaId();
        await customerSays(waId, 'Do you print in PETG?');
        await customerSays(waId, 'Also nylon?');
        const contact = await contactFor(waId);
        assert.equal(contact.profile_name, 'Asha');
        assert.ok(contact.last_inbound_at);
        const out = await outbound(contact.id);
        assert.equal(out.length, 1, 'only the first message of a window is auto-acknowledged');
        assert.equal(out[0].status, 'sent');
        assert.equal(out[0].billable, false);
        assert.equal(alerts.length, 1);
        const body = sentBodies().at(-1);
        assert.equal(body.to, waId);
        assert.equal(body.type, 'text');
        assert.equal(graph.calls.at(-1).auth, 'Bearer test-access-token');
    });

    it('drops a message whose sender is not a phone number', async () => {
        const res = await postWebhook(delivery({ messages: [{ from: '12ab', id: `wamid.${randomUUID()}`, timestamp: nowSec(), type: 'text', text: { body: 'x' } }] }));
        assert.equal(res.status, 200);
        await runWorker();
        assert.equal(await contactFor('12ab'), null);
        assert.ok(logged('whatsapp_event_dropped'));
    });

    it('turns a model file sent as a document into a quote', async () => {
        const waId = newWaId();
        graph.next.push(() => new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/media/1', mime_type: 'model/obj', file_size: 2048 }), { status: 200 }));
        graph.next.push(() => new Response(new Uint8Array(2048), { status: 200 }));
        await customerSays(waId, null, { type: 'document', extra: { document: { id: 'media-1', filename: 'bracket.obj', caption: 'PLA, black, 2 pcs' } } });

        const contact = await contactFor(waId);
        const quote = await db.one(`SELECT * FROM quotes WHERE phone = $1`, [`+${waId}`]);
        assert.equal(quote.source, 'whatsapp');
        assert.equal(quote.email, null);
        assert.equal(quote.file_name, 'bracket.obj');
        assert.equal(quote.admin_notes, 'PLA, black, 2 pcs');
        assert.ok(quote.file_url.startsWith(`quotes/models/whatsapp/${contact.id}/`));
        assert.deepEqual(stored.at(-1), { ownerKey: `whatsapp/${contact.id}`, filename: 'bracket.obj', contentLength: 2048 });
        assert.ok(await db.oneOrNone('SELECT 1 FROM whatsapp_links WHERE contact_id = $1 AND quote_id = $2', [contact.id, quote.id]));
        assert.match(sentBodies().at(-1).text.body, /received bracket\.obj as quote/);
    });
});

describe('delivery statuses', () => {
    async function sentMessage() {
        const waId = newWaId();
        await customerSays(waId, 'hi');
        const contact = await contactFor(waId);
        return (await outbound(contact.id))[0];
    }
    const statusEvent = (id, status, extra = {}) => delivery({ statuses: [{ id, status, timestamp: nowSec(), recipient_id: '1', ...extra }] });

    it('records delivered, and what Meta says about billing', async () => {
        const m = await sentMessage();
        await postWebhook(statusEvent(m.wa_message_id, 'delivered', { pricing: { billable: false, category: 'service' } }));
        await runWorker();
        const row = await db.one('SELECT status, billable FROM whatsapp_messages WHERE id = $1', [m.id]);
        assert.deepEqual(row, { status: 'delivered', billable: false });
    });

    it('records read, and a late delivered does not move it backwards', async () => {
        const m = await sentMessage();
        await postWebhook(statusEvent(m.wa_message_id, 'read'));
        await runWorker();
        await postWebhook(statusEvent(m.wa_message_id, 'delivered'));
        await runWorker();
        assert.equal((await db.one('SELECT status FROM whatsapp_messages WHERE id = $1', [m.id])).status, 'read');
    });

    it('records a failed delivery with its error code', async () => {
        const m = await sentMessage();
        await postWebhook(statusEvent(m.wa_message_id, 'failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] }));
        await runWorker();
        const row = await db.one('SELECT status, error_code, error_message FROM whatsapp_messages WHERE id = $1', [m.id]);
        assert.deepEqual(row, { status: 'failed', error_code: '131026', error_message: 'Message undeliverable' });
    });
});

describe('RFQ (quote) flow', () => {
    it('links a quote only for its owner, then notifies on a status change', async () => {
        const owner = await seedUser();
        const stranger = await seedUser();
        const quote = await seedQuote(owner);

        const denied = await http('GET', '/api/whatsapp/link', { query: `kind=quote&id=${quote.id}`, headers: { authorization: `Bearer ${tokenFor(stranger)}` } });
        assert.equal(denied.status, 404);

        const waId = newWaId();
        await linkViaWhatsApp(owner, 'quote', quote.id, waId);
        const contact = await contactFor(waId);
        assert.equal(contact.user_id, owner);
        assert.match(sentBodies().at(-1).text.body, /Current status: Received, awaiting review/);

        const admin = await seedUser({ admin: true });
        const res = await http('PUT', `/api/quotes/${quote.id}/status`, { body: { status: 'contacted' }, headers: { authorization: `Bearer ${tokenFor(admin)}` } });
        assert.equal(res.status, 200);
        await runWorker();
        const last = (await outbound(contact.id)).at(-1);
        assert.equal(last.kind, 'notification');
        assert.equal(last.status, 'sent');
        assert.match(last.body, /being reviewed/);
    });

    it('rejects a forged reference', async () => {
        const quote = await seedQuote(await seedUser());
        const waId = newWaId();
        await customerSays(waId, `updates please (ref Q-${quote.id.slice(0, 8).toUpperCase()}-AAAAAAAA)`);
        const contact = await contactFor(waId);
        assert.equal(await db.oneOrNone('SELECT 1 FROM whatsapp_links WHERE contact_id = $1', [contact.id]), null);
        assert.match(sentBodies().at(-1).text.body, /couldn't match that reference/);
    });
});

describe('payment flow', () => {
    it('queues "payment confirmed" only after PhonePe verification settles the order, exactly once', async () => {
        const user = await seedUser();
        const order = await seedOrder(user);
        const waId = newWaId();
        await linkViaWhatsApp(user, 'order', order.id, waId);
        const contact = await contactFor(waId);

        const gatewayData = { state: 'COMPLETED', amount: 11800 };
        assert.equal(await orders.settlePayment(order.id, gatewayData), 'paid');
        assert.equal(await orders.settlePayment(order.id, gatewayData), 'noop', 'replayed callback');
        await runWorker();

        const notes = (await outbound(contact.id)).filter((m) => m.kind === 'notification');
        assert.equal(notes.length, 1);
        assert.equal(notes[0].status, 'sent');
        assert.match(notes[0].body, /Payment confirmed/);
    });

    it('sends nothing for an unverified or failed payment', async () => {
        const user = await seedUser();
        const order = await seedOrder(user);
        const waId = newWaId();
        await linkViaWhatsApp(user, 'order', order.id, waId);
        const contact = await contactFor(waId);
        await orders.settlePayment(order.id, { state: 'PENDING' });
        await orders.settlePayment(order.id, { state: 'COMPLETED', amount: 1 }); // amount mismatch
        await runWorker();
        assert.equal((await outbound(contact.id)).filter((m) => m.kind === 'notification').length, 0);
    });
});

describe('failure isolation', () => {
    it('a Graph API outage never fails the payment, and the message is retried then marked failed', async () => {
        const user = await seedUser();
        const order = await seedOrder(user);
        const waId = newWaId();
        await linkViaWhatsApp(user, 'order', order.id, waId);
        const contact = await contactFor(waId);

        for (let i = 0; i < 10; i++) graph.next.push(graphError(503, 131016, 'Service unavailable'));
        assert.equal(await orders.settlePayment(order.id, { state: 'COMPLETED', amount: 11800 }), 'paid');
        assert.equal((await db.one('SELECT status FROM orders WHERE id = $1', [order.id])).status, 'processing');

        await runWorker();
        let note = (await outbound(contact.id)).find((m) => m.kind === 'notification');
        assert.equal(note.status, 'queued', 'retryable error: back in the queue');
        assert.equal(note.attempts, 1);

        // Exhaust the retries, fast-forwarding past each backoff. The
        // updated_at trigger would reset a plain backdate, so bypass it.
        for (let i = 0; i < 5; i++) {
            await db.tx(async (t) => {
                await t.none('ALTER TABLE whatsapp_messages DISABLE TRIGGER trigger_update_whatsapp_messages_updated_at');
                await t.none(`UPDATE whatsapp_messages SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [note.id]);
                await t.none('ALTER TABLE whatsapp_messages ENABLE TRIGGER trigger_update_whatsapp_messages_updated_at');
            });
            await runWorker();
        }
        note = await db.one('SELECT * FROM whatsapp_messages WHERE id = $1', [note.id]);
        assert.equal(note.status, 'failed');
        assert.equal(note.error_code, '131016');
    });

    it('a notification for an order nobody linked does nothing and does not throw', async () => {
        assert.equal(await wa.notifyOrder(randomUUID(), 'shipped'), 0);
    });

    it('an expired token is logged loudly without leaking it', async () => {
        const waId = newWaId();
        graph.next.push(graphError(401, 190, 'Error validating access token'));
        await customerSays(waId, 'hi');
        assert.ok(logged('whatsapp_auth_failed'));
        assert.ok(!logs.some((l) => l.includes('test-access-token')), 'token never logged');
    });
});

describe('free-only mode (the default)', () => {
    it('never sends outside the 24-hour window: skipped, no Graph call, nothing billable', async () => {
        const user = await seedUser();
        const order = await seedOrder(user, 'processing');
        const waId = newWaId();
        await linkViaWhatsApp(user, 'order', order.id, waId);
        const contact = await contactFor(waId);
        await db.none(`UPDATE whatsapp_contacts SET last_inbound_at = NOW() - INTERVAL '25 hours' WHERE id = $1`, [contact.id]);

        const callsBefore = graph.calls.length;
        await wa.notifyOrder(order.id, 'shipped');
        await runWorker();
        const note = (await outbound(contact.id)).at(-1);
        assert.equal(note.status, 'skipped');
        assert.equal(note.error_code, 'window_closed');
        assert.equal(note.billable, false);
        assert.equal(graph.calls.length, callsBefore, 'no request to Meta at all');
    });

    it('with paid templates switched on, uses the approved template and marks it billable', async () => {
        process.env.WHATSAPP_PAID_TEMPLATES = 'true';
        process.env.WHATSAPP_TEMPLATE_ORDER_UPDATE = 'order_update';
        const user = await seedUser();
        const order = await seedOrder(user, 'processing');
        const waId = newWaId();
        await linkViaWhatsApp(user, 'order', order.id, waId);
        const contact = await contactFor(waId);
        await db.none(`UPDATE whatsapp_contacts SET last_inbound_at = NOW() - INTERVAL '25 hours' WHERE id = $1`, [contact.id]);

        await wa.notifyOrder(order.id, 'shipped');
        await runWorker();
        const body = sentBodies().at(-1);
        assert.equal(body.type, 'template');
        assert.equal(body.template.name, 'order_update');
        assert.deepEqual(body.template.components[0].parameters.map((p) => p.text), [`#${order.id.slice(0, 8).toUpperCase()}`, 'Shipped']);
        assert.equal((await outbound(contact.id)).at(-1).billable, true);
    });
});

describe('consent', () => {
    it('STOP opts out: confirmation sent, consent revoked (kept), later notifications skipped, history kept', async () => {
        const user = await seedUser();
        const order = await seedOrder(user, 'processing');
        const waId = newWaId();
        await linkViaWhatsApp(user, 'order', order.id, waId);
        const contact = await contactFor(waId);

        await customerSays(waId, 'stop');
        const after = await contactFor(waId);
        assert.ok(after.opted_out_at);
        const consents = await db.any('SELECT revoked_at FROM whatsapp_consents WHERE contact_id = $1', [contact.id]);
        assert.ok(consents.length > 0 && consents.every((c) => c.revoked_at), 'revoked, not deleted');
        assert.match(sentBodies().at(-1).text.body, /unsubscribed/);

        await wa.notifyOrder(order.id, 'shipped');
        await runWorker();
        const note = (await outbound(contact.id)).at(-1);
        assert.equal(note.status, 'skipped');
        assert.equal(note.error_code, 'opted_out');
        assert.ok(await db.oneOrNone('SELECT 1 FROM whatsapp_links WHERE contact_id = $1', [contact.id]), 'links kept');

        await customerSays(waId, 'START');
        assert.equal((await contactFor(waId)).opted_out_at, null);
    });

    it('refuses to queue marketing without marketing consent', async () => {
        const waId = newWaId();
        await customerSays(waId, 'hi');
        const contact = await contactFor(waId);
        const queued = await wa.enqueueMessage(db, { contactId: contact.id, body: 'Big sale!', category: 'marketing' });
        assert.equal(queued, null);
        assert.ok(logged('whatsapp_marketing_refused'));
    });

    it('does not send a notification to a contact who never consented', async () => {
        const quote = await seedQuote(await seedUser());
        const waId = newWaId();
        await customerSays(waId, 'hi');
        const contact = await contactFor(waId);
        await db.none('INSERT INTO whatsapp_links (contact_id, quote_id) VALUES ($1, $2)', [contact.id, quote.id]);
        await wa.notifyQuote(quote.id, 'completed');
        await runWorker();
        assert.equal((await outbound(contact.id)).at(-1).error_code, 'no_service_consent');
    });
});

describe('phone numbers', () => {
    it('normalises valid numbers and rejects malformed ones', () => {
        assert.equal(wa.normalizeWaId('9876543210'), '919876543210');
        assert.equal(wa.normalizeWaId('09876543210'), '919876543210');
        assert.equal(wa.normalizeWaId('+91 98765-43210'), '919876543210');
        assert.equal(wa.normalizeWaId('+1 (415) 555-0100'), '14155550100');
        for (const bad of ['', '12345', 'abc9876543210', '+0123456789', '9'.repeat(20), null, '<script>']) {
            assert.equal(wa.normalizeWaId(bad), null, String(bad));
        }
    });
});

describe('configuration and environment guard', () => {
    it('reports missing variables by name and disables the webhook', async () => {
        delete process.env.WHATSAPP_ACCESS_TOKEN;
        const config = wa.getConfig();
        assert.equal(config.enabled, false);
        assert.deepEqual(config.missing, ['WHATSAPP_ACCESS_TOKEN']);
        assert.equal((await postWebhook(inbound(newWaId(), { text: 'hi' }))).status, 404);
        assert.deepEqual((await http('GET', '/api/whatsapp/status')).body, { enabled: false });
    });

    it('is off unless explicitly enabled', () => {
        delete process.env.WHATSAPP_MODE;
        assert.equal(wa.getConfig().enabled, false);
    });

    it('outside production, live mode only messages allow-listed numbers', async () => {
        process.env.NODE_ENV = 'development';
        const blocked = newWaId();
        const allowed = newWaId();
        process.env.WHATSAPP_TEST_RECIPIENTS = `+${allowed}`;
        await customerSays(blocked, 'hi');
        await customerSays(allowed, 'hi');
        assert.equal((await outbound((await contactFor(blocked)).id))[0].error_code, 'non_production_recipient');
        assert.equal((await outbound((await contactFor(allowed)).id))[0].status, 'sent');
        assert.deepEqual(sentBodies().map((b) => b.to), [allowed]);
    });

    it('mock mode records the send without calling Meta', async () => {
        process.env.WHATSAPP_MODE = 'mock';
        const waId = newWaId();
        await customerSays(waId, 'hi');
        const [m] = await outbound((await contactFor(waId)).id);
        assert.equal(m.status, 'sent');
        assert.match(m.wa_message_id, /^mock\./);
        assert.equal(graph.calls.length, 0);
    });
});

describe('admin', () => {
    it('lists conversations for admins only and refuses replies outside the window', async () => {
        const waId = newWaId();
        await customerSays(waId, 'hi');
        const contact = await contactFor(waId);
        const admin = tokenFor(await seedUser({ admin: true }));
        const user = tokenFor(await seedUser());

        assert.equal((await http('GET', '/api/whatsapp/admin/overview', { headers: { authorization: `Bearer ${user}` } })).status, 403);
        const overview = await http('GET', '/api/whatsapp/admin/overview', { headers: { authorization: `Bearer ${admin}` } });
        assert.equal(overview.status, 200);
        assert.ok(overview.body.conversations.some((c) => c.id === contact.id && c.window_open));
        assert.equal(overview.body.config.mode, 'live');

        const ok = await http('POST', `/api/whatsapp/admin/contacts/${contact.id}/reply`, { body: { text: 'Yes, we print PETG.' }, headers: { authorization: `Bearer ${admin}` } });
        assert.equal(ok.status, 202);

        await db.none(`UPDATE whatsapp_contacts SET last_inbound_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [contact.id]);
        const late = await http('POST', `/api/whatsapp/admin/contacts/${contact.id}/reply`, { body: { text: 'Hello?' }, headers: { authorization: `Bearer ${admin}` } });
        assert.equal(late.status, 409);
    });
});
