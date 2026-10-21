import { randomBytes } from 'crypto';
import db from '../config/database.js';
import { emailService } from './email.service.js';
import { festivalPrice } from './festival.js';
import { CONSENT_TEXTS, InputError, captureLead, isUuid } from './leads.service.js';

/**
 * "Email me when it is back in stock / cheaper" (docs/lead-tracking.md).
 *
 * Email, not WhatsApp: these fire days later, outside WhatsApp's free 24-hour
 * window, where every message would be a billed marketing template.
 *
 * Double opt-in. A sign-up only sends a confirmation; the alert and the lead
 * exist once the address's owner clicks it. So a typed address cannot be
 * signed up for mail, or made into a lead, by someone else.
 *
 * Gmail allows about 500 messages a day and order email needs them too, so
 * confirmations and alerts share one daily budget (ALERT_EMAILS_DAILY). An
 * hourly EventBridge run (ALERTS_EVENT_SOURCE) sends what has come true.
 */

export const ALERTS_EVENT_SOURCE = 'protodesign.product-alerts';

const KINDS = new Set(['back_in_stock', 'price_drop']);
const ALERTS_PER_IP_DAILY = 10;
const MAX_ATTEMPTS = 3;
const LEASE_MINUTES = 15;
// Stop starting sends with less than this left of the Lambda's 20 s.
const RESERVE_MS = 5_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INTEREST = { '3d_printer': 'printer', filament: 'filament', resin: 'resin' };

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

/** Read at call time so tests and config changes need no re-import. */
export function getLimits(env = process.env) {
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
    return {
        emailsDaily: num(env.ALERT_EMAILS_DAILY, 150),
        signupsDaily: num(env.ALERT_SIGNUPS_DAILY, 300),
    };
}

const siteUrl = () => (process.env.FRONTEND_URL || 'https://www.protodesignstudio.com').replace(/\/+$/, '');
const productLink = (p) => `${siteUrl()}/product/${encodeURIComponent(p.slug || p.id)}`;

function alertLink(action, token) {
    const base = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
    // Broken confirm/unsubscribe links must be loud: every email depends on them.
    if (!base) logFault('alerts_misconfigured', { missing: 'BACKEND_URL' });
    return `${base}/api/alerts/${action}/${token}`;
}

/** Alert email sent in the last 24 hours: confirmations plus alerts. */
async function emailsSentToday(t = db) {
    const { n } = await t.one(
        `SELECT (SELECT count(*) FROM product_alerts WHERE confirmation_sent_at > now() - interval '1 day')
              + (SELECT count(*) FROM product_alerts WHERE notified_at > now() - interval '1 day') AS n`);
    return Number(n);
}

export function validateAlert(body = {}) {
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 254);
    if (!EMAIL_RE.test(email)) throw new InputError('Enter a valid email address');
    if (!isUuid(body.productId)) throw new InputError('Unknown product');
    if (!KINDS.has(body.kind)) throw new InputError('Unknown alert');
    if (body.consent !== true || body.consentVersion !== 'product-alert-v1') throw new InputError('Consent is required');
    return { email, productId: body.productId, kind: body.kind, visitorId: isUuid(body.visitorId) ? body.visitorId : null };
}

/**
 * Records a sign-up and emails the confirmation. Returns 'created', 'exists'
 * (an open one already covers it: nothing is sent again), or null when a
 * daily cap is reached (logged).
 */
