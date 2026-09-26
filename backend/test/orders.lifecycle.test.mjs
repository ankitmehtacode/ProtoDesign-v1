// Order lifecycle tests: payment settlement, stock reservation/release,
// authorization, and hostile input.
//
// Runs against a real disposable Postgres with the project's migrations
// (see helpers/temp-postgres.mjs). Only PhonePe's HTTP calls are stubbed --
// that is the one boundary these tests do not cross.
//
//   node --test test/orders.lifecycle.test.mjs

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.PHONEPE_WEBHOOK_USERNAME = 'hook-user';
process.env.PHONEPE_WEBHOOK_PASSWORD = 'hook-pass';

const { default: db, pgp } = await import('../src/config/database.js');
const orders = await import('../src/services/order.service.js');
const { phonePeService } = await import('../src/services/phonepe.service.js');
const { emailService } = await import('../src/services/email.service.js');
const { default: ordersRouter } = await import('../src/routes/orders.routes.js');
const { default: errorHandler } = await import('../src/middleware/errorHandler.js');

// ---- capture structured logs so tests can assert on them ------------------
const logs = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = (...args) => logs.push(args.join(' '));
const logged = (event) => logs.some((l) => l.includes(`"event":"${event}"`));

// ---- PhonePe boundary stub ------------------------------------------------
const gateway = { responses: new Map(), calls: [], failInitiate: false };
phonePeService.verifyPaymentStatus = async (orderId) => {
    gateway.calls.push(orderId);
    const r = gateway.responses.get(orderId);
    if (r instanceof Error) throw r;
    if (!r) throw Object.assign(new Error('order not found'), { response: { status: 404 } });
    return r;
};
phonePeService.initiatePayment = async () => {
    if (gateway.failInitiate) throw new Error('Payment Gateway Error');
    return 'https://pay.example/redirect';
};
// ---- email boundary stub (no SMTP in tests) -------------------------------
emailService.sendOrderConfirmation = async () => {};
emailService.sendOrderStatusEmail = async () => {};

const gatewayState = (orderId, state, amountPaise) => gateway.responses.set(orderId, { state, amount: amountPaise });
const gatewayCompleted = (order) => gatewayState(order.id, 'COMPLETED', Math.round(Number(order.total_amount) * 100));

// ---- HTTP app -------------------------------------------------------------
const app = express();
app.use(express.json());
app.use('/api/orders', ordersRouter);
app.use(errorHandler);
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};
const tokenFor = (userId, role = 'user') => jwt.sign({ userId, email: 'x@test.local', role }, process.env.JWT_SECRET);
const hookAuth = createHash('sha256').update('hook-user:hook-pass').digest('hex');

