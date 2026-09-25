// PUT /api/products/:id through the real Lambda entrypoint, against a real
// Postgres. Each case here returned a 500 before: a multipart body (empty under
// Lambda), imagesToDelete sent as an array, and the undefined slug helper.
//
//   tsx --test test/products.update.test.mjs

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'products-update-test';

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

const admin = await db.one(`INSERT INTO users (email, password_hash, full_name) VALUES ('admin@test.local', 'x', 'Admin') RETURNING id`);
await db.none(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [admin.id]);
const token = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);

const img = (n) => `https://res.cloudinary.com/demo/image/upload/${n}.jpg`;

const put = async (id, body, contentType = 'application/json') => {
    const path = `/api/products/${id}`;
    const res = await handler({
        version: '2.0',
        routeKey: '$default',
        rawPath: path,
        rawQueryString: '',
        headers: { 'content-type': contentType, authorization: `Bearer ${token}`, host: 'example.lambda-url.ap-southeast-1.on.aws' },
        requestContext: { http: { method: 'PUT', path, sourceIp: '203.0.113.7' }, domainName: 'example' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        isBase64Encoded: false,
    }, {});
    return { status: res.statusCode, body: JSON.parse(res.body) };
};

const seedProduct = async () => {
    const p = await db.one(`INSERT INTO products (name, price) VALUES ('Widget', 10) RETURNING id`);
    const images = [];
    for (let i = 0; i < 2; i++) {
        images.push(await db.one(
            'INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3) RETURNING id',
            [p.id, img(`old${i}`), i]));
    }
    await db.none('UPDATE products SET image_url = $1 WHERE id = $2', [img('old0'), p.id]);
    return { id: p.id, imageIds: images.map(i => i.id) };
};

const base = { name: 'Widget', price: 10, stock: 1, category: 'misc', specifications: '[]' };

describe('PUT /api/products/:id', () => {
    it('replaces images when imagesToDelete is an array, and moves the cover', async () => {
        const p = await seedProduct();
        const res = await put(p.id, { ...base, imagesToDelete: [p.imageIds[0]], images: [img('new')] });
        assert.equal(res.status, 200, JSON.stringify(res.body));

        const rows = await db.map('SELECT image_url FROM product_images WHERE product_id = $1 ORDER BY display_order', [p.id], r => r.image_url);
        assert.deepEqual(rows, [img('old1'), img('new')]);
        const { image_url, slug } = await db.one('SELECT image_url, slug FROM products WHERE id = $1', [p.id]);
        assert.equal(image_url, img('old1'));
        assert.match(slug, /^widget-[a-z0-9]+$/);
    });

    it('still accepts imagesToDelete as a JSON string', async () => {
        const p = await seedProduct();
        const res = await put(p.id, { ...base, imagesToDelete: JSON.stringify(p.imageIds) });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const { image_url } = await db.one('SELECT image_url FROM products WHERE id = $1', [p.id]);
        assert.equal(image_url, null, 'cover is cleared once every image is removed');
    });

    it('does not delete images belonging to another product', async () => {
        const target = await seedProduct();
        const other = await seedProduct();
        const res = await put(target.id, { ...base, imagesToDelete: [other.imageIds[0]] });
        assert.equal(res.status, 200);
        const { n } = await db.one('SELECT count(*)::int AS n FROM product_images WHERE product_id = $1', [other.id]);
        assert.equal(n, 2);
    });

    it('keeps an existing slug across a rename', async () => {
        const p = await seedProduct();
        await db.none(`UPDATE products SET slug = 'widget-keep' WHERE id = $1`, [p.id]);
        await put(p.id, { ...base, name: 'Renamed' });
        const { slug } = await db.one('SELECT slug FROM products WHERE id = $1', [p.id]);
        assert.equal(slug, 'widget-keep');
    });

    it('saves sub_category, and stores a blank one as NULL', async () => {
        const p = await seedProduct();
        await put(p.id, { ...base, sub_category: '  PLA  ' });
        assert.equal((await db.one('SELECT sub_category FROM products WHERE id = $1', [p.id])).sub_category, 'PLA');

        await put(p.id, { ...base, sub_category: '' });
        assert.equal((await db.one('SELECT sub_category FROM products WHERE id = $1', [p.id])).sub_category, null);
    });

    it('rejects a non-string sub_category with 400', async () => {
        const p = await seedProduct();
        const res = await put(p.id, { ...base, sub_category: ['PLA'] });
        assert.equal(res.status, 400);
    });

    it('answers a multipart body with 400, not 500', async () => {
        const p = await seedProduct();
        const res = await put(p.id, '--x\r\nContent-Disposition: form-data; name="name"\r\n\r\nW\r\n--x--', 'multipart/form-data; boundary=x');
        assert.equal(res.status, 400);
    });

    it('rejects non-UUID image ids with 400', async () => {
        const p = await seedProduct();
        const res = await put(p.id, { ...base, imagesToDelete: ['1; DROP TABLE products'] });
        assert.equal(res.status, 400);
    });

    it('returns 404 for an unknown product', async () => {
        const res = await put('00000000-0000-0000-0000-000000000000', base);
        assert.equal(res.status, 404);
    });
});
