import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { JWT } from 'google-auth-library';
import db from '../config/database.js';

/**
 * Search demand (docs/search-demand.md): Google Search Console's numbers for
 * the shop, copied daily, and the admin view built on them.
 *
 * This is the honest answer to "who searched for 3D printers": Google never
 * says who, but Search Console says what was searched, how often the shop
 * showed up, at what position, and how many clicked. Joined with first-party
 * tracking (leads.service.js), it shows which searches turn into leads.
 *
 * Access is a Google service account added as a Restricted user on the
 * Search Console property. Its JSON key is ~2.3 KB, too big for a Lambda
 * environment variable (4 KB for all of them together), so it lives in an SSM
 * SecureString parameter and is read once per sync.
 */

export const SEARCH_CONSOLE_EVENT_SOURCE = 'protodesign.search-console';

// The admin compares two periods of up to 56 days, so 112 days must be kept,
// counted back from the newest stored day (Search Console runs ~3 days behind).
export const SEARCH_RETENTION_DAYS = 120;
export const SEARCH_PERIODS = [7, 28, 56];

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const PAGE_SIZE = 25_000; // the API's maximum
const MAX_ROWS_PER_DAY = 1000;
// Enough for both 56-day periods from the first sync, within retention.
const BACKFILL_DAYS = 118;
const CHUNK_DAYS = 7;
// Enough to fetch and write one chunk; a run stops before starting one with less.
const MIN_REMAINING_MS = 6000;
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_TIMEOUT_MS = 5000;
// Kept back from each request's timeout for writing the chunk and the record.
const REQUEST_MARGIN_MS = 3000;
// A run still 'running' after this was killed (Lambda timeout).
const STALE_RUN_MINUTES = 5;
const STALE_DETAIL = 'Did not finish (the function timed out). The next run tries again.';
const DAY_MS = 86_400_000;

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

export function searchConsoleConfig(env = process.env) {
    return {
        siteUrl: env.GSC_SITE_URL?.trim() || null,
        keyParameter: env.GSC_KEY_PARAMETER?.trim() || '/protodesign/search-console-key',
    };
}

