// Search Console sync and the Search demand view, against a real Postgres with
// a fake Google: rows merged by path and capped per day, the window and its
// week-sized chunks, partial and failed runs leaving stored days intact, one
// sync at a time, the admin view's periods, topics, opportunities and the
// join to tracked Google visitors and their leads, and pruning.
//
//   tsx --test test/search.test.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
Object.assign(process.env, {
    DATABASE_URL: pg.url,
    JWT_SECRET: 'test-jwt-secret',
    AWS_LAMBDA_FUNCTION_NAME: 'search-test',
    GSC_SITE_URL: 'sc-domain:shop.example',
});

const { handler } = await import('../app.ts');
const { default: db, pgp } = await import('../src/config/database.js');
const sc = await import('../src/services/search-console.service.js');
const leads = await import('../src/services/leads.service.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

const call = async (method, path, { userId, query = '' } = {}) => {
    const headers = { 'content-type': 'application/json', host: 'example.lambda-url.ap-southeast-1.on.aws' };
    if (userId) headers.authorization = `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`;
    const res = await handler({
        version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: query, headers,
        requestContext: { http: { method, path, sourceIp: '203.0.113.7' }, domainName: 'example' },
        isBase64Encoded: false,
    }, {});
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

let n = 0;
const seedUser = async (role) => {
    const id = (await db.one(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Person') RETURNING id`,
        [`person${++n}@test.local`])).id;
    if (role) await db.none('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
    return id;
};

const NOW = new Date('2026-10-21T02:00:00Z');
const row = (day, query, page, clicks, impressions, position) => ({ keys: [day, query, page], clicks, impressions, position });

/**
 * A Search Console stand-in: answers from `rows` by date range, paged like
 * the API. A date-only query gets per-day totals, plus `hidden` impressions
 * per day standing for the anonymised searches Google leaves out of rows.
 * `calls` holds the per-search requests, `totalCalls` the date-only ones.
 */
const fakeGoogle = (rows, { failOn, hidden = 0 } = {}) => {
    const calls = [];
    const totalCalls = [];
    return {
        calls,
        totalCalls,
        async query({ startDate, endDate, startRow = 0, dimensions, timeoutMs }) {
            if (failOn?.(startDate)) throw new sc.SyncError('example.iam.gserviceaccount.com cannot read sc-domain:shop.example.');
            const inRange = rows.filter((r) => r.keys[0] >= startDate && r.keys[0] <= endDate);
            if (dimensions?.length === 1) {
                totalCalls.push({ startDate, endDate, timeoutMs });
                const days = new Map();
                for (const r of inRange) {
                    const d = days.get(r.keys[0]) ?? { keys: [r.keys[0]], clicks: 0, impressions: hidden, position: 5 };
                    d.clicks += r.clicks;
                    d.impressions += r.impressions;
                    days.set(r.keys[0], d);
                }
                return [...days.values()];
            }
            calls.push({ startDate, endDate, startRow });
            return inRange.slice(startRow, startRow + 25_000);
        },
    };
};

const stored = () => db.any('SELECT day::text, query, page, clicks, impressions, position FROM search_console_rows ORDER BY day, query, page');
const storeDay = (day) => db.none(`INSERT INTO search_console_days VALUES ($1, 1, 1, 1)`, [day]);

beforeEach(async () => {
    await db.none('TRUNCATE search_console_rows, search_console_days, search_console_syncs, visitor_events, visitors, leads CASCADE');
    process.env.GSC_SITE_URL = 'sc-domain:shop.example';
});

describe('rows', () => {
    it('keep only the path, merging hosts and trailing slashes', () => {
        assert.equal(sc.pagePath('https://www.shop.example/printers/?x=1#y'), '/printers');
        assert.equal(sc.pagePath('https://shop.example/'), '/');
        assert.equal(sc.pagePath('not a url'), null);

        const { rows } = sc.mergeRows([
            row('2026-10-01', 'Bambu A1', 'https://shop.example/p/a1', 2, 10, 3),
            row('2026-10-01', 'bambu a1', 'https://www.shop.example/p/a1/', 1, 30, 7),
        ]);
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0], { day: '2026-10-01', query: 'bambu a1', page: '/p/a1', clicks: 3, impressions: 40, position: 6 });
    });

    it('drop unusable rows and keep each day\'s top rows only', () => {
        const many = Array.from({ length: 5 }, (_, i) => row('2026-10-02', `q${i}`, 'https://shop.example/', i, 10 + i, 5));
        const { rows, dropped, truncated } = sc.mergeRows([
            ...many,
            row('2026-10-02', 'x'.repeat(201), 'https://shop.example/', 1, 1, 1),
            row('bad-day', 'q', 'https://shop.example/', 1, 1, 1),
            row('2026-10-02', 'q', 'https://shop.example/', 0, 0, 1),
        ], 3);
        assert.equal(dropped, 3);
        assert.equal(truncated, 2);
        assert.deepEqual(rows.map((r) => r.query), ['q4', 'q3', 'q2']);
    });

    it('drop text Postgres cannot store, instead of failing the week on every run', () => {
        const { rows, dropped } = sc.mergeRows([row('2026-10-02', 'bad\u0000query', 'https://shop.example/', 1, 1, 1)]);
        assert.equal(rows.length, 0);
        assert.equal(dropped, 1);
    });
});

describe('window', () => {
    it('backfills 118 days on the first run, then carries on after the newest stored day', () => {
        assert.deepEqual(sc.syncWindow(null, NOW), { start: '2026-06-25', end: '2026-10-20' });
        assert.deepEqual(sc.syncWindow('2026-10-17', NOW), { start: '2026-10-18', end: '2026-10-20' });
        assert.deepEqual(sc.syncWindow('2026-01-01', NOW), { start: '2026-06-25', end: '2026-10-20' });
        assert.equal(sc.syncWindow('2026-10-20', NOW), null);
    });
});

describe('sync', () => {
    it('does nothing, visibly, until a property is set', async () => {
        delete process.env.GSC_SITE_URL;
        assert.equal((await sc.runSearchConsoleSync({ fetcher: fakeGoogle([]), now: NOW })).status, 'not_configured');
        assert.equal((await db.one('SELECT count(*)::int AS n FROM search_console_syncs')).n, 0);
    });

    it('stores the backfill week by week, oldest first, with Google\'s daily totals, and records the run', async () => {
        const google = fakeGoogle([
            row('2026-07-25', 'pla filament', 'https://shop.example/filaments', 1, 20, 9),
            row('2026-10-18', 'bambu a1 price', 'https://shop.example/p/a1', 4, 50, 5),
        ], { hidden: 7 });
        const result = await sc.runSearchConsoleSync({ fetcher: google, now: NOW });
        assert.equal(result.status, 'ok');
        assert.equal(result.rowsStored, 2);
        assert.equal(google.calls[0].startDate, '2026-06-25');
        assert.equal(google.calls[0].endDate, '2026-07-01');
        assert.equal(google.calls.at(-1).endDate, '2026-10-20');
        assert.equal(google.calls.length, 17);
        assert.equal(google.totalCalls.length, 17);
        assert.equal((await stored()).length, 2);
        assert.deepEqual(await db.any('SELECT day::text, clicks, impressions FROM search_console_days ORDER BY day'),
            [{ day: '2026-07-25', clicks: 1, impressions: 27 }, { day: '2026-10-18', clicks: 4, impressions: 57 }]);

        const sync = await db.one('SELECT * FROM search_console_syncs');
        assert.equal(sync.status, 'ok');
        assert.equal(sync.rows_stored, 2);
        assert.ok(sync.finished_at);

        // The next run asks only for days after the newest stored one.
        const next = fakeGoogle([]);
        await sc.runSearchConsoleSync({ fetcher: next, now: NOW });
        assert.deepEqual(next.calls, [{ startDate: '2026-10-19', endDate: '2026-10-20', startRow: 0 }]);
    });

    it('pages through more rows than one API answer holds', async () => {
        const rows = Array.from({ length: 25_001 }, (_, i) => row('2026-10-19', `q${i}`, 'https://shop.example/', 0, 1 + (i % 7), 10));
        const google = fakeGoogle(rows);
        await storeDay('2026-10-18');
        const result = await sc.runSearchConsoleSync({ fetcher: google, now: NOW });
        assert.deepEqual(google.calls.map((c) => c.startRow), [0, 25_000]);
        assert.equal(result.rowsStored, 1000); // capped per day
    });

    it('fetches a day again after it was removed, replacing nothing else', async () => {
        await db.none(`INSERT INTO search_console_rows VALUES ('2026-10-12', 'old', '/', 9, 9, 1)`);
        await storeDay('2026-10-12');
        await sc.runSearchConsoleSync({ fetcher: fakeGoogle([row('2026-10-13', 'new', 'https://shop.example/', 1, 2, 3)]), now: NOW });
        // As after deleting the newest days by hand to have them fetched again.
        await db.none(`DELETE FROM search_console_days WHERE day > '2026-10-12'`);
        await sc.runSearchConsoleSync({ fetcher: fakeGoogle([row('2026-10-13', 'new', 'https://shop.example/', 5, 6, 2)]), now: NOW });
        assert.deepEqual((await stored()).map((r) => [r.day, r.query, r.clicks]), [['2026-10-12', 'old', 9], ['2026-10-13', 'new', 5]]);
    });

    it('stops before the time limit and writes no half week', async () => {
        const google = fakeGoogle([row('2026-06-26', 'a', 'https://shop.example/', 1, 1, 1), row('2026-07-03', 'b', 'https://shop.example/', 1, 1, 1)]);
        const result = await sc.runSearchConsoleSync({ fetcher: google, now: NOW, remainingMs: () => (google.calls.length >= 1 ? 0 : 60_000) });
        assert.equal(result.status, 'partial');
        assert.match(result.detail, /2026-07-02/);
        assert.deepEqual((await stored()).map((r) => r.query), ['a']);
        assert.equal((await db.one('SELECT status FROM search_console_syncs')).status, 'partial');
    });

    it('gives each request only the time left, and stops mid-week rather than overrun', async () => {
        const google = fakeGoogle([row('2026-10-19', 'a', 'https://shop.example/', 1, 1, 1)]);
        await storeDay('2026-10-18');
        await sc.runSearchConsoleSync({ fetcher: google, now: NOW, remainingMs: () => 8000 });
        assert.equal(google.totalCalls[0].timeoutMs, 5000);

        // Time runs short between the totals and the rows: nothing is written.
        await db.none('TRUNCATE search_console_rows, search_console_days, search_console_syncs');
        await storeDay('2026-10-18');
        let left = 7000;
        const slow = fakeGoogle([row('2026-10-19', 'a', 'https://shop.example/', 1, 1, 1)]);
        const result = await sc.runSearchConsoleSync({ fetcher: slow, now: NOW, remainingMs: () => (left -= 3000) });
        assert.equal(result.status, 'partial');
        assert.equal(slow.calls.length, 0);
        assert.equal((await stored()).length, 0);
    });

    it('alerts when it cannot record its own result, without throwing', async () => {
        const alerts = [];
        const google = fakeGoogle([]);
        let altered = false;
        google.query = async () => {
            if (!altered) await db.none(`ALTER TABLE search_console_syncs ADD CONSTRAINT test_no_ok CHECK (status <> 'ok') NOT VALID`);
            altered = true;
            return [];
        };
        await storeDay('2026-10-18');
        try {
            const result = await sc.runSearchConsoleSync({ fetcher: google, now: NOW, alert: async (m) => alerts.push(m) });
            assert.equal(result.status, 'ok');
            assert.match(alerts[0], /could not record its result/);
        } finally {
            await db.none('ALTER TABLE search_console_syncs DROP CONSTRAINT IF EXISTS test_no_ok');
        }
    });

    it('records and alerts a failure, keeping what was stored', async () => {
        await db.none(`INSERT INTO search_console_rows VALUES ('2026-10-10', 'kept', '/', 1, 1, 1)`);
        await storeDay('2026-10-10');
        const alerts = [];
        const result = await sc.runSearchConsoleSync({
            fetcher: fakeGoogle([], { failOn: () => true }), now: NOW, alert: async (m) => alerts.push(m),
        });
        assert.equal(result.status, 'failed');
        assert.match(result.detail, /cannot read sc-domain:shop\.example/);
        assert.equal(alerts.length, 1);
        assert.equal((await stored()).length, 1);
        assert.equal((await db.one('SELECT status, detail FROM search_console_syncs')).detail, result.detail);
    });

    it('hides unexpected error text from the admin', async () => {
        const result = await sc.runSearchConsoleSync({
            fetcher: { query: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432'); } }, now: NOW,
        });
        assert.equal(result.status, 'failed');
        assert.doesNotMatch(result.detail, /10\.0\.0\.5|ECONNREFUSED/);
    });

    it('runs one at a time, and closes a run that was killed', async () => {
        await db.none(`INSERT INTO search_console_syncs (status, started_at) VALUES ('running', now())`);
        assert.equal((await sc.runSearchConsoleSync({ fetcher: fakeGoogle([]), now: NOW })).status, 'busy');

        await db.none(`UPDATE search_console_syncs SET started_at = now() - interval '10 minutes'`);
        assert.equal((await sc.runSearchConsoleSync({ fetcher: fakeGoogle([]), now: NOW })).status, 'ok');
        const runs = await db.any('SELECT status, detail FROM search_console_syncs ORDER BY id');
        assert.equal(runs[0].status, 'failed');
        assert.match(runs[0].detail, /timed out/);
    });
});

describe('Google errors', () => {
    const ctx = { siteUrl: 'sc-domain:shop.example', account: 'sa@p.iam.gserviceaccount.com' };
    it('say what to fix', () => {
        assert.match(sc.describeGoogleError({ status: 403, message: 'User does not have sufficient permission' }, ctx), /sa@p\.iam.*Restricted/);
        assert.match(sc.describeGoogleError({ status: 403, message: 'Google Search Console API has not been used in project 123' }, ctx), /not enabled/);
        // The shape google-auth-library really throws for a deleted key.
        assert.match(sc.describeGoogleError({ status: 400, message: 'invalid_grant: Invalid grant: account not found',
            response: { status: 400, data: { error: 'invalid_grant' } } }, ctx), /rejected/);
        assert.match(sc.describeGoogleError({ status: 500, message: 'backend error at 10.1.2.3' }, ctx), /HTTP 500/);
        assert.doesNotMatch(sc.describeGoogleError({ status: 500, message: 'backend error at 10.1.2.3' }, ctx), /10\.1/);
    });
});

describe('topics', () => {
    it('sort searches by what they are about and whether they mean to buy', () => {
        assert.equal(sc.topicOf('resin 3d printer'), 'resin');
        assert.equal(sc.topicOf('pla filament for ender 3'), 'filament');
        assert.equal(sc.topicOf('bambu lab a1 mini price'), 'printer');
        assert.equal(sc.topicOf('3d printing service near me'), 'service');
        assert.equal(sc.topicOf('protodesign'), 'brand');
        assert.equal(sc.topicOf('how does a 3d pen work'), 'other');
        assert.ok(sc.buyingIntent('bambu a1 price in india'));
        assert.ok(!sc.buyingIntent('how to level a bed'));
    });
});

describe('Search demand view', () => {
    // Rows, and daily totals as Google would report them with `hidden`
    // anonymised impressions a day on top.
    const seed = async (rows, hidden = 0) => {
        await db.none(
            `INSERT INTO search_console_rows (day, query, page, clicks, impressions, position)
             SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::int[], $5::int[], $6::real[])`,
            [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3]), rows.map((r) => r[4]), rows.map((r) => r[5])]
        );
        await db.none(
            `INSERT INTO search_console_days
             SELECT day, sum(clicks), sum(impressions) + $1, sum(position * impressions) / sum(impressions)
               FROM search_console_rows GROUP BY day`, [hidden]);
    };

    it('compares periods ending at the newest day, and finds opportunities', async () => {
        await seed([
            // Current 7 days: 2026-10-12 .. 2026-10-18
            ['2026-10-18', 'bambu a1 price', '/p/a1', 2, 100, 8],
            ['2026-10-17', 'bambu a1 price', '/p/a1', 1, 100, 6],
            ['2026-10-17', 'pla filament', '/filaments', 1, 80, 2],
            ['2026-10-16', 'protodesign', '/', 9, 10, 1],
            // Previous 7 days
            ['2026-10-10', 'bambu a1 price', '/p/a1', 1, 50, 12],
            ['2026-10-05', 'resin printer', '/resin', 0, 40, 30],
        ], 1);
        const d = await sc.searchDemand({ days: 7 });
        assert.equal(d.configured, true);
        assert.deepEqual(d.period, { from: '2026-10-12', to: '2026-10-18', previousFrom: '2026-10-05', previousComplete: true });
        // Google's totals: 3 days with 1 anonymised impression each on top of the rows.
        assert.equal(d.totals.current.clicks, 13);
        assert.equal(d.totals.current.impressions, 293);
        // Weighted by Google's impressions, anonymised ones included.
        assert.ok(Math.abs(d.totals.current.position - 5.40) < 0.01);
        assert.equal(d.totals.previous.impressions, 92);

        const a1 = d.queries.find((q) => q.query === 'bambu a1 price');
        assert.equal(a1.position, 7);
        assert.equal(a1.prev_impressions, 50);
        assert.equal(a1.page, '/p/a1');
        assert.equal(a1.topic, 'printer');
        assert.ok(a1.buying);
        // Gone this period: counted in its topic's previous figure, not listed.
        assert.ok(!d.queries.some((q) => q.query === 'resin printer'));
        assert.equal(d.topics.find((t) => t.topic === 'resin').prev_impressions, 40);

        assert.deepEqual(d.opportunities.map((o) => [o.query, o.kind, o.extra_clicks]),
            [['bambu a1 price', 'close_to_top', 17], ['pla filament', 'low_ctr', 7]]);
        assert.deepEqual(d.rising.map((q) => q.query), ['bambu a1 price', 'pla filament', 'protodesign']);
    });

    it('makes no comparison until the period before is fully stored', async () => {
        await seed([['2026-10-18', 'bambu a1 price', '/p/a1', 2, 100, 8], ['2026-10-10', 'bambu a1 price', '/p/a1', 1, 10, 12]]);
        const d = await sc.searchDemand({ days: 7 });
        assert.equal(d.period.previousComplete, false);
        assert.deepEqual(d.rising, []);
    });

    it('shows a run the function timeout killed as failed, not running', async () => {
        await db.none(`INSERT INTO search_console_syncs (status, started_at) VALUES ('running', now() - interval '10 minutes')`);
        const d = await sc.searchDemand({ days: 7 });
        assert.equal(d.lastSync.status, 'failed');
        assert.match(d.lastSync.detail, /timed out/);
    });

    it('joins search pages to tracked Google visitors and their leads', async () => {
        await seed([['2026-10-18', 'bambu a1', '/p/a1', 3, 30, 4]]);
        const lead = (await db.one(
            `INSERT INTO leads (phone, interest, form, consent_text) VALUES ('919800000001', 'printer', 'product_page', 'x') RETURNING id`)).id;
        await db.none(
            `INSERT INTO visitors (id, source, medium, landing_path, lead_id, first_seen_at) VALUES
                ($1, 'google', 'organic', '/p/a1/', $4, '2026-10-18 10:00'),
                ($2, 'google', 'organic', '/p/a1', NULL, '2026-10-18 11:00'),
                ($3, 'google', 'cpc', '/p/a1', NULL, '2026-10-18 12:00'),
                -- 05:00 UTC on the 19th is still the 18th in Search Console's Pacific time.
                ($5, 'google', 'organic', '/p/a1', NULL, '2026-10-19 05:00'),
                ($6, 'google', 'organic', '/p/a1', NULL, '2026-10-19 09:00')`,
            [randomUUID(), randomUUID(), randomUUID(), lead, randomUUID(), randomUUID()]);
        const d = await sc.searchDemand({ days: 28 });
        assert.deepEqual(d.pages, [{ page: '/p/a1', clicks: 3, impressions: 30, position: 4, top_query: 'bambu a1', visitors: 3, leads: 1 }]);
        assert.deepEqual(d.organic, { visitors: 3, leads: 1 });
    });

    it('is admin-only, says when there is no data, and checks the period', async () => {
        assert.equal((await call('GET', '/api/leads/search-demand')).status, 401);
        assert.equal((await call('GET', '/api/leads/search-demand', { userId: await seedUser() })).status, 403);
        const admin = await seedUser('admin');
        const empty = await call('GET', '/api/leads/search-demand', { userId: admin, query: 'days=9999' });
        assert.equal(empty.status, 200);
        assert.equal(empty.body.empty, true);
        assert.equal(empty.body.days, 28);
        assert.equal(empty.body.siteUrl, 'sc-domain:shop.example');
        assert.equal((await call('POST', '/api/leads/search-demand/sync', { userId: await seedUser() })).status, 403);
    });

    it('reports a manual sync that cannot run', async () => {
        delete process.env.GSC_SITE_URL;
        const admin = await seedUser('admin');
        const res = await call('POST', '/api/leads/search-demand/sync', { userId: admin });
        assert.equal(res.status, 409);
        assert.equal(res.body.status, 'not_configured');
    });
});

describe('maintenance', () => {
    it('prunes Search Console data past retention from the newest stored day, and old sync records', async () => {
        // Syncs stalled for 10 days: retention still counts from the newest stored day.
        await db.none(`INSERT INTO search_console_rows VALUES (current_date - 131, 'old', '/', 1, 1, 1),
                                                              (current_date - 129, 'kept', '/', 1, 1, 1), (current_date - 10, 'new', '/', 1, 1, 1)`);
        await db.none(`INSERT INTO search_console_days VALUES (current_date - 131, 1, 1, 1), (current_date - 10, 1, 1, 1)`);
        await db.none(`INSERT INTO search_console_syncs (status, started_at) VALUES ('ok', now() - interval '61 days'), ('ok', now())`);
        const result = await leads.runLeadMaintenance();
        assert.equal(result.searchRowsDeleted, 1);
        assert.equal(result.searchSyncsDeleted, 1);
        assert.deepEqual((await stored()).map((r) => r.query), ['kept', 'new']);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM search_console_days')).n, 1);
    });
});