export async function subscribe(input, { ipHash = null } = {}) {
    const product = await db.oneOrNone(
        `SELECT id, name, slug, price, compare_at_price, category, stock FROM products
          WHERE id = $1 AND (is_archived = false OR is_archived IS NULL)`, [input.productId]);
    if (!product) throw new InputError('Unknown product');
    const shown = festivalPrice(product);
    const inStock = Number(product.stock) > 0;
    // Only the alert that can still happen.
    if (input.kind === 'back_in_stock' && inStock) throw new InputError('This product is in stock');
    if (input.kind === 'price_drop' && !inStock) throw new InputError('This product is out of stock');

    const limits = getLimits();
    const counts = await db.one(
        `SELECT (SELECT count(*) FROM product_alerts WHERE created_at > now() - interval '1 day')::int AS total,
                (SELECT count(*) FROM product_alerts WHERE $1::text IS NOT NULL AND ip_hash = $1
                                                       AND created_at > now() - interval '1 day')::int AS from_ip`,
        [ipHash]);
    if (counts.from_ip >= ALERTS_PER_IP_DAILY || counts.total >= limits.signupsDaily) {
        logFault('alert_signup_cap_reached', { perIp: counts.from_ip >= ALERTS_PER_IP_DAILY });
        return null;
    }
    if (await emailsSentToday() >= limits.emailsDaily) {
        logFault('alert_email_budget_reached', { budget: limits.emailsDaily });
        return null;
    }

    const token = randomBytes(24).toString('base64url');
    const visitor = input.visitorId ? await db.oneOrNone('SELECT id FROM visitors WHERE id = $1', [input.visitorId]) : null;
    const row = await db.oneOrNone(
        `INSERT INTO product_alerts (product_id, email, kind, baseline_price, token, visitor_id, consent_text, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (product_id, lower(email), kind)
            WHERE notified_at IS NULL AND unsubscribed_at IS NULL AND failed_at IS NULL DO NOTHING
         RETURNING id`,
        [product.id, input.email, input.kind, shown.price, token, visitor?.id ?? null, CONSENT_TEXTS['product-alert-v1'], ipHash]
    );
    if (!row) return 'exists';
    if (visitor) {
        await db.none(`INSERT INTO visitor_events (visitor_id, name, product_id) VALUES ($1, 'alert_signup', $2)`,
            [visitor.id, product.id]);
    }

    try {
        await emailService.sendAlertConfirmation(input.email, {
            productName: product.name, kind: input.kind, price: shown.price, productUrl: productLink(product),
            confirmUrl: alertLink('confirm', token), unsubscribeUrl: alertLink('unsubscribe', token),
        });
        await db.none('UPDATE product_alerts SET confirmation_sent_at = now() WHERE id = $1', [row.id]);
    } catch (err) {
        // Unconfirmed, it never sends anything; it is pruned after a week.
        logFault('email_failed', { type: 'alert_confirmation', alertId: row.id, error: err.message });
    }
    logEvent('product_alert_created', { alertId: row.id, kind: input.kind, productId: product.id });
    return 'created';
}

const validToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(token);

/**
 * The owner clicked the link in the confirmation: the alert goes live and the
 * person becomes a lead, with an address now known to be theirs. Idempotent.
 */
export async function confirm(token) {
    if (!validToken(token)) return false;
    const alert = await db.oneOrNone(
        `UPDATE product_alerts SET confirmed_at = COALESCE(confirmed_at, now())
          WHERE token = $1 AND unsubscribed_at IS NULL RETURNING *`, [token]);
    if (!alert) return false;
    if (alert.lead_id) return true; // confirmed before

    const product = await db.oneOrNone('SELECT id, name, category FROM products WHERE id = $1', [alert.product_id]);
    const captured = await captureLead({
        name: null, phone: null, email: alert.email,
        interest: INTEREST[product?.category] ?? 'other',
        form: alert.kind === 'back_in_stock' ? 'stock_alert' : 'price_alert',
        message: `${alert.kind === 'back_in_stock' ? 'Waiting for' : 'Watching the price of'} ${product?.name ?? 'a product'}`,
        productId: alert.product_id, visitorId: alert.visitor_id,
        consentText: alert.consent_text,
    }, {});
    if (captured) await db.none('UPDATE product_alerts SET lead_id = $2 WHERE id = $1', [alert.id, captured.lead.id]);
    logEvent('product_alert_confirmed', { alertId: alert.id });
    return true;
}