// ---- fixtures -------------------------------------------------------------
let seq = 0;
async function seedUser({ admin = false } = {}) {
    const u = await db.one(`INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Test User') RETURNING id`, [`user${++seq}@test.local`]);
    await db.none('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [u.id, admin ? 'admin' : 'user']);
    return u.id;
}
// The column default category is '3d_printer', which changes shipping and COD
// rules, so fixtures default to an ordinary category.
const seedProduct = async ({ stock = 10, price = '199.00', category = 'filament', specifications = {} } = {}) =>
    (await db.one('INSERT INTO products (name, price, stock, category, specifications) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [`Widget ${++seq}`, price, stock, category, JSON.stringify(specifications)])).id;
const stockOf = async (id) => (await db.one('SELECT stock FROM products WHERE id = $1', [id])).stock;
const orderRow = (id) => db.one('SELECT * FROM orders WHERE id = $1', [id]);
const place = async (userId, lines, paymentGateway = 'phonepe') => (await orders.createOrder({
    userId,
    items: lines.map(([product_id, quantity]) => ({ product_id, quantity })),
    shippingAddress: { phone: '9000000000', city: 'Pune' },
    paymentGateway
})).order;
const backdate = (orderId, minutes) =>
    db.none(`UPDATE orders SET created_at = NOW() - make_interval(mins => $2) WHERE id = $1`, [orderId, minutes]);
const rejectsWith = async (promise, status) => {
    await assert.rejects(promise, (err) => { assert.equal(err.status, status, err.message); return true; });
};

after(async () => {
    Object.assign(console, realConsole);
    await new Promise((resolve) => server.close(resolve));
    await pgp.end();
    pg.stop();
});

// ===========================================================================
describe('createOrder: server-side pricing and stock reservation', () => {
    it('computes GST (included in the price), shipping and total from the database and reserves stock', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 10, price: '199.00' });
        const order = await place(user, [[product, 2]]);

        assert.equal(order.subtotal_amount, '398.00');
        assert.equal(order.tax_amount, '60.71');     // 398 - 398/1.18
        assert.equal(order.shipping_amount, '199.00');
        assert.equal(order.total_amount, '597.00');   // subtotal + shipping; GST is not added on top
        assert.equal(order.status, 'pending');
        assert.equal(await stockOf(product), 8);
    });

    it('charges COD shipping for an eligible cash-on-delivery order', async () => {
        const user = await seedUser();
        const order = await place(user, [[await seedProduct({ price: '500.00' }), 1]], 'cod');
        assert.deepEqual([order.shipping_amount, order.total_amount], ['300.00', '800.00']);
    });

    it('ships 3D printers free and refuses them as cash on delivery', async () => {
        const user = await seedUser();
        const printer = await seedProduct({ price: '20000.00', category: '3d_printer', stock: 5 });
        const order = await place(user, [[printer, 1], [await seedProduct({ price: '100.00' }), 1]]);
        assert.deepEqual([order.shipping_amount, order.total_amount], ['0.00', '20100.00']);

        await rejectsWith(place(user, [[printer, 1]], 'cod'), 400);
        assert.equal(await stockOf(printer), 4);
    });

    it('refuses cash on delivery at or above the subtotal limit unless a product overrides it', async () => {
        const user = await seedUser();
        const plain = await seedProduct({ price: '999.00', stock: 5 });
        await rejectsWith(place(user, [[plain, 1]], 'cod'), 400);
        assert.equal(await stockOf(plain), 5);

        // Both shapes the product editor has written for specifications.
        for (const specifications of [[{ key: 'allow_cod_override', value: 'true' }], { allow_cod_override: 'TRUE' }]) {
            const overridden = await seedProduct({ price: '999.00', specifications });
            const order = await place(user, [[overridden, 1]], 'cod');
            assert.equal(order.shipping_amount, '300.00');
        }
    });

    it('rejects negative, zero, fractional, non-numeric and absurd quantities without touching stock', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5 });
        for (const quantity of [-5, 0, 1.5, 'abc', null, 1001]) {
            await rejectsWith(place(user, [[product, quantity]]), 400);
        }
        assert.equal(await stockOf(product), 5);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM orders WHERE user_id = $1', [user])).n, 0);
    });

    it('rejects malformed input: bad product id, empty items, unknown gateway', async () => {
        const user = await seedUser();
        const product = await seedProduct();
        await rejectsWith(place(user, [['not-a-uuid', 1]]), 400);
        await rejectsWith(orders.createOrder({ userId: user, items: [], shippingAddress: {}, paymentGateway: 'phonepe' }), 400);
        await rejectsWith(place(user, [[product, 1]], 'bitcoin'), 400);
        await rejectsWith(place(user, [[randomUUID(), 1]]), 404);
    });

    it('lets exactly one of two concurrent buyers take the last unit', async () => {
        const [a, b] = [await seedUser(), await seedUser()];
        const product = await seedProduct({ stock: 1 });

        const results = await Promise.allSettled([place(a, [[product, 1]]), place(b, [[product, 1]])]);

        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        const loser = results.find((r) => r.status === 'rejected');
        assert.equal(loser.reason.status, 409);
        assert.equal(await stockOf(product), 0);
    });

    it('merges duplicate lines and checks the combined quantity against stock', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 3 });
        await rejectsWith(place(user, [[product, 2], [product, 2]]), 409);
        assert.equal(await stockOf(product), 3);
    });

    it('rolls the whole order back when a later line is out of stock', async () => {
        const user = await seedUser();
        const plenty = await seedProduct({ stock: 10 });
        const scarce = await seedProduct({ stock: 0 });
        await rejectsWith(place(user, [[plenty, 1], [scarce, 1]]), 409);
        assert.equal(await stockOf(plenty), 10, 'first line must not stay debited');
        assert.equal((await db.one('SELECT count(*)::int AS n FROM orders WHERE user_id = $1', [user])).n, 0);
    });
});

