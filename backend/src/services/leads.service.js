import { createHash } from 'crypto';
import db from '../config/database.js';

/**
 * First-party visit tracking and lead capture (docs/lead-tracking.md).
 *
 * Google never tells a site who searched for what. What this module records
 * is what the site itself can see once a visitor accepts analytics: where
 * they came from (UTM tags, Google Ads click id, referrer), which pages and
 * products they looked at, and -- only when they fill in a form and agree to
 * be contacted -- who they are. A lead's earlier anonymous visits are joined
 * to it through the browser's visitor id.
 *
 * Storage is the constraint that shapes this: Neon's free tier stops every
 * write (checkout included) at 0.5 GB. Events are capped per visitor and per
 * day, pruned daily, and the database size is checked daily with a Telegram
 * alert well before the cap.
 */

export const MAINTENANCE_EVENT_SOURCE = 'protodesign.lead-maintenance';

export const EVENT_NAMES = new Set(['page_view', 'product_view', 'add_to_cart', 'quote_start']);
export const INTERESTS = new Set(['printer', 'filament', 'resin', 'service', 'other']);
export const LEAD_STATUSES = new Set(['new', 'contacted', 'qualified', 'won', 'lost']);

// The wording shown beside each form's consent checkbox. The browser sends the
// version it showed; the text stored with the lead comes from here, never from
// the request. A wording change gets a new version so old consents stay true.
export const CONSENT_TEXTS = Object.freeze({
    'lead-contact-v1': 'I agree that ProtoDesign may contact me on WhatsApp, phone or email about this enquiry. '
        + 'I can ask for my details to be deleted at any time.',
});

const MAX_BATCH = 20;
const MAX_BODY_CHARS = 16_000;
const PER_VISITOR_DAILY_EVENTS = 300;
// Per network per day. Generous because Indian mobile carriers put many
// customers behind one address (CGNAT); these stop scripts, not people.
const NEW_VISITORS_PER_IP_DAILY = 100;
const NEW_LEADS_PER_IP_DAILY = 10;
const LEAD_ALERTS_PER_HOUR = 10;
const ANON_RETENTION_DAYS = 30;
const EVENT_RETENTION_DAYS = 180;
const NEON_FREE_STORAGE_BYTES = 512 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

/** Read at call time so tests and config changes need no re-import. */
export function getLimits(env = process.env) {
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
    return {
        dailyEvents: num(env.TRACKING_DAILY_EVENT_CAP, 20_000),
        dailyLeads: num(env.LEADS_DAILY_CAP, 300),
        storageAlertBytes: num(env.STORAGE_ALERT_BYTES, 400 * 1024 * 1024),
    };
}

export class InputError extends Error {
    constructor(message) { super(message); this.status = 400; }
}

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const clip = (v, max) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, max) : null;
};

/**
 * A path on this site, without its query string or fragment: those can carry
 * secrets (a password-reset link's token) and attribution is taken from the
 * UTM fields instead. Anything that is not a site path is dropped.
 */
