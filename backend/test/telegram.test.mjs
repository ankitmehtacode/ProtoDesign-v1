// Telegram order updates through the real Lambda entrypoint, against a real
// Postgres, with Telegram's Bot API stubbed: linking a chat to an order, the
// customer's updates, the shop's alerts, /stop and /reply.
//
//   tsx --test test/telegram.test.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'telegram-test';
process.env.TELEGRAM_BOT_TOKEN = '123:test-token';
process.env.TELEGRAM_BOT_USERNAME = 'ProtoDesignTestBot';
process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
process.env.TELEGRAM_ADMIN_CHAT_IDS = '900';
process.env.FRONTEND_URL = 'https://shop.example';

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const telegram = await import('../src/services/telegram.service.js');
const { settlePayment, releaseStaleHolds } = await import('../src/services/order.service.js');
const { phonePeService } = await import('../src/services/phonepe.service.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

// Every Bot API call lands here instead of on Telegram.
let sent = [];
let reply = () => ({ status: 200, body: { ok: true } });
telegram.transport.fetch = async (url, init) => {
    assert.match(url, /^https:\/\/api\.telegram\.org\/bot123:test-token\/sendMessage$/);
    const msg = JSON.parse(init.body);
    sent.push({ chat: String(msg.chat_id), text: msg.text });
    const r = reply(msg);
    // 'hang' imitates an unresponsive api.telegram.org: only the abort signal ends it.
    if (r === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    return { status: r.status, json: async () => r.body };
};
beforeEach(() => { sent = []; reply = () => ({ status: 200, body: { ok: true } }); });
const to = (chat) => sent.filter((m) => m.chat === String(chat)).map((m) => m.text);

const call = async (method, path, { userId, body, headers: extra = {}, query = '' } = {}) => {
    const headers = { 'content-type': 'application/json', host: 'example.lambda-url.ap-southeast-1.on.aws', ...extra };
    if (userId) headers.authorization = `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;
    const res = await handler({
        version: '2.0',
        routeKey: '$default',
        rawPath: path,
        rawQueryString: query,
        headers,
        requestContext: { http: { method, path, sourceIp: '203.0.113.7' }, domainName: 'example' },
        body: body === undefined ? undefined : JSON.stringify(body),
        isBase64Encoded: false,
    }, {});
    return { status: res.statusCode, body: res.body ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : null };
};

const update = (chatId, text, { secret = 'hook-secret', type = 'private' } = {}) => call('POST', '/api/webhooks/telegram', {
    headers: { 'x-telegram-bot-api-secret-token': secret },
    body: { update_id: Date.now(), message: { message_id: 1, chat: { id: chatId, type }, from: { first_name: 'Asha' }, text } },
});

let n = 0;
const seedUser = async () => (await db.one(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Asha Rao') RETURNING id`,
    [`tg${++n}@test.local`])).id;
const seedOrder = async (userId, status = 'pending_payment') => {
    const p = await db.one(`INSERT INTO products (name, price, stock) VALUES ('Bambu Lab A1', 100, 10) RETURNING id`);
    const o = await db.one(
        `INSERT INTO orders (user_id, subtotal_amount, tax_amount, shipping_amount, total_amount, payment_gateway, status, shipping_address)
         VALUES ($1, 100, 0, 0, 100, 'phonepe', $2, $3) RETURNING id`,
        [userId, status, { fullName: 'Asha Rao', phone: '9876543210', city: 'Indore', pincode: '452001' }]);
    await db.none('INSERT INTO order_items (order_id, product_id, quantity, price, line_total) VALUES ($1, $2, 1, 100, 100)', [o.id, p.id]);
    return o.id;
};
const seedQuote = async (userId) => (await db.one(
    `INSERT INTO quotes (user_id, email, phone, file_url, file_name, specifications)
     VALUES ($1, 'q@test.local', '9876543210', 'quotes/models/x/a.stl', 'a.stl', '{}') RETURNING id`, [userId])).id;
const follow = async (chatId, userId, kind, id) =>
    update(chatId, `/start ${startPayload((await linkUrl(userId, kind, id)).body.url)}`);
const linkUrl = async (userId, kind, id) => (await call('GET', '/api/telegram/link', { userId, query: `kind=${kind}&id=${id}` }));
const startPayload = (url) => new URL(url).searchParams.get('start');

describe('linking a chat to an order', () => {
    it('gives the owner a signed start link, and nobody else', async () => {
        const owner = await seedUser();
        const order = await seedOrder(owner);
        const res = await linkUrl(owner, 'order', order);
        assert.equal(res.status, 200);
        assert.match(res.body.url, /^https:\/\/t\.me\/ProtoDesignTestBot\?start=O-[0-9A-F]{8}-[A-Z2-7]{8}$/);
        assert.equal((await linkUrl(await seedUser(), 'order', order)).status, 404);
        assert.equal((await call('GET', '/api/telegram/status')).body.botUrl, 'https://t.me/ProtoDesignTestBot');
    });

    it('subscribes the chat on /start and replies with the current status', async () => {
        const owner = await seedUser();
        const order = await seedOrder(owner);
        const res = await update(1001, `/start ${startPayload((await linkUrl(owner, 'order', order)).body.url)}`);
        assert.equal(res.status, 200);
        assert.match(to(1001)[0], /updates for your ProtoDesign order #[0-9A-F]{8}.*\nCurrent status: Awaiting payment/s);
        assert.equal((await db.one('SELECT count(*)::int AS c FROM telegram_links WHERE chat_id = 1001 AND order_id = $1', [order])).c, 1);
    });

    it('refuses a forged reference', async () => {
        const order = await seedOrder(await seedUser());
        await update(1002, `/start O-${order.slice(0, 8).toUpperCase()}-AAAAAAAA`);
        assert.match(to(1002)[0], /did not work/);
        assert.equal((await db.one('SELECT count(*)::int AS c FROM telegram_links WHERE chat_id = 1002')).c, 0);
    });

    it('rejects a webhook call without the secret, and ignores group chats', async () => {
        assert.equal((await update(1003, '/start', { secret: 'wrong' })).status, 401);
        assert.equal((await update(1003, '/start', { type: 'group' })).status, 200);
        assert.equal(sent.length, 0);
    });
});

describe('updates', () => {
    it('tells the customer and alerts the shop when a payment settles, exactly once', async () => {
        const owner = await seedUser();
        const order = await seedOrder(owner);
        await update(1101, `/start ${startPayload((await linkUrl(owner, 'order', order)).body.url)}`);
        sent = [];

        assert.equal(await settlePayment(order, { state: 'COMPLETED', amount: 10000 }), 'paid');
        assert.match(to(1101).join(), /Payment confirmed for your ProtoDesign order/);
        assert.match(to(900).join(), /New paid order #[0-9A-F]{8}\nAsha Rao · ₹100\n• 1 × Bambu Lab A1\nPhone: 9876543210/);

        sent = [];
        assert.equal(await settlePayment(order, { state: 'COMPLETED', amount: 10000 }), 'noop');
        assert.equal(sent.length, 0);
    });

    it('tells the customer and alerts the shop when a payment fails', async () => {
        const owner = await seedUser();
        const order = await seedOrder(owner);
        await follow(1102, owner, 'order', order);
        sent = [];
        assert.equal(await settlePayment(order, { state: 'FAILED' }), 'cancelled');
        assert.match(to(1102).join(), /order #[0-9A-F]{8} has been cancelled\. Message us here/);
        assert.match(to(900).join(), /Payment failed for order/);
    });

    it('settles a payment within one send timeout when Telegram hangs', async () => {
        const owner = await seedUser();
        const order = await seedOrder(owner);
        await follow(1103, owner, 'order', order);
        reply = () => 'hang';
        const started = Date.now();
        assert.equal(await settlePayment(order, { state: 'COMPLETED', amount: 10000 }), 'paid');
        const took = Date.now() - started;
        assert.ok(took < 3000, `settlement took ${took} ms`);
        assert.equal((await db.one('SELECT status FROM orders WHERE id = $1', [order])).status, 'processing');
    });

    it('alerts the shop about a cash-on-delivery order', async () => {
        const owner = await seedUser();
        const p = await db.one(`INSERT INTO products (name, price, stock, category) VALUES ('PLA spool', 500, 10, 'Filaments') RETURNING id`);
        const res = await call('POST', '/api/orders', { userId: owner, body: {
            items: [{ product_id: p.id, quantity: 1 }],
            shippingAddress: { fullName: 'Asha Rao', phone: '9876543210', city: 'Indore' },
            paymentGateway: 'cod',
        } });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.match(to(900).join(), /New cash-on-delivery order #[0-9A-F]{8}\nAsha Rao · ₹\d[\d,]*\n• 1 × PLA spool/);
    });

    it('sends one summary when unpaid checkouts are cancelled to free stock', async () => {
        const owner = await seedUser();
        const a = await seedOrder(owner);
        const b = await seedOrder(owner);
        await db.none(`UPDATE orders SET created_at = NOW() - interval '1 hour' WHERE id IN ($1, $2)`, [a, b]);
        await follow(1104, owner, 'order', a);
        const products = (await db.any('SELECT product_id FROM order_items WHERE order_id IN ($1, $2)', [a, b])).map((r) => r.product_id);
        const realVerify = phonePeService.verifyPaymentStatus;
        phonePeService.verifyPaymentStatus = async () => ({ state: 'FAILED' });
        try {
            sent = [];
            assert.equal(await releaseStaleHolds(products), 2);
        } finally {
            phonePeService.verifyPaymentStatus = realVerify;
        }
        assert.deepEqual(to(900).length, 1);
        assert.match(to(900)[0], /Cancelled 2 unpaid checkouts to free stock: #[0-9A-F]{8}, #[0-9A-F]{8}/);
        assert.match(to(1104).join(), /has been cancelled/);
    });

    it('links a quote and sends its status updates', async () => {
        const owner = await seedUser();
        const quote = await seedQuote(owner);
        await follow(1105, owner, 'quote', quote);
        assert.match(to(1105)[0], /updates for your ProtoDesign quote #[0-9A-F]{8}.*\nCurrent status: Received, awaiting review/s);
        sent = [];
        assert.equal(await telegram.notifyQuote(quote, 'contacted'), 1);
        assert.match(to(1105)[0], /quote #[0-9A-F]{8} is being reviewed/);
    });

    it('stops after /stop, starts again after /start, and stops a chat that blocked the bot', async () => {
        const owner = await seedUser();
        const order = await seedOrder(owner, 'processing');
        await update(1201, `/start ${startPayload((await linkUrl(owner, 'order', order)).body.url)}`);

        await update(1201, '/stop');
        sent = [];
        await telegram.notifyOrder(order, 'shipped');
        assert.equal(to(1201).length, 0);

        await update(1201, '/start');
        sent = [];
        await telegram.notifyOrder(order, 'shipped');
        assert.match(to(1201)[0], /has been shipped\. Track it here: https:\/\/shop\.example\/orders/);

        reply = () => ({ status: 403, body: { ok: false, error_code: 403 } });
        await telegram.notifyOrder(order, 'delivered');
        assert.ok((await db.one('SELECT stopped_at FROM telegram_chats WHERE chat_id = 1201')).stopped_at);
    });

    it('lists followed orders on /status', async () => {
        const owner = await seedUser();
        const order = await seedOrder(owner, 'shipped');
        await update(1301, `/start ${startPayload((await linkUrl(owner, 'order', order)).body.url)}`);
        sent = [];
        await update(1301, '/status');
        assert.match(to(1301)[0], /^Order #[0-9A-F]{8}: Shipped$/);
    });
});

describe('customer messages', () => {
    it('forwards a message to the shop, and the shop answers with /reply', async () => {
        await update(1401, 'Is the A1 in stock?');
        assert.match(to(900)[0], /Telegram message from Asha:\n\nIs the A1 in stock\?\n\nAnswer with: \/reply 1401/);
        assert.match(to(1401)[0], /passed your message to the ProtoDesign team/);

        sent = [];
        await update(900, '/reply 1401 Yes, ships tomorrow.');
        assert.deepEqual(to(1401), ['ProtoDesign: Yes, ships tomorrow.']);
        assert.deepEqual(to(900), ['Sent to 1401.']);
    });

    it('forwards at most one message per chat every few seconds', async () => {
        await update(1402, 'first');
        sent = [];
        await update(1402, 'second');
        assert.equal(to(900).length, 0);
        assert.match(to(1402)[0], /Please wait a few seconds/);
    });

    it('refuses a /reply target that is not a valid chat id', async () => {
        await update(900, '/reply 99999999999999999999 hi');
        assert.deepEqual(to(900), ['To answer a customer: /reply <chat id> <your message>']);
    });

    it('does not forward the shop its own messages', async () => {
        await update(900, 'hello');
        assert.deepEqual(to(900), ['To answer a customer: /reply <chat id> <your message>']);
    });
});