// ===========================================================================
describe('cancelOrder: stock is returned exactly once', () => {
    it('restores stock on cancel', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5 });
        const order = await place(user, [[product, 3]]);
        assert.equal(await stockOf(product), 2);

        assert.equal(await orders.cancelOrder(order.id), true);
        assert.equal(await stockOf(product), 5);
        assert.equal((await orderRow(order.id)).status, 'cancelled');
    });

    it('restores stock once even when cancels race', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5 });
        const order = await place(user, [[product, 3]]);

        const results = await Promise.all([1, 2, 3, 4].map(() => orders.cancelOrder(order.id)));

        assert.equal(results.filter(Boolean).length, 1);
        assert.equal(await stockOf(product), 5, 'stock must not be over-restored');
    });

    it('will not cancel a paid order from a payment-failure path', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5 });
        const order = await place(user, [[product, 1]]);
        await db.none(`UPDATE orders SET status = 'processing', payment_status = 'paid' WHERE id = $1`, [order.id]);

        assert.equal(await orders.cancelOrder(order.id, { from: orders.PENDING_STATUSES, paymentStatus: 'failed' }), false);
        assert.equal((await orderRow(order.id)).status, 'processing');
        assert.equal(await stockOf(product), 4);
    });
});

// ===========================================================================
describe('settlePayment: only PhonePe-verified, amount-matching payments count', () => {
    const fresh = async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5, price: '100.00' });
        return { user, product, order: await place(user, [[product, 1]]) }; // total 299.00 (GST included)
    };

    it('marks paid when COMPLETED for the exact amount, and replays are no-ops', async () => {
        const { order } = await fresh();
        assert.equal(await orders.settlePayment(order.id, { state: 'COMPLETED', amount: 29900 }), 'paid');
        const row = await orderRow(order.id);
        assert.equal(row.status, 'processing');
        assert.equal(row.payment_status, 'paid');
        assert.equal(await orders.settlePayment(order.id, { state: 'COMPLETED', amount: 29900 }), 'noop');
    });

    it('refuses to mark paid when the collected amount differs or is missing', async () => {
        const { order } = await fresh();
        for (const data of [{ state: 'COMPLETED', amount: 100 }, { state: 'COMPLETED', amount: 16799 },
            { state: 'COMPLETED' }, { state: 'COMPLETED', amount: 'lots' }]) {
            assert.equal(await orders.settlePayment(order.id, data), 'amount_mismatch');
        }
        assert.equal((await orderRow(order.id)).status, 'pending');
        assert.ok(logged('payment_amount_mismatch'));
    });

    it('cancels and releases stock on FAILED', async () => {
        const { order, product } = await fresh();
        assert.equal(await orders.settlePayment(order.id, { state: 'FAILED' }), 'cancelled');
        const row = await orderRow(order.id);
        assert.equal(row.status, 'cancelled');
        assert.equal(row.payment_status, 'failed');
        assert.equal(await stockOf(product), 5);
    });

    it('ignores a late FAILED notice for an order that has since been paid', async () => {
        const { order, product } = await fresh();
        await orders.settlePayment(order.id, { state: 'COMPLETED', amount: 29900 });
        assert.equal(await orders.settlePayment(order.id, { state: 'FAILED' }), 'noop');
        assert.equal((await orderRow(order.id)).status, 'processing');
        assert.equal(await stockOf(product), 4);
    });

    it('records and flags money received for an already-cancelled order', async () => {
        const { order, product } = await fresh();
        await orders.cancelOrder(order.id);
        assert.equal(await orders.settlePayment(order.id, { state: 'COMPLETED', amount: 29900 }), 'paid_after_cancel');
        const row = await orderRow(order.id);
        assert.equal(row.status, 'cancelled');
        assert.equal(row.payment_status, 'paid', 'must be queryable as cancelled+paid to trigger a refund');
        assert.equal(await stockOf(product), 5, 'stock must not be re-debited');
        assert.ok(logged('payment_received_for_cancelled_order'));
    });

    it('leaves PENDING alone and reports unknown orders', async () => {
        const { order } = await fresh();
        assert.equal(await orders.settlePayment(order.id, { state: 'PENDING' }), 'pending');
        assert.equal(await orders.settlePayment(randomUUID(), { state: 'COMPLETED', amount: 1 }), 'unknown_order');
    });
});

