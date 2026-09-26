// Admin product changes ask Vercel to rebuild the site so prerendered product
// pages match the database. Through the real Lambda entrypoint, real Postgres,
// with the Vercel deploy hook stubbed.
//
//   tsx --test test/site.rebuild.test.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const HOOK = 'https://api.vercel.com/v1/integrations/deploy/prj_test/abc123';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'site-rebuild-test';
process.env.VERCEL_DEPLOY_HOOK_URL = HOOK;

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const { requestSiteRebuild } = await import('../src/services/site.rebuild.js');

const realFetch = globalThis.fetch;
let hookCalls = 0;
globalThis.fetch = async (url, init) => {
    if (url === HOOK) { hookCalls++; return { ok: true, status: 201 }; }
    return realFetch(url, init);
};

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};
after(async () => {
    globalThis.fetch = realFetch;
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});
beforeEach(() => { hookCalls = 0; });

const admin = await db.one(`INSERT INTO users (email, password_hash, full_name) VALUES ('admin@test.local', 'x', 'Admin') RETURNING id`);
await db.none(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [admin.id]);
const token = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);

const call = async (method, path, body) => {
    const [rawPath, rawQueryString = ''] = path.split('?');
    const res = await handler({
        version: '2.0', routeKey: '$default', rawPath, rawQueryString,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, host: 'example.lambda-url.ap-southeast-1.on.aws' },
        requestContext: { http: { method, path: rawPath, sourceIp: '203.0.113.7' }, domainName: 'example' },
        body: body === undefined ? undefined : JSON.stringify(body),
        isBase64Encoded: false,
    }, {});
    return { status: res.statusCode, body: JSON.parse(res.body) };
};

describe('admin product changes trigger a site rebuild', () => {
    it('on create, update, archive, restore and delete', async () => {
        const created = await call('POST', '/api/products', { name: 'Desk hook', price: 199, category: '3dprintables', stock: 5 });
        assert.equal(created.status, 201);
        assert.equal(hookCalls, 1);

        const id = created.body.id;
        const edit = { name: 'Desk hook', price: 249, category: '3dprintables', stock: 5, specifications: [] };
        assert.equal((await call('PUT', `/api/products/${id}`, edit)).status, 200);
        assert.equal(hookCalls, 2);

        assert.equal((await call('DELETE', `/api/products/${id}`)).status, 200);
        assert.equal((await call('PATCH', `/api/products/${id}/restore`)).status, 200);
        assert.equal((await call('DELETE', `/api/products/${id}?permanent=true`)).status, 200);
        assert.equal(hookCalls, 5);
    });

    it('not when the change is rejected', async () => {
        assert.equal((await call('POST', '/api/products', { price: 199 })).status, 400);
        assert.equal((await call('PUT', '/api/products/not-a-uuid', { price: 1 })).status, 404);
        assert.equal(hookCalls, 0);
    });
});

describe('requestSiteRebuild', () => {
    it('never throws, even when Vercel is unreachable', async () => {
        const down = async () => { throw new Error('network down'); };
        await requestSiteRebuild('test', { fetchImpl: down });
    });

    it('refuses a hook URL that is not a Vercel deploy hook', async () => {
        const saved = process.env.VERCEL_DEPLOY_HOOK_URL;
        process.env.VERCEL_DEPLOY_HOOK_URL = 'https://evil.example/collect';
        try {
            let called = false;
            await requestSiteRebuild('test', { fetchImpl: async () => { called = true; return { ok: true, status: 200 }; } });
            assert.equal(called, false);
        } finally {
            process.env.VERCEL_DEPLOY_HOOK_URL = saved;
        }
    });
});