export async function unsubscribe(token) {
    if (!validToken(token)) return false;
    const res = await db.result(
        'UPDATE product_alerts SET unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE token = $1', [token]);
    return res.rowCount > 0;
}

/** Whether an alert has come true for the product as customers now see it. */
export function alertDue(alert, product) {
    if (product.is_archived || !(Number(product.stock) > 0)) return null;
    const now = Number(festivalPrice(product).price);
    if (alert.kind === 'back_in_stock') return { price: now };
    return now < Number(alert.baseline_price) - 0.5 ? { price: now, was: Number(alert.baseline_price) } : null;
}

/**
 * Sends the confirmed alerts that have come true, within the daily email
 * budget and the invocation's time. Each is leased (claimed_at) for the send;
 * success sets notified_at, failure counts an attempt and frees the lease, and
 * a lease left by a killed run goes stale and is taken over. After
 * MAX_ATTEMPTS failures the alert is given up, so bad addresses cannot block
 * the rest.
 */
export async function runProductAlerts({ remainingMs = () => Infinity } = {}) {
    // Every open, confirmed alert on a product that is in stock: both kinds
    // need stock, and the price test needs the festival rules, so it runs here.
    const candidates = await db.any(
        `SELECT a.id, a.email, a.kind, a.baseline_price, a.token,
                p.id AS product_id, p.name, p.slug, p.price, p.compare_at_price, p.category, p.stock, p.is_archived
           FROM product_alerts a JOIN products p ON p.id = a.product_id
          WHERE a.confirmed_at IS NOT NULL AND a.notified_at IS NULL AND a.unsubscribed_at IS NULL AND a.failed_at IS NULL
            AND p.stock > 0 AND (p.is_archived = false OR p.is_archived IS NULL)
            AND (a.claimed_at IS NULL OR a.claimed_at < now() - make_interval(mins => $1))
          ORDER BY a.created_at`,
        [LEASE_MINUTES]
    );
    const stats = { candidates: candidates.length, sent: 0, failed: 0, deferred: 0 };
    let budget = getLimits().emailsDaily - await emailsSentToday();

    for (const a of candidates) {
        const product = { id: a.product_id, name: a.name, slug: a.slug, price: a.price, compare_at_price: a.compare_at_price,
            category: a.category, stock: a.stock, is_archived: a.is_archived };
        const due = alertDue(a, product);
        if (!due) continue;
        if (budget <= 0 || remainingMs() < RESERVE_MS) { stats.deferred++; continue; }

        const claimed = await db.oneOrNone(
            `UPDATE product_alerts SET claimed_at = now()
              WHERE id = $1 AND notified_at IS NULL AND unsubscribed_at IS NULL AND failed_at IS NULL
                AND (claimed_at IS NULL OR claimed_at < now() - make_interval(mins => $2))
          RETURNING id`, [a.id, LEASE_MINUTES]);
        if (!claimed) continue;
        try {
            await emailService.sendProductAlert(a.email, {
                productName: a.name, kind: a.kind, price: due.price, was: due.was ?? null,
                productUrl: productLink(product), unsubscribeUrl: alertLink('unsubscribe', a.token),
            });
            await db.none('UPDATE product_alerts SET notified_at = now(), claimed_at = NULL WHERE id = $1', [a.id]);
            stats.sent++;
            budget--;
        } catch (err) {
            await db.none(
                `UPDATE product_alerts SET claimed_at = NULL, attempts = attempts + 1,
                        failed_at = CASE WHEN attempts + 1 >= $2 THEN now() END
                  WHERE id = $1`, [a.id, MAX_ATTEMPTS]);
            logFault('email_failed', { type: 'product_alert', alertId: a.id, error: err.message });
            stats.failed++;
        }
    }
    if (stats.sent || stats.failed || stats.deferred) logEvent('product_alerts_run', stats);
    if (stats.deferred) logFault('product_alerts_deferred', { deferred: stats.deferred, budgetLeft: budget });
    return stats;
}