// ===========================================================================
describe('reconcilePendingOrder: a gateway error is never read as "not paid"', () => {
    const fresh = async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5, price: '100.00' });
        return { user, product, order: await place(user, [[product, 1]]) };
    };

    it('keeps the order pending and stock held on a network error, even when old', async () => {
        const { order, product } = await fresh();
        await backdate(order.id, 120);
        gateway.responses.set(order.id, Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

        assert.equal(await orders.reconcilePendingOrder(order.id), 'unverified');
        assert.equal((await orderRow(order.id)).status, 'pending');
        assert.equal(await stockOf(product), 4);
        assert.ok(logged('payment_verify_failed'));
    });

    it('does not believe "unknown to gateway" for a brand-new order', async () => {
        const { order } = await fresh(); // no gateway response registered => 404
        assert.equal(await orders.reconcilePendingOrder(order.id), 'unverified');
        assert.equal((await orderRow(order.id)).status, 'pending');
    });

    it('cancels and releases stock once the gateway has never heard of an old order', async () => {
        const { order, product } = await fresh();
        await backdate(order.id, 10);
        assert.equal(await orders.reconcilePendingOrder(order.id), 'cancelled');
        assert.equal((await orderRow(order.id)).status, 'cancelled');
        assert.equal(await stockOf(product), 5);
    });

    it('recognises the documented INVALID_MERCHANT_ORDER_ID body whatever the HTTP status', async () => {
        const { order, product } = await fresh();
        await backdate(order.id, 10);
        gateway.responses.set(order.id, Object.assign(new Error('unprocessable'), {
            response: { status: 422, data: { code: 'INVALID_MERCHANT_ORDER_ID', message: 'No entry found for given merchant order id' } }
        }));
        assert.equal(await orders.reconcilePendingOrder(order.id), 'cancelled');
        assert.equal(await stockOf(product), 5);
    });

    it('skips orders that are not pending PhonePe orders', async () => {
        const user = await seedUser();
        const product = await seedProduct();
        const cod = await place(user, [[product, 1]], 'cod');
        assert.equal(await orders.reconcilePendingOrder(cod.id), 'skipped');
    });
});

