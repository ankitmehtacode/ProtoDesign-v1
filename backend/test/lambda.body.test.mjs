// Request bodies through the real Lambda entrypoint.
//
// serverless-http hands Express a socketless request that body-parser 2 treats
// as already read, so express.json() never parses it. These tests drive the
// exported handler with Lambda Function URL events -- the path production
// takes -- rather than a listening server, which never showed the bug.
//
//   node --test test/lambda.body.test.mjs

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'lambda-body-test'; // take the Lambda path in app.ts

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

/** A Lambda Function URL (payload v2) event, as AWS delivers it. */
const invoke = async (path, { body, contentType = 'application/json', base64 = false } = {}) => {
    const res = await handler({
        version: '2.0',
        routeKey: '$default',
        rawPath: path,
        rawQueryString: '',
        headers: { 'content-type': contentType, host: 'example.lambda-url.ap-southeast-1.on.aws' },
        requestContext: { http: { method: 'POST', path, sourceIp: '203.0.113.7' }, domainName: 'example' },
        body: base64 ? Buffer.from(body).toString('base64') : body,
        isBase64Encoded: base64,
    }, {});
    return { status: res.statusCode, body: JSON.parse(res.body) };
};

const email = 'lambda-user@test.local';
await db.none(`INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, 'Lambda User')`,
    [email, await bcrypt.hash('correct-horse', 4)]);

describe('JSON bodies reach routes under Lambda', () => {
    it('logs in with a plain JSON body', async () => {
        const res = await invoke('/api/auth/login', { body: JSON.stringify({ email, password: 'correct-horse' }) });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.ok(res.body.token);
    });

    it('logs in with a base64-encoded body (Function URLs may encode)', async () => {
        const res = await invoke('/api/auth/login', { body: JSON.stringify({ email, password: 'correct-horse' }), base64: true });
        assert.equal(res.status, 200, JSON.stringify(res.body));
    });

    it('answers a wrong password with 401, not a 500', async () => {
        const res = await invoke('/api/auth/login', { body: JSON.stringify({ email, password: 'wrong' }) });
        assert.deepEqual([res.status, res.body.error.message], [401, 'Invalid credentials']);
    });

    it('passes the Google credential through to verification', async () => {
        const res = await invoke('/api/auth/google', { body: JSON.stringify({ token: 'not-a-real-id-token' }) });
        assert.equal(res.status, 401);
        // The token arrived: Google rejected its format instead of reporting it missing.
        assert.doesNotMatch(res.body.error, /requires an ID Token/);
    });

    it('rejects malformed JSON with a 400', async () => {
        const res = await invoke('/api/auth/login', { body: '{"email":' });
        assert.deepEqual([res.status, res.body.error.message], [400, 'Malformed JSON body']);
    });
});
