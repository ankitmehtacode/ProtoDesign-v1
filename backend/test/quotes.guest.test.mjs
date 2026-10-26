// Guest quotes through the real Lambda entrypoint, against a real Postgres:
// no upload without an email and phone, and a quote only for the upload the
// guest was given. S3 is stubbed at the storage service; signing stays real.
//
//   tsx --test test/quotes.guest.test.mjs

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'quotes-guest-test';
process.env.S3_STL_BUCKET = 'test-bucket';
process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.WHATSAPP_MODE = 'off';

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const { storageService } = await import('../src/services/storage.service.js');
storageService.statModel = async () => ({ contentLength: 1234 });

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

const file = { filename: 'bracket.stl', contentType: 'model/stl', contentLength: 1234 };
const guest = { email: 'asha@example.com', phone: '98765 43210' };
const specs = JSON.stringify({ estimatedPrice: 450 });

const upload = (contact = guest) => call('POST', '/api/quotes/upload-url', { body: { ...file, ...contact } });
const request = (u, extra = {}) => call('POST', '/api/quotes/request', {
    body: { fileKey: u.key, fileName: file.filename, specifications: specs, guestToken: u.guestToken, ...extra },
});

describe('guest quotes', () => {
    it('gives no upload URL without an email and phone', async () => {
        assert.equal((await upload({})).status, 400);
        assert.match((await upload({ email: 'asha@example.com' })).body.error, /phone/);
        assert.match((await upload({ phone: '9876543210' })).body.error, /email/);
    });

    it('gives no upload URL to a bot that fills the honeypot', async () => {
        assert.equal((await upload({ ...guest, website: 'http://spam' })).status, 400);
    });

    it('records the quote against the contact given before the upload', async () => {
        const u = (await upload()).body;
        assert.match(u.key, /^quotes\/models\/guest\//);
        assert.ok(u.guestToken);

        // Contact typed into the request is ignored: the token's contact wins.
        const res = await request(u, { email: 'someone-else@example.com', phone: '1111111111' });
        assert.equal(res.status, 200);
        assert.equal(res.body.email, 'asha@example.com');
        const row = await db.one('SELECT user_id, email, phone, source FROM quotes WHERE id = $1', [res.body.quoteId]);
        assert.deepEqual(row, { user_id: null, email: 'asha@example.com', phone: '98765 43210', source: 'web' });
    });

    it('refuses a quote without the token, or for another guest\'s upload', async () => {
        const mine = (await upload({ email: 'b@example.com', phone: '9876543211' })).body;
        const theirs = (await upload({ email: 'c@example.com', phone: '9876543212' })).body;
        assert.equal((await request(mine, { guestToken: undefined })).status, 403);
        assert.equal((await request({ ...theirs, guestToken: mine.guestToken })).status, 403);
    });

    it('makes one quote per upload, even when the token is replayed in parallel', async () => {
        const u = (await upload({ email: 'replay@example.com', phone: '9876543214' })).body;
        const results = await Promise.all(Array.from({ length: 6 }, () => request(u)));
        assert.equal(results.filter((r) => r.status === 200).length, 1);
        assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 409));
        assert.equal((await db.one('SELECT count(*)::int AS n FROM quotes WHERE file_url = $1', [u.key])).n, 1);
    });

    it('records the file name the upload was signed for, not the one in the request', async () => {
        const u = (await upload({ email: 'name@example.com', phone: '9876543215' })).body;
        const res = await request(u, { fileName: 'Payment failed - verify at evil-pay.in' });
        assert.equal((await db.one('SELECT file_name FROM quotes WHERE id = $1', [res.body.quoteId])).file_name, file.filename);
    });

    it('caps quotes to one mailbox per day, however the address is spelled', async () => {
        const spellings = ['flood.er@gmail.com', 'FLOODER+1@gmail.com', 'f.l.o.o.d.e.r+x@googlemail.com'];
        for (const email of spellings) {
            assert.equal((await request((await upload({ email, phone: '9876543213' })).body)).status, 200);
        }
        const fourth = await upload({ email: 'flooder+again@gmail.com', phone: '9876543213' });
        assert.equal(fourth.status, 429);
        assert.match(fourth.body.error, /several quotes/);
    });

    it('keeps the signed-in flow, falling back to the account email', async () => {
        const userId = (await db.one(
            `INSERT INTO users (email, password_hash, full_name, phone_number) VALUES ('member@test.local', 'x', 'Member', '9876543299') RETURNING id`)).id;
        const u = (await call('POST', '/api/quotes/upload-url', { userId, body: file })).body;
        assert.match(u.key, new RegExp(`^quotes/models/${userId}/`));
        assert.equal(u.guestToken, undefined);
        const res = await call('POST', '/api/quotes/request', {
            userId, body: { fileKey: u.key, fileName: file.filename, specifications: specs },
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.email, 'member@test.local');
        assert.equal((await db.one('SELECT user_id FROM quotes WHERE id = $1', [res.body.quoteId])).user_id, userId);
    });
});