// ===========================================================================
describe('abandoned checkouts release stock when it is needed', () => {
    it('gives the last unit to a new buyer once PhonePe confirms the old hold failed', async () => {
        const [a, b] = [await seedUser(), await seedUser()];
        const product = await seedProduct({ stock: 1 });
        const abandoned = await place(a, [[product, 1]]);
        await backdate(abandoned.id, 20);
        gatewayState(abandoned.id, 'FAILED');

        const order = await place(b, [[product, 1]]);

        assert.ok(order.id);
        assert.equal((await orderRow(abandoned.id)).status, 'cancelled');
        assert.equal(await stockOf(product), 0);
    });

    it('keeps the hold while PhonePe still says the payment may complete', async () => {
        const [a, b] = [await seedUser(), await seedUser()];
        const product = await seedProduct({ stock: 1 });
        const inFlight = await place(a, [[product, 1]]);
        await backdate(inFlight.id, 20);
        gatewayState(inFlight.id, 'PENDING');

        await rejectsWith(place(b, [[product, 1]]), 409);
        assert.equal((await orderRow(inFlight.id)).status, 'pending');
    });
});

// ===========================================================================
describe('PhonePe callback', () => {
    const fresh = async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5, price: '100.00' });
        return { user, product, order: await place(user, [[product, 1]]) };
    };
    const forged = (orderId) => ({ event: 'checkout.order.completed', payload: { merchantOrderId: orderId, state: 'COMPLETED', amount: 1 } });
    const callback = (orderId, headers = {}, body = forged(orderId)) =>
        call('POST', '/api/orders/payment/callback', { body, headers });

    it('cannot be used to mark an order paid: the body is not evidence', async () => {
        const { order } = await fresh();
        gatewayState(order.id, 'PENDING'); // reality: not paid

        const res = await callback(order.id, { Authorization: hookAuth });

        assert.equal(res.status, 200);
        assert.equal((await orderRow(order.id)).status, 'pending');
        assert.equal((await orderRow(order.id)).payment_status, 'pending');
    });

    it('rejects a missing or wrong Authorization header without contacting PhonePe', async () => {
        const { order } = await fresh();
        gatewayCompleted(order);
        const callsBefore = gateway.calls.length;

        assert.equal((await callback(order.id)).status, 401);
        assert.equal((await callback(order.id, { Authorization: 'deadbeef' })).status, 401);
        assert.equal(gateway.calls.length, callsBefore);
        assert.equal((await orderRow(order.id)).status, 'pending');
    });

    it('settles a genuinely completed payment (header with or without SHA256 prefix)', async () => {
        const { order } = await fresh();
        gatewayCompleted(order);
        assert.equal((await callback(order.id, { Authorization: `SHA256 ${hookAuth}` })).status, 200);
        assert.equal((await orderRow(order.id)).status, 'processing');
    });

    it('accepts the base64 `response` envelope', async () => {
        const { order } = await fresh();
        gatewayCompleted(order);
        const body = { response: Buffer.from(JSON.stringify({ data: { merchantOrderId: order.id } })).toString('base64') };
        assert.equal((await callback(order.id, { Authorization: hookAuth }, body)).status, 200);
        assert.equal((await orderRow(order.id)).status, 'processing');
    });

    it('cancels and releases stock when PhonePe reports failure', async () => {
        const { order, product } = await fresh();
        gatewayState(order.id, 'FAILED');
        await callback(order.id, { Authorization: hookAuth });
        assert.equal((await orderRow(order.id)).status, 'cancelled');
        assert.equal(await stockOf(product), 5);
    });

    it('returns 503 (so PhonePe retries) when the gateway cannot be reached', async () => {
        const { order } = await fresh();
        gateway.responses.set(order.id, Object.assign(new Error('down'), { code: 'ETIMEDOUT' }));
        assert.equal((await callback(order.id, { Authorization: hookAuth })).status, 503);
        assert.equal((await orderRow(order.id)).status, 'pending');
    });

    it('rejects bodies without a valid order id', async () => {
        for (const body of [{}, { payload: { merchantOrderId: "1'; DROP TABLE orders;--" } }, { response: '%%%not-base64-json' }]) {
            assert.equal((await callback(randomUUID(), { Authorization: hookAuth }, body)).status, 400);
        }
        // no body at all (Express 5 leaves req.body undefined)
        const res = await fetch(`${base}/api/orders/payment/callback`, { method: 'POST', headers: { Authorization: hookAuth } });
        assert.equal(res.status, 400);
    });

    it('flags a completed payment that arrives after the customer cancelled', async () => {
        const { order } = await fresh();
        await orders.cancelOrder(order.id);
        gatewayCompleted(order);
        await callback(order.id, { Authorization: hookAuth });
        const row = await orderRow(order.id);
        assert.deepEqual([row.status, row.payment_status], ['cancelled', 'paid']);
    });

    it('still verifies with PhonePe when webhook credentials are not configured, and says so', async () => {
        const { order } = await fresh();
        gatewayCompleted(order);
        const saved = [process.env.PHONEPE_WEBHOOK_USERNAME, process.env.PHONEPE_WEBHOOK_PASSWORD];
        delete process.env.PHONEPE_WEBHOOK_USERNAME;
        delete process.env.PHONEPE_WEBHOOK_PASSWORD;
        try {
            assert.equal((await callback(order.id)).status, 200);
            assert.equal((await orderRow(order.id)).status, 'processing');
            assert.ok(logged('payment_callback_auth_unconfigured'));
        } finally {
            [process.env.PHONEPE_WEBHOOK_USERNAME, process.env.PHONEPE_WEBHOOK_PASSWORD] = saved;
        }
    });
});

