import { createHash, timingSafeEqual } from 'node:crypto';
import db from '../config/database.js';

/**
 * Google Ads (docs/google-ads.md), only for people who opted in to it:
 *
 *  - Offline conversions: a CSV that Google Ads fetches on a schedule, listing
 *    ad clicks (GCLIDs) that led to an enquiry or a paid order. Only visitors
 *    who allowed ad measurement are included, and only the click id, the
 *    conversion and its value leave the shop -- never a name or contact.
 *  - Customer Match: a CSV of SHA-256 hashed emails and phone numbers that
 *    the admin uploads as a Google Ads audience. Only leads who ticked the
 *    Customer Match box, and only contact details whose owner proved them
 *    after ticking it (a WhatsApp message from that number, a confirmed email
 *    alert), so nobody can put someone else's number into an ad audience.
 *
 * No Google Ads API: it needs an approved developer token and OAuth for a
 * shop this size, while scheduled HTTPS imports and file uploads need neither.
 */

// A sale is a paid order (PhonePe), or a delivered one (cash on delivery,
// which is not paid until then); never a cancelled one.
const DELIVERED_STATUSES = ['delivered', 'completed'];
// A Customer Match consent counts only with proof of the contact from after
// it was given: the person's own WhatsApp message or confirmed email within
// this many days. Anyone can type someone else's number into a form; that
// number's owner messaging us right after is what shows it was them.
const PROOF_DAYS = 14;
// Google accepts a click's conversions for up to 90 days after the click.
const CLICK_WINDOW_DAYS = 90;
// Each fetch repeats the last week, so a missed fetch loses nothing; Google
// ignores a conversion it has already imported (same click, name and time).
export const FEED_DAYS = 7;
const TIME_ZONE = 'Asia/Kolkata';

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

export function adsConfig(env = process.env) {
    return {
        feedSecret: env.ADS_FEED_SECRET || '',
        // Must equal the names of the conversion actions created in Google Ads.
        leadConversion: env.ADS_LEAD_CONVERSION || 'ProtoDesign lead',
        purchaseConversion: env.ADS_PURCHASE_CONVERSION || 'ProtoDesign purchase',
    };
}

const safeEqual = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Whether a feed request carries the secret: as the Basic-auth password (any
 * user name), or as ?key= for import tools without Basic auth. A secret
 * shorter than 24 characters keeps the feed off.
 */
export function feedAuthorized(req, secret = adsConfig().feedSecret) {
    if (secret.length < 24) return false;
    const header = req.headers?.authorization ?? '';
    if (/^basic /i.test(header)) {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        return safeEqual(decoded.slice(decoded.indexOf(':') + 1), secret);
    }
    return typeof req.query?.key === 'string' && safeEqual(req.query.key, secret);
}

/**
 * Conversions from the last `days`: one per lead, and one per sale, each
 * tied to an ad click before it, within 90 days, from a browser that allowed
 * measurement for that click. A sale is listed by when it became one (its
 * last update), so an order paid or delivered late still makes the feed; its
 * conversion time stays when it was placed, which keeps Google's duplicate
 * check stable across fetches.
 */
export async function conversions({ days = FEED_DAYS } = {}) {
    const { leadConversion, purchaseConversion } = adsConfig();
    return db.any(
        `WITH lead_conv AS (
             SELECT DISTINCT ON (l.id) v.gclid, $1::text AS name, l.created_at AS at, NULL::numeric AS value
               FROM leads l JOIN visitors v ON v.lead_id = l.id
              WHERE v.gclid IS NOT NULL AND v.ads_consent_at IS NOT NULL
                AND l.created_at > now() - make_interval(days => $3)
                AND l.created_at >= COALESCE(v.gclid_at, v.first_seen_at)
                AND l.created_at < COALESCE(v.gclid_at, v.first_seen_at) + make_interval(days => $4)
              ORDER BY l.id, COALESCE(v.gclid_at, v.first_seen_at) DESC),
         order_conv AS (
             SELECT DISTINCT ON (o.id) v.gclid, $2::text AS name, o.created_at AS at, o.total_amount AS value
               FROM orders o JOIN visitors v ON v.user_id = o.user_id
              WHERE o.status <> 'cancelled' AND (o.payment_status = 'paid' OR o.status IN ($5:csv))
                AND v.gclid IS NOT NULL AND v.ads_consent_at IS NOT NULL
                AND COALESCE(o.updated_at, o.created_at) > now() - make_interval(days => $3)
                AND o.created_at >= COALESCE(v.gclid_at, v.first_seen_at)
                AND o.created_at < COALESCE(v.gclid_at, v.first_seen_at) + make_interval(days => $4)
              ORDER BY o.id, COALESCE(v.gclid_at, v.first_seen_at) DESC)
         SELECT gclid, name,
                -- A plain TIMESTAMP is in the session's zone (UTC on Neon).
                to_char(at::timestamptz AT TIME ZONE $6, 'YYYY-MM-DD HH24:MI:SS') AS time,
                value::float AS value
           FROM (SELECT * FROM lead_conv UNION ALL SELECT * FROM order_conv) c
          ORDER BY at`,
        [leadConversion, purchaseConversion, days, CLICK_WINDOW_DAYS, DELIVERED_STATUSES, TIME_ZONE]
    );
}

