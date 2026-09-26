// GET /feeds/google-products.xml through the Lambda entrypoint against a real Postgres.
//
//   tsx --test test/product-feed.test.mjs

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.FRONTEND_URL = 'https://www.example.test/';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'feed-test';

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};
after(async () => { Object.assign(console, realConsole); await pgp.end(); pg.stop(); });

const img = (n) => `https://res.cloudinary.com/demo/image/upload/${n}.jpg`;

const printer = await db.one(`
    INSERT INTO products (name, slug, description, price, stock, category, image_url)
    VALUES ('Kobra 3 & Combo', 'kobra-3-ab12', 'Fast <b>FDM</b> printer', 26999, 4, '3d_printer', $1) RETURNING id`, [img('k')]);
await db.none(`INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, 0), ($1, $3, 1)`,
    [printer.id, img('k'), img('k2')]);
const printable = await db.one(`
    INSERT INTO products (name, slug, description, price, stock, category, image_url, specifications)
    VALUES ('Tool organizer', 'tool-organizer-mrdv', 'Holds tools.', 4050, 0, '3dprintables', $1, $2::jsonb) RETURNING id`,
    [img('t'), JSON.stringify([{ key: 'Material', value: 'PETG' }, { key: 'Approx. weight', value: '487 g' }])]);
await db.none(`INSERT INTO products (name, slug, price, image_url, is_archived) VALUES ('Gone', 'gone-1', 10, $1, true)`, [img('g')]);
await db.none(`INSERT INTO products (name, slug, price) VALUES ('No Image', 'no-image-1', 10)`);
await db.none(`INSERT INTO products (name, slug, price, image_url) VALUES ('Insecure', 'insecure-1', 10, 'http://x.test/a.jpg')`);

const res = await handler({
    version: '2.0', routeKey: '$default', rawPath: '/feeds/google-products.xml', rawQueryString: '',
    headers: { host: 'example.lambda-url.ap-southeast-1.on.aws' },
    requestContext: { http: { method: 'GET', path: '/feeds/google-products.xml', sourceIp: '203.0.113.7' }, domainName: 'example' },
    isBase64Encoded: false,
}, {});
const xml = res.body;
const item = (id) => xml.match(new RegExp(`<item><g:id>${id}</g:id>.*?</item>`))?.[0] ?? '';

describe('GET /feeds/google-products.xml', () => {
    it('responds with an RSS 2.0 feed in the Google namespace', () => {
        assert.equal(res.statusCode, 200, xml);
        assert.match(res.headers['content-type'], /xml/);
        assert.match(xml, /<rss version="2\.0" xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0">/);
    });

    it('lists each product with the required attributes, escaped', () => {
        const p = item(printer.id);
        assert.match(p, /<title>Kobra 3 &amp; Combo<\/title>/);
        assert.match(p, /<description>Fast FDM printer<\/description>/);
        assert.match(p, /<link>https:\/\/www\.example\.test\/product\/kobra-3-ab12<\/link>/);
        assert.match(p, /<g:image_link>https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/k\.jpg<\/g:image_link>/);
        assert.match(p, /<g:additional_image_link>[^<]*k2\.jpg<\/g:additional_image_link>/);
        assert.match(p, /<g:price>26999\.00 INR<\/g:price>/);
        assert.match(p, /<g:availability>in_stock<\/g:availability>/);
        assert.match(p, /<g:condition>new<\/g:condition>/);
    });

    it('matches checkout shipping: printers free, everything else Rs 199', () => {
        assert.match(item(printer.id), /<g:shipping><g:country>IN<\/g:country><g:price>0\.00 INR<\/g:price><\/g:shipping>/);
        assert.match(item(printable.id), /<g:price>199\.00 INR<\/g:price><\/g:shipping>/);
    });

    it('carries material and weight from specifications, and stock as availability', () => {
        const p = item(printable.id);
        assert.match(p, /<g:material>PETG<\/g:material>/);
        assert.match(p, /<g:shipping_weight>487 g<\/g:shipping_weight>/);
        assert.match(p, /<g:availability>out_of_stock<\/g:availability>/);
    });

    it('omits archived products and products without an https image', () => {
        assert.doesNotMatch(xml, /Gone|No Image|Insecure/);
        assert.equal((xml.match(/<item>/g) ?? []).length, 2);
    });
});