describe('verifyCallbackAuth', () => {
    it('validates SHA256(username:password) in constant-time-safe fashion', () => {
        assert.deepEqual(phonePeService.verifyCallbackAuth(hookAuth), { configured: true, valid: true });
        assert.deepEqual(phonePeService.verifyCallbackAuth(hookAuth.toUpperCase()), { configured: true, valid: true });
        assert.equal(phonePeService.verifyCallbackAuth('nope').valid, false);
        assert.equal(phonePeService.verifyCallbackAuth('').valid, false);
        assert.equal(phonePeService.verifyCallbackAuth(undefined).valid, false);
        assert.equal(phonePeService.verifyCallbackAuth(['a', 'b']).valid, false);
    });
});

// ===========================================================================
describe('POST /api/orders', () => {
    it('ignores client-supplied totals and shipping fees', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5, price: '100.00' });

        const res = await call('POST', '/api/orders', {
            token: tokenFor(user),
            body: {
                items: [{ product_id: product, quantity: 1, price: 0.01 }],
                shippingAmount: -1000, totalAmount: 1,
                shippingAddress: { phone: '9000000000' }, paymentGateway: 'phonepe'
            }
        });

        assert.equal(res.status, 201);
        assert.ok(res.body.redirectUrl);
        const row = await orderRow(res.body.orderId);
        assert.deepEqual([row.subtotal_amount, row.tax_amount, row.shipping_amount, row.total_amount],
            ['100.00', '15.25', '199.00', '299.00']);
    });

    it('releases the reserved stock when payment initiation fails', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5 });
        gateway.failInitiate = true;
        try {
            const res = await call('POST', '/api/orders', {
                token: tokenFor(user),
                body: { items: [{ product_id: product, quantity: 2 }], shippingAddress: { phone: '9' }, paymentGateway: 'phonepe' }
            });
            assert.equal(res.status, 400);
        } finally {
            gateway.failInitiate = false;
        }
        assert.equal(await stockOf(product), 5);
        const [row] = await db.any('SELECT status, payment_status FROM orders WHERE user_id = $1', [user]);
        assert.deepEqual([row.status, row.payment_status], ['cancelled', 'failed']);
    });

    it('rejects a missing address, and hostile quantities, with 400 and no side effects', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5 });
        const token = tokenFor(user);
        assert.equal((await call('POST', '/api/orders', { token, body: { items: [{ product_id: product, quantity: 1 }] } })).status, 400);
        const negative = await call('POST', '/api/orders', {
            token, body: { items: [{ product_id: product, quantity: -50 }], shippingAddress: {}, paymentGateway: 'phonepe' }
        });
        assert.equal(negative.status, 400);
        assert.equal(await stockOf(product), 5);
    });

    it('does not leak internal error text on a 500', async () => {
        const res = await call('GET', '/api/orders/admin/all', { token: tokenFor(await seedUser(), 'admin') });
        assert.equal(res.status, 403); // sanity: a plain auth failure is still specific
        const original = db.any;
        db.any = async () => { throw new Error('connection to server at "10.0.3.7" failed: password authentication'); };
        try {
            const r = await call('GET', '/api/orders', { token: tokenFor(await seedUser()) });
            assert.equal(r.status, 500);
            assert.equal(r.body.error.message, 'Internal Server Error');
            assert.ok(!JSON.stringify(r.body).includes('10.0.3.7'));
        } finally {
            db.any = original;
        }
    });
});

