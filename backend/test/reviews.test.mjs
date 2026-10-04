// POST /api/products/:id/reviews through the real Lambda entrypoint, against a
// real Postgres. Any signed-in user may review a product once; GET marks
// reviews by customers with a delivered or completed order as verified.
//
//   tsx --test test/reviews.test.mjs

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'reviews-test';

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

const call = async (method, path, { userId, body } = {}) => {
    const headers = { 'content-type': 'application/json', host: 'example.lambda-url.ap-southeast-1.on.aws' };
    if (userId) headers.authorization = `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;
    const res = await handler({
        version: '2.0',
        routeKey: '$default',
        rawPath: path,
        rawQueryString: '',
        headers,
        requestContext: { http: { method, path, sourceIp: '203.0.113.7' }, domainName: 'example' },
        body: body === undefined ? undefined : JSON.stringify(body),
        isBase64Encoded: false,
    }, {});
    return { status: res.statusCode, body: JSON.parse(res.body) };
};

let n = 0;
const seedUser = async () => (await db.one(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Buyer') RETURNING id`,
    [`buyer${++n}@test.local`])).id;
const seedProduct = async () => (await db.one(
    `INSERT INTO products (name, price) VALUES ('Widget', 10) RETURNING id`)).id;
const seedOrder = async (userId, productId, status) => {
    const o = await db.one(
        `INSERT INTO orders (user_id, subtotal_amount, tax_amount, shipping_amount, total_amount, status)
         VALUES ($1, 10, 0, 0, 10, $2) RETURNING id`, [userId, status]);
    await db.none(
        `INSERT INTO order_items (order_id, product_id, quantity, price, line_total) VALUES ($1, $2, 1, 10, 10)`,
        [o.id, productId]);
};

const review = { rating: 5, comment: 'Solid print quality' };

describe('POST /api/products/:id/reviews', () => {
    it('accepts a review from a user who never ordered the product, unverified', async () => {
        const [user, product] = [await seedUser(), await seedProduct()];
        const res = await call('POST', `/api/products/${product}/reviews`, { userId: user, body: review });
        assert.equal(res.status, 200);
        const list = await call('GET', `/api/products/${product}/reviews`);
        assert.equal(list.body[0].verified_purchase, false);
    });

    it('does not mark a review verified while the order is only shipped', async () => {
        const [user, product] = [await seedUser(), await seedProduct()];
        await seedOrder(user, product, 'shipped');
        await call('POST', `/api/products/${product}/reviews`, { userId: user, body: review });
        const list = await call('GET', `/api/products/${product}/reviews`);
        assert.equal(list.body[0].verified_purchase, false);
    });

    it('accepts one review from a customer who received the product, marked verified', async () => {
        const [user, product] = [await seedUser(), await seedProduct()];
        await seedOrder(user, product, 'delivered');

        const first = await call('POST', `/api/products/${product}/reviews`, { userId: user, body: review });
        assert.equal(first.status, 200);

        const second = await call('POST', `/api/products/${product}/reviews`, { userId: user, body: review });
        assert.equal(second.status, 409);

        const list = await call('GET', `/api/products/${product}/reviews`);
        assert.equal(list.body.length, 1);
        assert.equal(list.body[0].verified_purchase, true);

        const stats = await db.one('SELECT average_rating, review_count FROM products WHERE id = $1', [product]);
        assert.equal(Number(stats.average_rating), 5);
        assert.equal(Number(stats.review_count), 1);
    });

    it('rejects an out-of-range rating with 400', async () => {
        const [user, product] = [await seedUser(), await seedProduct()];
        await seedOrder(user, product, 'completed');
        for (const rating of [0, 6, 4.5, '5']) {
            const res = await call('POST', `/api/products/${product}/reviews`, { userId: user, body: { rating } });
            assert.equal(res.status, 400, `rating ${JSON.stringify(rating)}`);
        }
    });

    it('does not mark a pre-existing review verified when the author has no delivered order', async () => {
        const [user, product] = [await seedUser(), await seedProduct()];
        await db.none('INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1, $2, 4, $3)',
            [product, user, 'legacy review']);
        const list = await call('GET', `/api/products/${product}/reviews`);
        assert.equal(list.body[0].verified_purchase, false);
    });
});

describe('DELETE /api/products/:id/reviews/:reviewId', () => {
    const seedAdmin = async () => {
        const id = await seedUser();
        await db.none(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [id]);
        return id;
    };
    const post = async (user, product, rating = 5) => {
        await call('POST', `/api/products/${product}/reviews`, { userId: user, body: { rating, comment: 'ok' } });
        return (await db.one('SELECT id FROM reviews WHERE product_id = $1 AND user_id = $2', [product, user])).id;
    };
    const stats = async (product) => {
        const s = await db.one('SELECT average_rating, review_count FROM products WHERE id = $1', [product]);
        return [Number(s.average_rating), Number(s.review_count)];
    };

    it('lets an admin delete a review and recomputes the product stats', async () => {
        const [a, b, admin, product] = [await seedUser(), await seedUser(), await seedAdmin(), await seedProduct()];
        const first = await post(a, product, 5);
        await post(b, product, 2);
        assert.deepEqual(await stats(product), [3.5, 2]);

        const res = await call('DELETE', `/api/products/${product}/reviews/${first}`, { userId: admin });
        assert.equal(res.status, 200);
        assert.deepEqual(await stats(product), [2, 1]);
    });

    it('forbids a customer from deleting any review, including their own', async () => {
        const [a, b, product] = [await seedUser(), await seedUser(), await seedProduct()];
        const own = await post(a, product);
        assert.equal((await call('DELETE', `/api/products/${product}/reviews/${own}`, { userId: a })).status, 403);
        assert.equal((await call('DELETE', `/api/products/${product}/reviews/${own}`, { userId: b })).status, 403);
        assert.deepEqual(await stats(product), [5, 1]);
    });

    it('accepts the product slug and resets stats to zero when the last review goes', async () => {
        const [a, admin, product] = [await seedUser(), await seedAdmin(), await seedProduct()];
        await db.none(`UPDATE products SET slug = 'widget-del' WHERE id = $1`, [product]);
        const id = await post(a, product);

        const res = await call('DELETE', `/api/products/widget-del/reviews/${id}`, { userId: admin });
        assert.equal(res.status, 200);
        assert.deepEqual(await stats(product), [0, 0]);
    });

    it('returns 404 for a review of a different product, a malformed id, or a repeat delete', async () => {
        const [a, admin, p1, p2] = [await seedUser(), await seedAdmin(), await seedProduct(), await seedProduct()];
        const id = await post(a, p1);
        assert.equal((await call('DELETE', `/api/products/${p2}/reviews/${id}`, { userId: admin })).status, 404);
        assert.equal((await call('DELETE', `/api/products/${p1}/reviews/not-a-uuid`, { userId: admin })).status, 404);
        assert.equal((await call('DELETE', `/api/products/${p1}/reviews/${id}`, { userId: admin })).status, 200);
        assert.equal((await call('DELETE', `/api/products/${p1}/reviews/${id}`, { userId: admin })).status, 404);
    });

    it('requires sign-in', async () => {
        const [a, product] = [await seedUser(), await seedProduct()];
        const id = await post(a, product);
        assert.equal((await call('DELETE', `/api/products/${product}/reviews/${id}`)).status, 401);
    });
});