/** An error whose message is safe to show the admin. */
export class SyncError extends Error {
    constructor(message, cause) { super(message); this.cause = cause; }
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

async function loadKey(parameter) {
    let value;
    try {
        // Bounded: the whole sync must finish inside the function's 20 seconds.
        const ssm = new SSMClient({ requestHandler: { requestTimeout: 3000 }, maxAttempts: 2 });
        const out = await ssm.send(new GetParameterCommand({ Name: parameter, WithDecryption: true }));
        value = out.Parameter?.Value;
    } catch (err) {
        if (err.name === 'ParameterNotFound') {
            // The parameter's name stays in the log (via cause), not the admin's message.
            throw new SyncError('No Search Console key is stored in the configured SSM parameter.', err);
        }
        if (err.name === 'AccessDeniedException') {
            throw new SyncError('This function is not allowed to read the Search Console key parameter.', err);
        }
        throw new SyncError('Could not read the Search Console key from SSM.', err);
    }
    let key;
    try { key = JSON.parse(value); } catch (err) { throw new SyncError('The stored Search Console key is not valid JSON.', err); }
    if (!key?.client_email || !key?.private_key) {
        throw new SyncError('The stored Search Console key is not a service-account JSON key.');
    }
    return key;
}

/** Google's answer as something the admin can act on; the raw text goes to the log only. */
export function describeGoogleError(err, { siteUrl, account }) {
    const status = err.status ?? err.response?.status;
    const text = `${err.message} ${JSON.stringify(err.response?.data ?? '')}`;
    if (/SERVICE_DISABLED|has not been used|is disabled/i.test(text)) {
        return 'The Google Search Console API is not enabled in the service account\'s Google Cloud project.';
    }
    if (status === 401 || /invalid_grant|invalid_client/i.test(text)) {
        return 'Google rejected the service-account key. It may have been deleted; store a new one.';
    }
    if (status === 403) {
        return `${account} cannot read ${siteUrl}. Add it in Search Console → Settings → Users and permissions (Restricted).`;
    }
    if (status === 429) return 'Google\'s Search Console quota was used up. The next run tries again.';
    return `The Search Console request failed${status ? ` (HTTP ${status})` : ''}. The next run tries again.`;
}

const within = (promise, ms, message) => {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new SyncError(message)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Fetches rows from the Search Console API with the stored service account.
 * `query` takes `dimensions` (default date, query, page) and a `timeoutMs`
 * the caller sizes to the time it has left.
 */
export async function googleFetcher({ siteUrl, keyParameter }) {
    const key = await loadKey(keyParameter);
    const client = new JWT({ email: key.client_email, key: key.private_key, scopes: [SCOPE] });
    const fail = (err) => {
        throw err instanceof SyncError ? err : new SyncError(describeGoogleError(err, { siteUrl, account: key.client_email }), err);
    };
    // The token request ignores per-request timeouts, so it is fetched (and
    // cached by the client) here, under its own limit.
    await within(client.authorize(), TOKEN_TIMEOUT_MS, 'Google did not issue an access token in time. The next run tries again.')
        .catch(fail);
    const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    return {
        async query({ startDate, endDate, startRow = 0, dimensions = ['date', 'query', 'page'], timeoutMs = REQUEST_TIMEOUT_MS }) {
            try {
                const res = await client.request({
                    url, method: 'POST', timeout: timeoutMs,
                    // 'final' leaves out days Google is still counting, so a
                    // stored day never changes later.
                    data: { startDate, endDate, dimensions, type: 'web', dataState: 'final', rowLimit: PAGE_SIZE, startRow },
                });
                return res.data?.rows ?? [];
            } catch (err) {
                return fail(err);
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day, n) => isoDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

/** A page URL as a site path: no host, query or trailing slash. */
export function pagePath(url) {
    let path;
    try { path = new URL(url).pathname; } catch { return null; }
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return path.length <= 500 ? path : null;
}

/**
 * API rows as table rows: hosts merged by path, each day cut to its top rows
 * by clicks then impressions. Over-long queries (spam) and unusable rows are
 * dropped and counted.
 */
export function mergeRows(apiRows, maxPerDay = MAX_ROWS_PER_DAY) {
    const merged = new Map();
    let dropped = 0;
    for (const r of apiRows) {
        const [day, rawQuery, rawPage] = r.keys ?? [];
        const query = String(rawQuery ?? '').trim().toLowerCase();
        const page = pagePath(rawPage);
        const impressions = Number(r.impressions) || 0;
        // Postgres text cannot hold NUL; one such row would fail its week on every run.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') || !query || query.length > 200 || !page || impressions <= 0
            || query.includes('\u0000') || page.includes('\u0000')) {
            dropped++;
            continue;
        }
        const k = `${day}\t${query}\t${page}`;
        const m = merged.get(k) ?? { day, query, page, clicks: 0, impressions: 0, weighted: 0 };
        m.clicks += Number(r.clicks) || 0;
        m.impressions += impressions;
        m.weighted += (Number(r.position) || 0) * impressions;
        merged.set(k, m);
    }
    const byDay = new Map();
    for (const m of merged.values()) {
        if (!byDay.has(m.day)) byDay.set(m.day, []);
        byDay.get(m.day).push({ day: m.day, query: m.query, page: m.page, clicks: m.clicks,
            impressions: m.impressions, position: m.weighted / m.impressions });
    }
    const rows = [];
    let truncated = 0;
    for (const dayRows of byDay.values()) {
        dayRows.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
        truncated += Math.max(0, dayRows.length - maxPerDay);
        rows.push(...dayRows.slice(0, maxPerDay));
    }
    return { rows, dropped, truncated };
}

/**
 * The days to fetch: from the day after the newest stored one (or 90 days
 * back on the first run) to yesterday. Google withholds days it is still
 * counting, so the newest ones simply come back empty until they are final.
 */
export function syncWindow(latest, now = new Date()) {
    const floor = isoDay(now.getTime() - BACKFILL_DAYS * DAY_MS);
    const end = isoDay(now.getTime() - DAY_MS);
    let start = latest ? addDays(latest, 1) : floor;
    if (start < floor) start = floor;
    return start <= end ? { start, end } : null;
}

function chunks({ start, end }) {
    const out = [];
    for (let s = start; s <= end; s = addDays(s, CHUNK_DAYS)) {
        const e = addDays(s, CHUNK_DAYS - 1);
        out.push([s, e < end ? e : end]);
    }
    return out;
}

/** Search Console's own daily totals: every search, anonymised ones included. */
export function dayTotals(apiRows) {
    return apiRows
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.keys?.[0] ?? '') && Number(r.impressions) > 0)
        .map((r) => ({ day: r.keys[0], clicks: Number(r.clicks) || 0, impressions: Number(r.impressions), position: Number(r.position) || 0 }));
}

async function replaceDays(rows, totals) {
    const days = [...new Set([...rows.map((r) => r.day), ...totals.map((t) => t.day)])];
    await db.tx(async (tx) => {
        await tx.none('DELETE FROM search_console_rows WHERE day = ANY($1::date[])', [days]);
        await tx.none('DELETE FROM search_console_days WHERE day = ANY($1::date[])', [days]);
        if (totals.length) {
            await tx.none(
                `INSERT INTO search_console_days (day, clicks, impressions, position)
                 SELECT * FROM unnest($1::date[], $2::int[], $3::int[], $4::real[])`,
                [totals.map((t) => t.day), totals.map((t) => t.clicks), totals.map((t) => t.impressions), totals.map((t) => t.position)]
            );
        }
        if (!rows.length) return;
        await tx.none(
            `INSERT INTO search_console_rows (day, query, page, clicks, impressions, position)
             SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::int[], $5::int[], $6::real[])`,
            [rows.map((r) => r.day), rows.map((r) => r.query), rows.map((r) => r.page),
                rows.map((r) => r.clicks), rows.map((r) => r.impressions), rows.map((r) => r.position)]
        );
    });
}

class OutOfTime extends Error {}

/**
 * Copies Search Console rows into search_console_rows, oldest missing week
 * first. Each week is written whole or not at all, so a run that runs out of
 * time leaves no half-filled day and the next run carries on from there.
 *
 * Every outcome is recorded in search_console_syncs (shown in the admin) and
 * logged; a failure also goes to `alert` (telegram notifyAdmin). It is not
 * rethrown: EventBridge would retry it twice and alert three times.
 */
export async function runSearchConsoleSync({ remainingMs = () => Infinity, now = new Date(), fetcher, alert } = {}) {
    const config = searchConsoleConfig();
    if (!config.siteUrl) {
        logEvent('search_console_not_configured');
        return { status: 'not_configured', detail: 'No Search Console property is set in the deploy parameters.' };
    }

    // Problems that are not Google's, e.g. the database, are logged and
    // alerted here too, and the run ends without throwing.
    const failed = async (detail, err) => {
        logFault('search_console_sync_failed', { detail, error: err?.cause?.message ?? err?.message });
        await alert?.(`⚠️ Search Console sync failed: ${detail}`);
    };
    const UNEXPECTED = 'The sync failed unexpectedly. Details are in the function log.';

    let syncId;
    try {
        await db.none(
            `UPDATE search_console_syncs SET status = 'failed', finished_at = now(), detail = $2
              WHERE status = 'running' AND started_at < now() - make_interval(mins => $1)`,
            [STALE_RUN_MINUTES, STALE_DETAIL]
        );
        syncId = (await db.one('INSERT INTO search_console_syncs DEFAULT VALUES RETURNING id')).id;
    } catch (err) {
        if (err.code === '23505') return { status: 'busy', detail: 'A sync is already running.' };
        await failed(UNEXPECTED, err);
        return { status: 'failed', detail: UNEXPECTED };
    }

    const result = { status: 'ok', detail: null, firstDay: null, lastDay: null, rowsStored: 0 };
    // Each request may use the time left, less what writing needs afterwards.
    const timeoutMs = () => {
        const ms = Math.min(REQUEST_TIMEOUT_MS, remainingMs() - REQUEST_MARGIN_MS);
        if (ms < 1000) throw new OutOfTime();
        return ms;
    };
    let start;
    try {
        const client = fetcher ?? await googleFetcher(config);
        const { latest } = await db.one('SELECT max(day)::text AS latest FROM search_console_days');
        const window = syncWindow(latest, now);
        for (const [chunkStart, end] of window ? chunks(window) : []) {
            start = chunkStart;
            if (remainingMs() < MIN_REMAINING_MS) throw new OutOfTime();
            const totals = dayTotals(await client.query({ startDate: start, endDate: end, dimensions: ['date'], timeoutMs: timeoutMs() }));
            const apiRows = [];
            for (let startRow = 0; ; startRow += PAGE_SIZE) {
                const page = await client.query({ startDate: start, endDate: end, startRow, timeoutMs: timeoutMs() });
                apiRows.push(...page);
                if (page.length < PAGE_SIZE) break;
            }
            const { rows, dropped, truncated } = mergeRows(apiRows);
            if (rows.length || totals.length) await replaceDays(rows, totals);
            logEvent('search_console_chunk', { start, end, days: totals.length, apiRows: apiRows.length, stored: rows.length, dropped, truncated });
            result.firstDay ??= start;
            result.lastDay = end;
            result.rowsStored += rows.length;
        }
    } catch (err) {
        if (err instanceof OutOfTime) {
            result.status = 'partial';
            result.detail = `Stopped before ${start} to stay within the time limit. The next run carries on.`;
        } else {
            result.status = 'failed';
            result.detail = err instanceof SyncError ? err.message : UNEXPECTED;
            await failed(result.detail, err);
        }
    }

    try {
        await db.none(
            `UPDATE search_console_syncs SET status = $2, detail = $3, first_day = $4, last_day = $5,
                    rows_stored = $6, finished_at = now() WHERE id = $1`,
            [syncId, result.status, result.detail, result.firstDay, result.lastDay, result.rowsStored]
        );
    } catch (err) {
        // The stored weeks are fine; the record stays 'running' and is shown
        // as unfinished until the next run closes it.
        await failed('The sync could not record its result. Details are in the function log.', err);
    }
    logEvent('search_console_sync', result);
    return result;
}


// ---------------------------------------------------------------------------
// Admin view
// ---------------------------------------------------------------------------

// First match wins; the order puts specific topics before general ones
// ("resin printer" is resin, "pla filament for ender 3" is filament).
const TOPICS = [
    ['brand', /proto\s*design/],
    ['service', /print(ing)?\s+(service|near me|online)|near me|custom\s+(3d|print)|\bstl\b|prototyp|print my|printing (cost|price|charges)/],
    ['resin', /\bresin\b|\bsla\b|\bmsla\b/],
    ['filament', /filament|\bpla\b|\bpetg\b|\babs\b|\btpu\b|\basa\b|\bnylon\b|spool/],
    ['printer', /printer|bambu|creality|\bender\b|anycubic|elegoo|prusa|flashforge|sovol|qidi|\bkobra\b|\ba1 mini\b|\bp1s\b|\bx1c?\b|\bk1\b/],
];
const BUYING = /\b(price|prices|cost|buy|cheap|cheapest|best|under|vs|review|reviews|online|india|shop|store|near me|sale|deal|offer)\b/;

export const topicOf = (query) => TOPICS.find(([, re]) => re.test(query))?.[0] ?? 'other';
export const buyingIntent = (query) => BUYING.test(query);

// Rough click-through at position 3: what a page lifted into the top three
// could expect. Only used to rank opportunities, shown as an estimate.
const TOP3_CTR = 0.10;
const OPPORTUNITY_MIN_IMPRESSIONS = 20;

// Search Console's days are Pacific time; visitors.first_seen_at is UTC.
const PACIFIC_DAY = "(first_seen_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date";

const ctr = (clicks, impressions) => (impressions > 0 ? clicks / impressions : 0);

/**
 * The Search demand section for the last `days` of data, against the `days`
 * before. Periods end at the newest stored day, not today: Search Console
 * runs two or three days behind.
 */
export async function searchDemand({ days = 28 } = {}) {
    const config = searchConsoleConfig();
    const [range, lastSync, lastOk] = await Promise.all([
        db.one('SELECT min(day)::text AS first, max(day)::text AS latest FROM search_console_days'),
        db.oneOrNone(`SELECT status, detail, rows_stored, started_at, finished_at FROM search_console_syncs
                       ORDER BY started_at DESC LIMIT 1`),
        db.oneOrNone(`SELECT finished_at FROM search_console_syncs WHERE status IN ('ok', 'partial')
                       ORDER BY started_at DESC LIMIT 1`),
    ]);
    // A run killed by the function timeout is closed only by the next run.
    if (lastSync?.status === 'running' && Date.now() - new Date(lastSync.started_at).getTime() > STALE_RUN_MINUTES * 60_000) {
        Object.assign(lastSync, { status: 'failed', detail: STALE_DETAIL });
    }
    const base = {
        configured: Boolean(config.siteUrl), siteUrl: config.siteUrl, days,
        dataFrom: range.first, dataThrough: range.latest, lastSync, lastSuccessAt: lastOk?.finished_at ?? null,
    };
    if (!range.latest) return { ...base, empty: true };

    // [cur_from, latest] is the period, [prev_from, cur_from) the one before.
    const curFrom = addDays(range.latest, -(days - 1));
    const prevFrom = addDays(range.latest, -(2 * days - 1));
    // Until enough history is stored, the period before is part-empty and any
    // comparison with it would show growth that is not there.
    const previousComplete = range.first <= prevFrom;
    const [totals, queryRows, pages, organic] = await Promise.all([
        // Search Console's own daily totals, so the headline numbers match
        // its reports; the per-search rows below leave out anonymised searches.
        db.any(
            `SELECT day >= $1::date AS cur, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions,
                    (sum(position * impressions) / sum(impressions))::float AS position
               FROM search_console_days WHERE day >= $2::date GROUP BY 1`,
            [curFrom, prevFrom]
        ),
        // Per query and page first, so each query's main page is the one with
        // the most impressions over the current period. Impressions are summed
        // across pages, as in Search Console's page-level reports.
        db.any(
            `WITH qp AS (
                 SELECT query, page, day >= $1::date AS cur, sum(clicks) AS clicks, sum(impressions) AS impressions,
                        sum(position * impressions) AS weighted
                   FROM search_console_rows WHERE day >= $2::date GROUP BY 1, 2, 3)
             SELECT query,
                    COALESCE(sum(clicks) FILTER (WHERE cur), 0)::int AS clicks,
                    COALESCE(sum(impressions) FILTER (WHERE cur), 0)::int AS impressions,
                    (sum(weighted) FILTER (WHERE cur) / sum(impressions) FILTER (WHERE cur))::float AS position,
                    COALESCE(sum(clicks) FILTER (WHERE NOT cur), 0)::int AS prev_clicks,
                    COALESCE(sum(impressions) FILTER (WHERE NOT cur), 0)::int AS prev_impressions,
                    (array_agg(page ORDER BY impressions DESC) FILTER (WHERE cur))[1] AS page
               FROM qp GROUP BY query
              ORDER BY greatest(COALESCE(sum(impressions) FILTER (WHERE cur), 0),
                                COALESCE(sum(impressions) FILTER (WHERE NOT cur), 0)) DESC
              LIMIT 5000`,
            [curFrom, prevFrom]
        ),
        // Search pages beside what tracked visitors who landed there from
        // Google did next. Visitors count only people who allowed analytics.
        db.any(
            `WITH sc AS (
                 SELECT page, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions,
                        (sum(position * impressions) / sum(impressions))::float AS position
                   FROM search_console_rows WHERE day >= $1::date GROUP BY page),
             top_query AS (
                 SELECT DISTINCT ON (page) page, query FROM (
                     SELECT page, query, sum(impressions) AS impressions FROM search_console_rows
                      WHERE day >= $1::date GROUP BY 1, 2) t
                  ORDER BY page, impressions DESC),
             visits AS (
                 SELECT CASE WHEN landing_path = '/' THEN '/' ELSE rtrim(landing_path, '/') END AS page,
                        count(*)::int AS visitors, count(lead_id)::int AS leads
                   FROM visitors
                  WHERE source = 'google' AND medium = 'organic'
                    AND ${PACIFIC_DAY} BETWEEN $1::date AND $2::date
                  GROUP BY 1)
             SELECT sc.page, sc.clicks, sc.impressions, sc.position, tq.query AS top_query,
                    COALESCE(v.visitors, 0) AS visitors, COALESCE(v.leads, 0) AS leads
               FROM sc LEFT JOIN visits v USING (page) LEFT JOIN top_query tq USING (page)
              ORDER BY sc.clicks DESC, sc.impressions DESC LIMIT 25`,
            [curFrom, range.latest]
        ),
        db.one(
            `SELECT count(*)::int AS visitors, count(lead_id)::int AS leads FROM visitors
              WHERE source = 'google' AND medium = 'organic'
                AND ${PACIFIC_DAY} BETWEEN $1::date AND $2::date`,
            [curFrom, range.latest]
        ),
    ]);

    const period = (cur) => totals.find((t) => t.cur === cur) ?? { clicks: 0, impressions: 0, position: null };
    const queries = queryRows.map((q) => ({
        ...q, ctr: ctr(q.clicks, q.impressions), topic: topicOf(q.query), buying: buyingIntent(q.query),
    }));
    const current = queries.filter((q) => q.impressions > 0);

    const topics = new Map();
    for (const q of queries) {
        const t = topics.get(q.topic) ?? { topic: q.topic, clicks: 0, impressions: 0, prev_impressions: 0, buying_impressions: 0, queries: 0 };
        t.clicks += q.clicks;
        t.impressions += q.impressions;
        t.prev_impressions += q.prev_impressions;
        if (q.buying) t.buying_impressions += q.impressions;
        if (q.impressions > 0) t.queries++;
        topics.set(q.topic, t);
    }

    // Two kinds of opportunity. Close to the top: ranking 4-20 with real
    // impressions, where a better page could take clicks from the top three.
    // Seen but skipped: already top three yet rarely clicked, so the title or
    // description in the result is not doing its job.
    const opportunities = current
        .filter((q) => q.impressions >= OPPORTUNITY_MIN_IMPRESSIONS)
        .flatMap((q) => {
            if (q.position >= 4 && q.position <= 20) {
                return [{ ...q, kind: 'close_to_top', extra_clicks: Math.round(q.impressions * Math.max(0, TOP3_CTR - q.ctr)) }];
            }
            if (q.position < 4 && q.impressions >= 50 && q.ctr < 0.03) {
                return [{ ...q, kind: 'low_ctr', extra_clicks: Math.round(q.impressions * (TOP3_CTR - q.ctr)) }];
            }
            return [];
        })
        .filter((o) => o.extra_clicks > 0)
        .sort((a, b) => b.extra_clicks - a.extra_clicks)
        .slice(0, 20);

    const rising = !previousComplete ? [] : current
        .filter((q) => q.impressions >= 10 && q.impressions >= 2 * q.prev_impressions)
        .sort((a, b) => (b.impressions - b.prev_impressions) - (a.impressions - a.prev_impressions))
        .slice(0, 15);

    return {
        ...base,
        empty: false,
        period: { from: curFrom, to: range.latest, previousFrom: prevFrom, previousComplete },
        totals: { current: period(true), previous: period(false) },
        organic,
        topics: [...topics.values()].sort((a, b) => b.impressions - a.impressions),
        opportunities,
        rising,
        queries: current.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 200),
        pages,
    };
}