// ===========================================================================
describe('cancel and address update act on the requested order only', () => {
    it('cancelling one order leaves a same-second sibling untouched', async () => {
        const user = await seedUser();
        const [p1, p2] = [await seedProduct({ stock: 5 }), await seedProduct({ stock: 5 })];
        const first = await place(user, [[p1, 1]]);
        const second = await place(user, [[p2, 1]]);
        await db.none('UPDATE orders SET created_at = (SELECT created_at FROM orders WHERE id = $1) WHERE id = $2', [first.id, second.id]);

        const res = await call('POST', `/api/orders/${first.id}/cancel`, { token: tokenFor(user) });

        assert.equal(res.status, 200);
        assert.equal((await orderRow(first.id)).status, 'cancelled');
        assert.equal((await orderRow(second.id)).status, 'pending');
        assert.equal(await stockOf(p1), 5);
        assert.equal(await stockOf(p2), 4, 'sibling order must keep its reservation');
    });

    it('updating one order address leaves a same-second sibling untouched', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 9 });
        const first = await place(user, [[product, 1]]);
        const second = await place(user, [[product, 1]]);
        await db.none('UPDATE orders SET created_at = (SELECT created_at FROM orders WHERE id = $1) WHERE id = $2', [first.id, second.id]);

        const res = await call('PUT', `/api/orders/${first.id}/address`, { token: tokenFor(user), body: { address: { city: 'Delhi' } } });

        assert.equal(res.status, 200);
        assert.equal((await orderRow(first.id)).shipping_address.city, 'Delhi');
        assert.equal((await orderRow(second.id)).shipping_address.city, 'Pune');
    });

    it("cannot touch another user's order, and reports 404 not 403 (no existence leak)", async () => {
        const [owner, intruder] = [await seedUser(), await seedUser()];
        const product = await seedProduct({ stock: 5 });
        const order = await place(owner, [[product, 1]]);
        const token = tokenFor(intruder);

        assert.equal((await call('POST', `/api/orders/${order.id}/cancel`, { token })).status, 404);
        assert.equal((await call('PUT', `/api/orders/${order.id}/address`, { token, body: { address: { city: 'X' } } })).status, 404);
        assert.equal((await call('GET', `/api/orders/${order.id}`, { token })).status, 404);
        assert.equal((await orderRow(order.id)).status, 'pending');
    });

    it('refuses to cancel or re-address a shipped order, and handles bad ids without a 500', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5 });
        const order = await place(user, [[product, 1]]);
        await db.none(`UPDATE orders SET status = 'shipped' WHERE id = $1`, [order.id]);
        const token = tokenFor(user);

        assert.equal((await call('POST', `/api/orders/${order.id}/cancel`, { token })).status, 400);
        assert.equal((await call('PUT', `/api/orders/${order.id}/address`, { token, body: { address: { city: 'X' } } })).status, 400);
        assert.equal(await stockOf(product), 4, 'shipped goods are not restocked');
        assert.equal((await call('POST', '/api/orders/not-a-uuid/cancel', { token })).status, 404);
        assert.equal((await call('GET', '/api/orders/not-a-uuid', { token })).status, 404);
    });
});