const sitePath = (v) => {
    const s = clip(String(v ?? '').split(/[?#]/)[0], 500);
    return s && s.startsWith('/') && !s.startsWith('//') ? s : null;
};

/**
 * The client address as a hash salted with the day, so rows from one network
 * on one day can be counted but an address cannot be recovered or followed
 * across days. Under Lambda the address is AWS's sourceIp, not a header.
 */
export function ipHash(ip, now = new Date()) {
    if (!ip) return null;
    const salt = process.env.IP_HASH_SALT || process.env.JWT_SECRET || '';
    return createHash('sha256').update(`${now.toISOString().slice(0, 10)}:${salt}:${ip}`).digest('hex');
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

// Search engines by their own result-page hosts only: mail.google.com is not
// a search, and google.example.com is not Google.
const SEARCH_ENGINES = [[/^google\.[a-z]{2,3}(\.[a-z]{2})?$/, 'google'], [/^bing\.com$/, 'bing'],
    [/^duckduckgo\.com$/, 'duckduckgo'], [/^([a-z]+\.)?search\.yahoo\.com$/, 'yahoo'],
    [/^yandex\.(ru|com)$/, 'yandex'], [/^ecosia\.org$/, 'ecosia']];
const AI_ASSISTANTS = [['chatgpt.com', 'chatgpt'], ['chat.openai.com', 'chatgpt'], ['perplexity.ai', 'perplexity'],
    ['gemini.google.com', 'gemini'], ['copilot.microsoft.com', 'copilot'], ['claude.ai', 'claude']];
const SOCIAL = [['facebook.com', 'facebook'], ['instagram.com', 'instagram'], ['t.co', 'x'], ['x.com', 'x'],
    ['twitter.com', 'x'], ['linkedin.com', 'linkedin'], ['youtube.com', 'youtube'], ['reddit.com', 'reddit'],
    ['whatsapp.com', 'whatsapp'], ['wa.me', 'whatsapp']];

const hostMatches = (host, pattern) => pattern instanceof RegExp
    ? pattern.test(host)
    : host === pattern || host.endsWith(`.${pattern}`);

/**
 * Source and medium for a first visit, in the order GA4 uses: an Ads click id,
 * then explicit UTM tags, then the referrer. Organic search never carries the
 * search words (Google withholds them); `term` is only ever a UTM value.
 */
export function classifySource(raw = {}) {
    const touch = {
        source: null, medium: null,
        campaign: clip(raw.utm_campaign, 150),
        term: clip(raw.utm_term, 150),
        gclid: clip(raw.gclid, 200),
        referrer_host: clip(raw.referrer_host, 255)?.toLowerCase().replace(/^www\./, '') ?? null,
        landing_path: sitePath(raw.landing_path),
    };
    const utmSource = clip(raw.utm_source, 100)?.toLowerCase();
    const utmMedium = clip(raw.utm_medium, 100)?.toLowerCase();

    if (touch.gclid) return { ...touch, source: utmSource || 'google', medium: 'cpc' };
    if (utmSource) return { ...touch, source: utmSource, medium: utmMedium || 'referral' };

    const host = touch.referrer_host;
    if (!host) return { ...touch, source: 'direct', medium: 'none' };
    for (const [list, medium] of [[AI_ASSISTANTS, 'ai'], [SEARCH_ENGINES, 'organic'], [SOCIAL, 'social']]) {
        const hit = list.find(([pattern]) => hostMatches(host, pattern));
        if (hit) return { ...touch, source: hit[1], medium };
    }
    return { ...touch, source: host, medium: 'referral' };
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

/**
 * The beacon body: text/plain (no CORS preflight, so it survives page unload)
 * carrying JSON. Under Lambda it arrives as a Buffer; under a local server as
 * a string from express.text.
 */
export function parseBeacon(body) {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    if (typeof text === 'object' && text !== null) return text;
    if (typeof text !== 'string' || !text) throw new InputError('Empty body');
    if (text.length > MAX_BODY_CHARS) throw new InputError('Body too large');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new InputError('Malformed JSON body'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('Body must be a JSON object');
    return parsed;
}

/** Keeps only well-formed events; an unknown name or product id is dropped, not fatal. */
export function cleanEvents(events) {
    if (!Array.isArray(events) || events.length === 0) throw new InputError('events must be a non-empty array');
    if (events.length > MAX_BATCH) throw new InputError(`At most ${MAX_BATCH} events per request`);
    return events
        .filter((e) => e && EVENT_NAMES.has(e.name))
        .map((e) => ({ name: e.name, path: sitePath(e.path), product_id: isUuid(e.productId) ? e.productId : null }));
}

/**
 * Records a batch for one visitor. The first batch creates the visitor with
 * its first-touch attribution; later batches only move last_seen_at. Returns
 * how many events were stored (0 when a cap is reached -- logged, not an error,
 * since the browser cannot do anything about it).
 */
export async function recordEvents({ visitorId, events, attribution, ipHash: ip = null }) {
    if (!isUuid(visitorId)) throw new InputError('visitorId must be a UUID');
    const rows = cleanEvents(events);
    if (rows.length === 0) return 0;

    const limits = getLimits();
    const usage = await db.one(
        `SELECT (SELECT count(*) FROM visitor_events WHERE created_at > now() - interval '1 day')::int AS total,
                (SELECT count(*) FROM visitor_events
                  WHERE visitor_id = $1 AND created_at > now() - interval '1 day')::int AS visitor,
                EXISTS (SELECT 1 FROM visitors WHERE id = $1) AS known,
                (SELECT count(*) FROM visitors
                  WHERE $2::text IS NOT NULL AND ip_hash = $2 AND first_seen_at > now() - interval '1 day')::int AS ip_new`,
        [visitorId, ip]
    );
    if (usage.total + rows.length > limits.dailyEvents) {
        logFault('tracking_daily_cap_reached', { cap: limits.dailyEvents });
        return 0;
    }
    if (usage.visitor + rows.length > PER_VISITOR_DAILY_EVENTS) {
        logEvent('tracking_visitor_cap_reached', { visitorId });
        return 0;
    }
    // Fresh visitor ids cost nothing to make up, so new ones are capped per network.
    if (!usage.known && usage.ip_new >= NEW_VISITORS_PER_IP_DAILY) {
        logFault('tracking_ip_cap_reached', { cap: NEW_VISITORS_PER_IP_DAILY });
        return 0;
    }

    const t = classifySource(attribution || {});
    return db.tx(async (tx) => {
        await tx.none(
            `INSERT INTO visitors (id, source, medium, campaign, term, gclid, referrer_host, landing_path, ip_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
            [visitorId, t.source, t.medium, t.campaign, t.term, t.gclid, t.referrer_host, t.landing_path, ip]
        );
        // A product id that is not in the catalogue is stored as NULL rather
        // than failing the batch on the foreign key.
        const inserted = await tx.result(
            `INSERT INTO visitor_events (visitor_id, name, path, product_id)
             SELECT $1, e.name, e.path, p.id
               FROM json_to_recordset($2::json) AS e(name text, path text, product_id uuid)
               LEFT JOIN products p ON p.id = e.product_id`,
            [visitorId, JSON.stringify(rows)]
        );
        return inserted.rowCount;
    });
}

/** "No thanks" after an earlier "Allow": the browser's visits are deleted, not just forgotten locally. */
export async function forgetVisitor(visitorId) {
    if (!isUuid(visitorId)) throw new InputError('visitorId must be a UUID');
    const res = await db.result('DELETE FROM visitors WHERE id = $1', [visitorId]);
    if (res.rowCount) logEvent('visitor_forgotten', { visitorId });
}

/** A signed-in customer's browser: links its visits to their account. Never re-links. */
export async function identifyVisitor({ visitorId, userId }) {
    if (!isUuid(visitorId)) throw new InputError('visitorId must be a UUID');
    await db.none(
        'UPDATE visitors SET user_id = $2 WHERE id = $1 AND user_id IS NULL',
        [visitorId, userId]
    );
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/**
 * Indian mobile numbers as typed (98765 43210, +91-98765-43210, 098765...)
 * become E.164 digits (919876543210). Other countries must include '+'.
 */
export function normalizePhone(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const s = String(raw).trim();
    const digits = s.replace(/\D/g, '');
    let out = null;
    if (s.startsWith('+')) out = digits;
    else if (digits.length === 10) out = `91${digits}`;
    else if (digits.length === 11 && digits.startsWith('0')) out = `91${digits.slice(1)}`;
    else if (digits.length === 12 && digits.startsWith('91')) out = digits;
    if (!out || !/^[1-9][0-9]{9,14}$/.test(out)) throw new InputError('Enter a valid phone number');
    if (out.startsWith('91') && !/^91[6-9][0-9]{9}$/.test(out)) throw new InputError('Enter a valid Indian mobile number');
    return out;
}

export function validateLead(body = {}) {
    const phone = normalizePhone(body.phone);
    const email = clip(body.email, 254)?.toLowerCase() ?? null;
    if (email && !EMAIL_RE.test(email)) throw new InputError('Enter a valid email address');
    if (!phone && !email) throw new InputError('A phone number or email is required');

    const consentText = CONSENT_TEXTS[body.consentVersion];
    if (body.consent !== true || !consentText) throw new InputError('Consent is required');

    const interest = INTERESTS.has(body.interest) ? body.interest : 'other';
    const form = /^[a-z_]{1,40}$/.test(body.form || '') ? body.form : 'unknown';
    return {
        name: clip(body.name, 120), phone, email, interest, form, consentText,
        message: clip(body.message, 1000),
        productId: isUuid(body.productId) ? body.productId : null,
        visitorId: isUuid(body.visitorId) ? body.visitorId : null,
    };
}

/**
 * Creates a lead, or updates the one with the same phone (else email). The
 * visitor that submitted it is linked, and a new lead takes that visitor's
 * first-touch attribution. Returns { lead, created } or null when the daily
 * cap is reached.
 */
export async function captureLead(input, { userId = null, ipHash: ip = null } = {}) {
    const limits = getLimits();
    return db.tx(async (tx) => {
        const today = await tx.one(
            `SELECT (SELECT count(*) FROM leads WHERE created_at > now() - interval '1 day')::int AS total,
                    (SELECT count(*) FROM leads WHERE $1::text IS NOT NULL AND ip_hash = $1
                                                  AND created_at > now() - interval '1 day')::int AS from_ip`,
            [ip]
        );

        // Serialise submissions for the same contact so two at once cannot
        // both miss the lookup and insert twice. Phone before email, always,
        // so two transactions never wait on each other's second lock.
        for (const key of [input.phone && `p:${input.phone}`, input.email && `e:${input.email}`].filter(Boolean)) {
            await tx.one('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        }
        // Same phone, else same email: a known customer adding or changing a
        // number is still the same lead.
        const existing = (input.phone && await tx.oneOrNone('SELECT id FROM leads WHERE phone = $1', [input.phone]))
            || (input.email && await tx.oneOrNone(
                'SELECT id FROM leads WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 1', [input.email]))
            || null;

        if (!existing && today.total >= limits.dailyLeads) {
            logFault('leads_daily_cap_reached', { cap: limits.dailyLeads });
            return null;
        }
        if (!existing && today.from_ip >= NEW_LEADS_PER_IP_DAILY) {
            logFault('leads_ip_cap_reached', { cap: NEW_LEADS_PER_IP_DAILY });
            return null;
        }

        const product = input.productId
            ? await tx.oneOrNone('SELECT id FROM products WHERE id = $1', [input.productId])
            : null;
        const visitor = input.visitorId
            ? await tx.oneOrNone('SELECT * FROM visitors WHERE id = $1', [input.visitorId])
            : null;

        let lead;
        if (existing) {
            // A repeat enquiry: the newest message and interest win; known
            // contact details are only filled in, never overwritten. The
            // original consent record is kept as it is -- numbers are not
            // verified, so a repeat must not be able to rewrite that proof.
            lead = await tx.one(
                `UPDATE leads SET
                    name = COALESCE(name, $2), phone = COALESCE(phone, $3), email = COALESCE(email, $4),
                    interest = $5, message = COALESCE($6, message), product_id = COALESCE($7, product_id),
                    form = $8, user_id = COALESCE(user_id, $9),
                    submissions = submissions + 1, last_submitted_at = now(),
                    status = CASE WHEN status = 'lost' THEN 'new' ELSE status END
                  WHERE id = $1 RETURNING *`,
                [existing.id, input.name, input.phone, input.email, input.interest, input.message,
                    product?.id ?? null, input.form, userId]
            );
        } else {
            const v = visitor || {};
            lead = await tx.one(
                `INSERT INTO leads (name, phone, email, interest, message, product_id, form, user_id, consent_text,
                                    source, medium, campaign, term, gclid, referrer_host, landing_path, ip_hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
                [input.name, input.phone, input.email, input.interest, input.message, product?.id ?? null,
                    input.form, userId, input.consentText, v.source ?? null, v.medium ?? null, v.campaign ?? null,
                    v.term ?? null, v.gclid ?? null, v.referrer_host ?? null, v.landing_path ?? null, ip]
            );
        }

        if (visitor) {
            // A shared browser keeps the first lead it was linked to.
            await tx.none('UPDATE visitors SET lead_id = $2 WHERE id = $1 AND lead_id IS NULL', [visitor.id, lead.id]);
            await tx.none(
                `INSERT INTO visitor_events (visitor_id, name, path, product_id) VALUES ($1, 'lead_submit', NULL, $2)`,
                [visitor.id, product?.id ?? null]
            );
        }
        logEvent('lead_captured', { leadId: lead.id, created: !existing, form: input.form, source: lead.source });
        // A flood of fake enquiries must not also flood the admins' Telegram.
        const { n } = await tx.one(`SELECT count(*)::int AS n FROM leads WHERE created_at > now() - interval '1 hour'`);
        const alert = !existing && n <= LEAD_ALERTS_PER_HOUR;
        if (!existing && !alert) logFault('lead_alerts_suppressed', { perHour: LEAD_ALERTS_PER_HOUR });
        return { lead, created: !existing, alert };
    });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** The Leads section: 30-day funnel by channel, top pages and products, and the leads. */
export async function adminOverview() {
    const [totals, channels, landings, products, leads, storage] = await Promise.all([
        db.one(
            `SELECT (SELECT count(*) FROM visitors WHERE first_seen_at > now() - interval '30 days')::int AS visitors_30d,
                    (SELECT count(*) FROM visitors WHERE first_seen_at > now() - interval '60 days'
                                                     AND first_seen_at <= now() - interval '30 days')::int AS visitors_prev,
                    (SELECT count(*) FROM leads WHERE created_at > now() - interval '30 days')::int AS leads_30d,
                    (SELECT count(*) FROM leads WHERE created_at > now() - interval '60 days'
                                                  AND created_at <= now() - interval '30 days')::int AS leads_prev,
                    (SELECT count(lead_id) FROM visitors WHERE first_seen_at > now() - interval '30 days')::int AS converted_30d,
                    (SELECT count(*) FROM leads WHERE status = 'new')::int AS leads_new`
        ),
        // Which channels bring people who become leads -- the number that says
        // where marketing money is and is not working.
        db.any(
            `SELECT COALESCE(source, 'unknown') AS source, COALESCE(medium, 'unknown') AS medium,
                    count(*)::int AS visitors, count(lead_id)::int AS leads
               FROM visitors WHERE first_seen_at > now() - interval '30 days'
              GROUP BY 1, 2 ORDER BY visitors DESC LIMIT 15`
        ),
        db.any(
            `SELECT landing_path AS path, count(*)::int AS visitors, count(lead_id)::int AS leads
               FROM visitors WHERE first_seen_at > now() - interval '30 days' AND landing_path IS NOT NULL
              GROUP BY 1 ORDER BY visitors DESC LIMIT 10`
        ),
        db.any(
            `SELECT p.id, p.name, p.category,
                    count(*) FILTER (WHERE e.name = 'product_view')::int AS views,
                    count(DISTINCT e.visitor_id) FILTER (WHERE e.name = 'product_view')::int AS viewers,
                    count(*) FILTER (WHERE e.name = 'add_to_cart')::int AS carts,
                    count(DISTINCT v.lead_id)::int AS leads
               FROM visitor_events e
               JOIN products p ON p.id = e.product_id
               JOIN visitors v ON v.id = e.visitor_id
              WHERE e.created_at > now() - interval '30 days'
              GROUP BY p.id ORDER BY views DESC LIMIT 10`
        ),
        db.any(
            `SELECT l.id, l.name, l.phone, l.email, l.interest, l.message, l.form, l.status, l.admin_notes,
                    l.source, l.medium, l.campaign, l.landing_path, l.submissions, l.created_at,
                    l.last_submitted_at, p.name AS product_name,
                    COALESCE(a.events, 0)::int AS events, COALESCE(a.product_views, 0)::int AS product_views,
                    GREATEST(l.last_submitted_at, a.last_event_at) AS last_activity_at
               FROM leads l
               LEFT JOIN products p ON p.id = l.product_id
               LEFT JOIN LATERAL (
                    SELECT count(*) AS events, count(*) FILTER (WHERE e.name = 'product_view') AS product_views,
                           max(e.created_at) AS last_event_at
                      FROM visitors v JOIN visitor_events e ON e.visitor_id = v.id
                     WHERE v.lead_id = l.id) a ON true
              ORDER BY GREATEST(l.last_submitted_at, a.last_event_at) DESC NULLS LAST
              LIMIT 500`
        ),
        databaseSize(),
    ]);
    return { totals, channels, landings, products, leads, storage };
}

/**
 * One lead's journey: every visit from browsers linked to it, oldest first,
 * and the orders of the account it is linked to. Not matched by email: a lead's
 * email is unverified, so anyone could type a customer's and see their orders.
 */
export async function adminLeadDetail(leadId) {
    if (!isUuid(leadId)) return null;
    const lead = await db.oneOrNone('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return null;
    const [events, orders] = await Promise.all([
        db.any(
            `SELECT e.name, e.path, e.created_at, p.id AS product_id, p.name AS product_name
               FROM visitors v JOIN visitor_events e ON e.visitor_id = v.id
               LEFT JOIN products p ON p.id = e.product_id
              WHERE v.lead_id = $1
              ORDER BY e.created_at DESC, e.id DESC LIMIT 300`,
            [leadId]
        ),
        db.any(
            `SELECT id, status, total_amount, created_at FROM orders
              WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [lead.user_id]
        ),
    ]);
    return { lead, events: events.reverse(), orders };
}

export async function updateLead(leadId, { status, admin_notes }) {
    if (!isUuid(leadId)) return null;
    if (status !== undefined && !LEAD_STATUSES.has(status)) throw new InputError('Unknown status');
    return db.oneOrNone(
        `UPDATE leads SET status = COALESCE($2, status), admin_notes = CASE WHEN $3 THEN $4 ELSE admin_notes END
          WHERE id = $1 RETURNING id, status, admin_notes`,
        [leadId, status ?? null, admin_notes !== undefined, clip(admin_notes, 2000)]
    );
}

/**
 * Erasure on request: the lead and every visit from browsers linked only to
 * it. A browser that is also a signed-in customer's keeps its visits but
 * loses the link.
 */
export async function deleteLead(leadId) {
    if (!isUuid(leadId)) return false;
    return db.tx(async (tx) => {
        await tx.none('DELETE FROM visitors WHERE lead_id = $1 AND user_id IS NULL', [leadId]);
        const res = await tx.result('DELETE FROM leads WHERE id = $1', [leadId]);
        if (res.rowCount) logEvent('lead_deleted', { leadId });
        return res.rowCount > 0;
    });
}

// ---------------------------------------------------------------------------
// Daily maintenance
// ---------------------------------------------------------------------------

export async function databaseSize() {
    const { bytes } = await db.one('SELECT pg_database_size(current_database())::bigint AS bytes');
    return { bytes: Number(bytes), limitBytes: NEON_FREE_STORAGE_BYTES, alertBytes: getLimits().storageAlertBytes };
}

/**
 * Deletes anonymous visitors idle for 30 days (their events go with them) and
 * any event older than 180 days, then checks the database size. `alert` is
 * telegram.service's notifyAdmin, passed in to keep this module free of it.
 */
export async function runLeadMaintenance({ alert } = {}) {
    const anon = await db.result(
        `DELETE FROM visitors
          WHERE lead_id IS NULL AND user_id IS NULL AND last_seen_at < now() - make_interval(days => $1)`,
        [ANON_RETENTION_DAYS]
    );
    const old = await db.result(
        'DELETE FROM visitor_events WHERE created_at < now() - make_interval(days => $1)',
        [EVENT_RETENTION_DAYS]
    );
    const storage = await databaseSize();
    const result = { visitorsDeleted: anon.rowCount, eventsDeleted: old.rowCount, ...storage };
    logEvent('lead_maintenance', result);

    // Postgres does not hand space back after deletes, so once over the line
    // this alerts daily until someone acts (VACUUM FULL, or the planned move
    // off the free tier). That repetition is intended.
    if (storage.bytes >= storage.alertBytes) {
        const mb = (b) => Math.round(b / 1024 / 1024);
        logFault('database_storage_high', storage);
        await alert?.(`⚠️ Database is ${mb(storage.bytes)} MB of Neon's ${mb(storage.limitBytes)} MB free tier. `
            + 'At the limit every write fails, checkout included.');
    }
    return result;
}