// RFC 4180 quoting; a click id or a configured name never needs more.
const cell = (v) => (v === null || v === undefined ? '' : /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** Google's offline click-conversion import format. */
export function conversionsCsv(rows) {
    return [
        `Parameters:TimeZone=${TIME_ZONE}`,
        'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency',
        ...rows.map((r) => [r.gclid, r.name, r.time, r.value ?? '', r.value === null ? '' : 'INR'].map(cell).join(',')),
    ].join('\n') + '\n';
}

/** The feed Google Ads fetches. Records each fetch for the admin. */
export async function conversionsFeed() {
    const rows = await conversions();
    try {
        await db.none('INSERT INTO ads_feed_fetches (conversions) VALUES ($1)', [rows.length]);
    } catch (err) {
        // The feed itself is fine; only the admin's "last fetched" is stale.
        logFault('ads_feed_fetch_record_failed', { error: err.message });
    }
    logEvent('ads_feed_served', { conversions: rows.length });
    return conversionsCsv(rows);
}

// ---------------------------------------------------------------------------
// Customer Match
// ---------------------------------------------------------------------------

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Google's normalisation: trimmed, lower case; Gmail addresses without dots before the @. */
export function normalizeEmail(email) {
    const e = String(email ?? '').trim().toLowerCase();
    const at = e.lastIndexOf('@');
    if (at < 1) return null;
    const [local, domain] = [e.slice(0, at), e.slice(at + 1)];
    return ['gmail.com', 'googlemail.com'].includes(domain) ? `${local.replace(/\./g, '')}@${domain}` : e;
}

/** E.164 with the plus, as Google requires before hashing. Leads store digits only. */
export const normalizePhone = (digits) => (/^[1-9][0-9]{9,14}$/.test(digits ?? '') ? `+${digits}` : null);

/**
 * Hashed rows for leads who agreed to Customer Match. A phone counts only if
 * its owner messaged us on WhatsApp within 14 days after the consent (and has
 * not sent STOP); an email only if it confirmed an alert in that window.
 * `interest` narrows to one audience.
 */
export async function customerMatchRows({ interest } = {}) {
    const leads = await db.any(
        `SELECT l.id,
                CASE WHEN EXISTS (
                         SELECT 1 FROM whatsapp_contacts w JOIN whatsapp_messages m ON m.contact_id = w.id
                          WHERE w.wa_id = l.phone AND w.opted_out_at IS NULL AND m.direction = 'inbound'
                            AND m.created_at >= l.ads_consented_at
                            AND m.created_at < l.ads_consented_at + make_interval(days => $2))
                     THEN l.phone END AS phone,
                CASE WHEN EXISTS (
                         SELECT 1 FROM product_alerts a
                          WHERE lower(a.email) = lower(l.email) AND a.confirmed_at >= l.ads_consented_at
                            AND a.confirmed_at < l.ads_consented_at + make_interval(days => $2))
                     THEN l.email END AS email
           FROM leads l
          WHERE l.ads_consented_at IS NOT NULL AND ($1::text IS NULL OR l.interest = $1)
          ORDER BY l.ads_consented_at, l.id`,
        [interest ?? null, PROOF_DAYS]
    );
    return leads
        .map((l) => ({
            email: l.email && normalizeEmail(l.email) ? sha256(normalizeEmail(l.email)) : '',
            phone: normalizePhone(l.phone) ? sha256(normalizePhone(l.phone)) : '',
        }))
        .filter((r) => r.email || r.phone);
}

export const customerMatchCsv = (rows) => ['Email,Phone', ...rows.map((r) => `${r.email},${r.phone}`)].join('\n') + '\n';

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** The Google Ads panel: is the feed on and fetched, what is in it, and who opted in. */
export async function adsStatus() {
    const config = adsConfig();
    const [feed, lastFetch, counts] = await Promise.all([
        conversions(),
        db.oneOrNone('SELECT fetched_at, conversions FROM ads_feed_fetches ORDER BY fetched_at DESC LIMIT 1'),
        db.one(
            `SELECT (SELECT count(*) FROM visitors WHERE gclid IS NOT NULL AND first_seen_at > now() - interval '30 days')::int AS ad_visitors,
                    (SELECT count(*) FROM visitors WHERE ads_consent_at IS NOT NULL AND first_seen_at > now() - interval '30 days')::int AS ad_consented,
                    (SELECT count(*) FROM leads WHERE ads_consented_at IS NOT NULL)::int AS match_consented`
        ),
    ]);
    const matchRows = await customerMatchRows();
    return {
        feedEnabled: config.feedSecret.length >= 24,
        leadConversion: config.leadConversion,
        purchaseConversion: config.purchaseConversion,
        feedDays: FEED_DAYS,
        lastFetch,
        feed: {
            leads: feed.filter((r) => r.name === config.leadConversion).length,
            purchases: feed.filter((r) => r.name === config.purchaseConversion).length,
            value: feed.reduce((sum, r) => sum + (r.value ?? 0), 0),
        },
        ...counts,
        matchRows: matchRows.length,
    };
}