// ===========================================================================
describe('GET /api/orders reconciliation', () => {
    it('reflects a payment completed moments ago even before the webhook arrives', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5, price: '100.00' });
        const order = await place(user, [[product, 1]]);
        gatewayCompleted(order);

        const res = await call('GET', '/api/orders', { token: tokenFor(user) });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.find((o) => o.id === order.id).status, 'processing');
    });

    it('does not cancel an old pending order just because PhonePe was unreachable', async () => {
        const user = await seedUser();
        const product = await seedProduct({ stock: 5 });
        const order = await place(user, [[product, 1]]);
        await backdate(order.id, 240);
        gateway.responses.set(order.id, Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

        const res = await call('GET', '/api/orders', { token: tokenFor(user) });

        assert.equal(res.body.data.find((o) => o.id === order.id).status, 'pending');
        assert.equal(await stockOf(product), 4);
    });
});

// ===========================================================================
describe('admin authorization is read from user_roles, not the JWT', () => {
    it('rejects a token that merely claims role=admin', async () => {
        const notAdmin = await seedUser();
        assert.equal((await call('GET', '/api/orders/admin/all', { token: tokenFor(notAdmin, 'admin') })).status, 403);
    });

    it('honours a real admin even if their token predates the promotion', async () => {
        const admin = await seedUser({ admin: true });
        assert.equal((await call('GET', '/api/orders/admin/all', { token: tokenFor(admin, 'user') })).status, 200);
    });

    it('revokes immediately on demotion, without waiting for token expiry', async () => {
        const admin = await seedUser({ admin: true });
        const token = tokenFor(admin, 'admin');
        assert.equal((await call('GET', '/api/orders/admin/all', { token })).status, 200);
        await db.none(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'admin'`, [admin]);
        assert.equal((await call('GET', '/api/orders/admin/all', { token })).status, 403);
    });

    it('applies the same check to order updates', async () => {
        const [user, admin] = [await seedUser(), await seedUser({ admin: true })];
        const product = await seedProduct({ stock: 5 });
        const order = await place(user, [[product, 1]]);
        const attempt = (token) => call('PUT', `/api/orders/${order.id}`, { token, body: { status: 'shipped' } });

        assert.equal((await attempt(tokenFor(user, 'admin'))).status, 403);
        assert.equal((await attempt(tokenFor(admin))).status, 200);
    });
});

describe('admin order updates', () => {
    const setup = async () => {
        const [user, admin] = [await seedUser(), await seedUser({ admin: true })];
        const product = await seedProduct({ stock: 5 });
        const order = await place(user, [[product, 2]]);
        return { order, product, token: tokenFor(admin), put: (id, status, token) => call('PUT', `/api/orders/${id}`, { token, body: { status } }) };
    };

    it('returns stock when an admin cancels', async () => {
        const { order, product, token, put } = await setup();
        assert.equal((await put(order.id, 'cancelled', token)).status, 200);
        assert.equal(await stockOf(product), 5);
    });

    it('treats cancelled as terminal', async () => {
        const { order, product, token, put } = await setup();
        await put(order.id, 'cancelled', token);
        assert.equal((await put(order.id, 'processing', token)).status, 409);
        assert.equal((await orderRow(order.id)).status, 'cancelled');
        assert.equal(await stockOf(product), 5);
    });

    it('will not "cancel" an order that has already shipped (and so never restocks it)', async () => {
        const { order, product, token, put } = await setup();
        await put(order.id, 'shipped', token);
        assert.equal((await put(order.id, 'cancelled', token)).status, 409);
        assert.equal(await stockOf(product), 3);
    });

    it('validates status and id', async () => {
        const { order, token, put } = await setup();
        assert.equal((await put(order.id, 'teleported', token)).status, 400);
        assert.equal((await put(randomUUID(), 'shipped', token)).status, 404);
        assert.equal((await put('not-a-uuid', 'shipped', token)).status, 404);
    });
});
