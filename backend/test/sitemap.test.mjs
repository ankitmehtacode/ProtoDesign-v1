// GET /sitemap.xml through the Lambda entrypoint against a real Postgres.
//
//   tsx --test test/sitemap.test.mjs

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.FRONTEND_URL = 'https://www.example.test/';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'sitemap-test';

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};
after(async () => { Object.assign(console, realConsole); await pgp.end(); pg.stop(); });

await db.none(`INSERT INTO products (name, slug, price, image_url) VALUES ('Kobra 3', 'kobra-3-ab12', 26999, 'https://res.cloudinary.com/demo/image/upload/k.jpg')`);
await db.none(`INSERT INTO products (name, price) VALUES ('No Slug', 10)`);
await db.none(`INSERT INTO products (name, slug, price, is_archived) VALUES ('Gone', 'gone-1', 10, true)`);

const res = await handler({
    version: '2.0', routeKey: '$default', rawPath: '/sitemap.xml', rawQueryString: '',
    headers: { host: 'example.lambda-url.ap-southeast-1.on.aws' },
    requestContext: { http: { method: 'GET', path: '/sitemap.xml', sourceIp: '203.0.113.7' }, domainName: 'example' },
    isBase64Encoded: false,
}, {});
const xml = res.body;

describe('GET /sitemap.xml', () => {
    it('responds with XML', () => {
        assert.equal(res.statusCode, 200, xml);
        assert.match(res.headers['content-type'], /xml/);
    });
    it('lists products under their slug, with their image', () => {
        assert.match(xml, /<loc>https:\/\/www\.example\.test\/product\/kobra-3-ab12<\/loc><lastmod>[^<]+<\/lastmod><image:image><image:loc>https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/k\.jpg<\/image:loc>/);
    });
    it('falls back to the id when a product has no slug', async () => {
        const { id } = await db.one(`SELECT id FROM products WHERE name = 'No Slug'`);
        assert.ok(xml.includes(`/product/${id}</loc>`));
    });
    it('omits archived products', () => assert.doesNotMatch(xml, /gone-1/));
    it('includes the static pages without a double slash', () => {
        assert.match(xml, /<loc>https:\/\/www\.example\.test\/custom<\/loc>/);
        assert.doesNotMatch(xml, /test\/\/custom/);
    });
});
