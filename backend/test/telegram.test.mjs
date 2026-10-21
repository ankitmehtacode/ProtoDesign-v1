// Telegram shop alerts through the real Lambda entrypoint, against a real
// Postgres, with Telegram's Bot API stubbed: which events alert the admin
// chats, that a slow Telegram cannot hold up a payment, and what the bot says
// to admin and non-admin chats.
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
process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
process.env.TELEGRAM_ADMIN_CHAT_IDS = '900';
process.env.FRONTEND_URL = 'https://shop.example';

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const telegram = await import('../src/services/telegram.service.js');
const { settlePayment, releaseStaleHolds } = await import('../src/services/order.service.js');
const { phonePeService } = await import('../src/services/phonepe.service.js');
const { OAuth2Client } = await import('google-auth-library');

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

describe('the bot', () => {
    it('rejects a webhook call without the secret, and ignores group chats', async () => {
        assert.equal((await update(1003, '/start', { secret: 'wrong' })).status, 401);
        assert.equal((await update(1003, '/start', { type: 'group' })).status, 200);
        assert.equal(sent.length, 0);
    });

    it('confirms alerts to an admin chat', async () => {
        await update(900, '/start');
        assert.deepEqual(to(900), ['ProtoDesign shop alerts are on for this chat (900).']);
    });

    it('tells anyone else it is for the team, and forwards nothing to the shop', async () => {
        await update(1401, 'Is the A1 in stock?');
        assert.match(to(1401)[0], /shop alerts to the team only\. For updates on your order, use WhatsApp or email\.\n\nChat ID: 1401$/);
        assert.equal(to(900).length, 0);
    });
});

describe('shop alerts', () => {
    it('alerts the shop when a payment settles, exactly once', async () => {
        const order = await seedOrder(await seedUser());
        assert.equal(await settlePayment(order, { state: 'COMPLETED', amount: 10000 }), 'paid');
        assert.equal(to(900).length, 1);
        assert.match(to(900)[0], /New paid order #[0-9A-F]{8}\nAsha Rao · ₹100\n• 1 × Bambu Lab A1\nPhone: 9876543210/);
        assert.match(to(900)[0], /https:\/\/shop\.example\/admin\?tab=orders$/);

        sent = [];
        assert.equal(await settlePayment(order, { state: 'COMPLETED', amount: 10000 }), 'noop');
        assert.equal(sent.length, 0);
    });

    it('alerts the shop when a payment fails', async () => {
        const order = await seedOrder(await seedUser());
        assert.equal(await settlePayment(order, { state: 'FAILED' }), 'cancelled');
        assert.match(to(900).join(), /Payment failed for order #[0-9A-F]{8}/);
    });

    it('settles a payment within one send timeout when Telegram hangs', async () => {
        const order = await seedOrder(await seedUser());
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
        const products = (await db.any('SELECT product_id FROM order_items WHERE order_id IN ($1, $2)', [a, b])).map((r) => r.product_id);
        const realVerify = phonePeService.verifyPaymentStatus;
        phonePeService.verifyPaymentStatus = async () => ({ state: 'FAILED' });
        try {
            assert.equal(await releaseStaleHolds(products), 2);
        } finally {
            phonePeService.verifyPaymentStatus = realVerify;
        }
        assert.equal(to(900).length, 1);
        assert.match(to(900)[0], /Cancelled 2 unpaid checkouts to free stock: #[0-9A-F]{8}, #[0-9A-F]{8}/);
    });

    it('alerts the shop about a new quote', async () => {
        await telegram.alertNewQuote({ quoteId: '1a2b3c4d-0000-4000-8000-000000000000', fileName: 'bracket.stl', price: 450,
            contact: { name: 'Asha Rao', phone: '9876543210', email: 'asha@test.local' } });
        assert.deepEqual(to(900), ['🧊 New quote #1A2B3C4D: bracket.stl\nAsha Rao · ₹450\nPhone: 9876543210\nEmail: asha@test.local\n\nhttps://shop.example/admin?tab=quotes']);
    });

    it('sends nothing when no admin chat is set', async () => {
        const saved = process.env.TELEGRAM_ADMIN_CHAT_IDS;
        process.env.TELEGRAM_ADMIN_CHAT_IDS = '';
        try {
            const order = await seedOrder(await seedUser());
            await settlePayment(order, { state: 'COMPLETED', amount: 10000 });
        } finally {
            process.env.TELEGRAM_ADMIN_CHAT_IDS = saved;
        }
        assert.equal(sent.length, 0);
    });
});

describe('sign-in alerts', () => {
    it('alerts on a new email account, a sign-in, and not on a wrong password', async () => {
        const body = { email: 'Ravi@Test.local', password: 'correct-horse', fullName: 'Ravi Kumar' };
        assert.equal((await call('POST', '/api/auth/signup', { body })).status, 201);
        assert.deepEqual(to(900), ['🆕 New account via email: Ravi Kumar (ravi@test.local)']);

        sent = [];
        assert.equal((await call('POST', '/api/auth/login', { body: { email: body.email, password: body.password } })).status, 200);
        assert.deepEqual(to(900), ['👤 Signed in via email: Ravi Kumar (ravi@test.local)']);

        sent = [];
        assert.equal((await call('POST', '/api/auth/login', { body: { email: body.email, password: 'wrong-password' } })).status, 401);
        assert.equal(sent.length, 0);
    });

    it('keeps a signed-up name on one line, so it cannot fake an alert', async () => {
        const fullName = 'Ravi\n\n🛒 New paid order #AB12CD34\nPhone: 9999999999';
        const body = { email: 'fake@test.local', password: 'correct-horse', fullName };
        assert.equal((await call('POST', '/api/auth/signup', { body })).status, 201);
        assert.deepEqual(to(900), ['🆕 New account via email: Ravi 🛒 New paid order #AB12CD34 Phone: 9999999999 (fake@test.local)']);
    });

    it('signs in within one send timeout when Telegram hangs', async () => {
        const body = { email: 'slow@test.local', password: 'correct-horse', fullName: 'Slow Net' };
        assert.equal((await call('POST', '/api/auth/signup', { body })).status, 201);
        reply = () => 'hang';
        const started = Date.now();
        const res = await call('POST', '/api/auth/login', { body: { email: body.email, password: body.password } });
        const took = Date.now() - started;
        assert.equal(res.status, 200);
        assert.ok(res.body.token || res.body.data?.token, 'login returns a token');
        assert.ok(took < 3000, `login took ${took} ms`);
    });

    it('alerts on a Google sign-in, new account first, and marks an admin', async () => {
        const realVerify = OAuth2Client.prototype.verifyIdToken;
        OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => ({ email: 'meera@test.local', name: 'Meera Shah' }) });
        try {
            assert.equal((await call('POST', '/api/auth/google', { body: { token: 'google-id-token' } })).status, 200);
            assert.deepEqual(to(900), ['🆕 New account via Google: Meera Shah (meera@test.local)']);

            await db.none(`UPDATE user_roles SET role = 'admin' WHERE user_id = (SELECT id FROM users WHERE email = 'meera@test.local')`);
            sent = [];
            assert.equal((await call('POST', '/api/auth/google', { body: { token: 'google-id-token' } })).status, 200);
            assert.deepEqual(to(900), ['👤 Signed in via Google: Meera Shah (meera@test.local) · ADMIN']);
        } finally {
            OAuth2Client.prototype.verifyIdToken = realVerify;
        }
    });
});
