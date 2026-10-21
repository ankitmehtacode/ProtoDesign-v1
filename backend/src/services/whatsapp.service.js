import { createHmac, timingSafeEqual } from 'crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import db from '../config/database.js';

/**
 * WhatsApp Cloud API (Meta's official Graph API), called directly over HTTPS.
 *
 * Cost model this module is built around (docs/whatsapp-integration.md §14):
 * a message is free when the customer messaged us in the last 24 hours (the
 * "customer service window"). Outside it only a pre-approved template may be
 * sent, and Meta bills it. By default (WHATSAPP_PAID_TEMPLATES unset) nothing
 * is ever sent outside the window, so WhatsApp costs nothing; order and quote
 * emails still go out as before.
 *
 * Failure isolation: callers in the order/quote/payment paths only ever call
 * notifyOrder/notifyQuote, which insert a queued row and never throw. Sending
 * happens later in whatsapp.worker.js, in its own Lambda invocation.
 */

export const WORKER_EVENT_SOURCE = 'protodesign.whatsapp-worker';

const GRAPH_BASE = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v23.0';
const WINDOW_HOURS = 24;
const GRAPH_TIMEOUT_MS = 8000;

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Read at call time, not import time, so a config change never needs a code
 * path to be re-imported (and tests can set env per case).
 *
 * WHATSAPP_MODE:
 *   off  (default) -- routes answer "not enabled", nothing is queued or sent.
 *   mock -- everything runs except the HTTP call to Meta; sends are recorded
 *           with a fake id. For local development.
 *   live -- real Graph API calls. Outside NODE_ENV=production, messages go
 *           only to numbers in WHATSAPP_TEST_RECIPIENTS, so a laptop or a
 *           staging stack cannot message real customers by accident.
 */
export function getConfig() {
    const env = process.env;
    const rawMode = String(env.WHATSAPP_MODE || 'off').toLowerCase();
    const mode = ['off', 'mock', 'live'].includes(rawMode) ? rawMode : 'off';
    if (mode !== rawMode) logFault('whatsapp_misconfigured', { reason: 'unknown_mode', value: rawMode });

    const config = {
        mode,
        production: env.NODE_ENV === 'production',
        apiVersion: env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION,
        accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
        businessNumber: normalizeWaId(env.WHATSAPP_BUSINESS_NUMBER),
        verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
        appSecret: env.META_APP_SECRET || '',
        linkSecret: env.JWT_SECRET || '',
        paidTemplates: String(env.WHATSAPP_PAID_TEMPLATES).toLowerCase() === 'true',
        templates: {
            order: env.WHATSAPP_TEMPLATE_ORDER_UPDATE || '',
            quote: env.WHATSAPP_TEMPLATE_QUOTE_UPDATE || ''
        },
        templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
        testRecipients: new Set(String(env.WHATSAPP_TEST_RECIPIENTS || '')
            .split(',').map(normalizeWaId).filter(Boolean)),
        bodyRetentionDays: Math.max(1, Number(env.WHATSAPP_BODY_RETENTION_DAYS) || 90),
        frontendUrl: (env.FRONTEND_URL || '').replace(/\/+$/, '')
    };

    config.missing = mode === 'off' ? [] : [
        ['WHATSAPP_BUSINESS_NUMBER', config.businessNumber],
        ['WHATSAPP_VERIFY_TOKEN', config.verifyToken],
        ['META_APP_SECRET', config.appSecret],
        ['JWT_SECRET', config.linkSecret],
        ...(mode === 'live' ? [
            ['WHATSAPP_ACCESS_TOKEN', config.accessToken],
            ['WHATSAPP_PHONE_NUMBER_ID', config.phoneNumberId]
        ] : [])
    ].filter(([, value]) => !value).map(([name]) => name);

    config.enabled = mode !== 'off' && config.missing.length === 0;
    if (mode !== 'off' && config.missing.length) {
        // Names only; never values.
        logFault('whatsapp_misconfigured', { mode, missing: config.missing });
    }
    return config;
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * Normalises to WhatsApp's wa_id form: E.164 digits without '+'. Bare 10-digit
 * Indian mobiles (the checkout format) get the 91 prefix. Returns null for
 * anything that is not plausibly a phone number.
 */
export function normalizeWaId(input) {
    if (input === null || input === undefined) return null;
    const raw = String(input).trim();
    if (!raw || raw.length > 32 || /[^\d\s()+.-]/.test(raw)) return null;
    let digits = raw.replace(/\D/g, '');
    if (!raw.startsWith('+')) {
        if (/^[6-9]\d{9}$/.test(digits)) digits = `91${digits}`;
        else if (/^0[6-9]\d{9}$/.test(digits)) digits = `91${digits.slice(1)}`;
    }
    return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** For logs: enough to tell numbers apart, not enough to identify someone. */
export const maskWaId = (waId) => (waId ? `${String(waId).slice(0, 2)}******${String(waId).slice(-2)}` : null);

// ---------------------------------------------------------------------------
// Webhook authentication
// ---------------------------------------------------------------------------

const safeEqual = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
};

/** Meta's X-Hub-Signature-256: "sha256=" + hex HMAC-SHA256(app secret, raw body). */
export function verifySignature(rawBody, header, appSecret) {
    if (!appSecret || !Buffer.isBuffer(rawBody) || typeof header !== 'string' || !header.startsWith('sha256=')) {
        return false;
    }
    const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    return safeEqual(header.slice('sha256='.length), expected);
}

export const verifyToken = (given, expected) => Boolean(expected) && typeof given === 'string' && safeEqual(given, expected);

// ---------------------------------------------------------------------------
// Signed references ("send me updates for order X")
// ---------------------------------------------------------------------------
//
// The customer's first message carries a reference like O-1A2B3C4D-K7Q2M9XD:
// kind, the id's first 8 hex digits, and an HMAC over the full id. Only the
// logged-in owner is ever shown it (GET /api/whatsapp/link), so a stranger
// cannot subscribe to someone else's order by guessing an id prefix.

const KIND_PREFIX = { order: 'O', quote: 'Q' };
const PREFIX_KIND = { O: 'order', Q: 'quote' };
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const REF_PATTERN = /\b([OQ])-([0-9A-F]{8})-([A-Z2-7]{8})\b/i;

function signRef(kind, id, secret) {
    const mac = createHmac('sha256', secret).update(`whatsapp-link:${kind}:${String(id).toLowerCase()}`).digest();
    let out = '';
    for (let i = 0; i < 8; i++) out += BASE32[mac[i] % 32];
    return out;
}

export const shortId = (id) => String(id).slice(0, 8).toUpperCase();

export function makeRef(kind, id, secret) {
    return `${KIND_PREFIX[kind]}-${shortId(id)}-${signRef(kind, id, secret)}`;
}

/** @returns {{kind: string, prefix: string, sig: string} | null} */
export function parseRef(text) {
    const m = REF_PATTERN.exec(String(text || ''));
    return m ? { kind: PREFIX_KIND[m[1].toUpperCase()], prefix: m[2].toLowerCase(), sig: m[3].toUpperCase() } : null;
}

/** Resolves a parsed reference to the order/quote it was signed for, or null. */
export async function resolveRef(ref, secret) {
    const table = ref.kind === 'order' ? 'orders' : 'quotes';
    const candidates = await db.any(
        `SELECT id, user_id FROM ${table} WHERE id::text LIKE $1 LIMIT 20`,
        [`${ref.prefix}%`]
    );
    return candidates.find((row) => safeEqual(signRef(ref.kind, row.id, secret), ref.sig)) ?? null;
}

export function waMeUrl(businessNumber, text) {
    return `https://wa.me/${businessNumber}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

// ---------------------------------------------------------------------------
// Graph API
// ---------------------------------------------------------------------------

/** A Graph API failure, carrying only safe fields (never the token or headers). */
export class GraphError extends Error {
    constructor(message, { httpStatus = null, code = null, retryable = false } = {}) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
        this.retryable = retryable;
    }
}

// Throttling and transient codes worth retrying; everything else is final.
// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const RETRYABLE_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);
const AUTH_CODES = new Set([0, 190]);

async function graphFetch(config, path, init = {}, timeoutMs = GRAPH_TIMEOUT_MS) {
    let res;
    try {
        res = await fetch(`${GRAPH_BASE}/${config.apiVersion}/${path}`, {
            ...init,
            headers: { Authorization: `Bearer ${config.accessToken}`, ...(init.headers || {}) },
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (err) {
        throw new GraphError(`Graph request failed: ${err.name}`, { retryable: true });
    }
    if (res.ok) return res;

    const body = await res.json().catch(() => ({}));
    const code = body?.error?.code ?? null;
    const detail = body?.error?.error_data?.details || body?.error?.message || `HTTP ${res.status}`;
    if (AUTH_CODES.has(code) || res.status === 401) {
        // Loud on purpose: every message fails until the token is replaced.
        logFault('whatsapp_auth_failed', { httpStatus: res.status, code, action: 'REPLACE_WHATSAPP_ACCESS_TOKEN' });
    }
    throw new GraphError(String(detail).slice(0, 300), {
        httpStatus: res.status,
        code,
        retryable: res.status >= 500 || res.status === 429 || RETRYABLE_CODES.has(code) || AUTH_CODES.has(code)
    });
}

/** @returns {Promise<string>} the WhatsApp message id */
export async function sendToGraph(config, payload) {
    const res = await graphFetch(config, `${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload })
    });
    const data = await res.json();
    const id = data?.messages?.[0]?.id;
    if (!id) throw new GraphError('Graph response had no message id');
    return id;
}

/** Media metadata: { url, mime_type, file_size }. */
export async function getMediaInfo(config, mediaId) {
    const res = await graphFetch(config, encodeURIComponent(mediaId));
    return res.json();
}

/** Downloads media from the short-lived URL getMediaInfo returned. */
export async function downloadMedia(config, url, timeoutMs) {
    const parsed = new URL(url);
    // The token is attached to this request, so only ever send it to Meta.
    if (parsed.protocol !== 'https:' || !/(^|\.)(facebook\.com|fbsbx\.com|fbcdn\.net|whatsapp\.com|whatsapp\.net)$/.test(parsed.hostname)) {
        throw new GraphError('Unexpected media host');
    }
    let res;
    try {
        res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (err) {
        throw new GraphError(`Media download failed: ${err.name}`, { retryable: true });
    }
    if (!res.ok) throw new GraphError(`Media download HTTP ${res.status}`, { httpStatus: res.status, retryable: res.status >= 500 });
    return res;
}

// ---------------------------------------------------------------------------
// Queue (whatsapp_messages rows) and the worker trigger
// ---------------------------------------------------------------------------

export const windowOpen = (lastInboundAt, now = Date.now()) =>
    Boolean(lastInboundAt) && now - new Date(lastInboundAt).getTime() < WINDOW_HOURS * 3600 * 1000;

/**
 * Queues one outbound message. Marketing is refused here unless the contact
 * holds an active marketing consent; the worker checks again before sending.
 *
 * @returns {Promise<object|null>} the queued row, or null if refused.
 */
export async function enqueueMessage(t, {
    contactId, body, kind = 'reply', category = 'service',
    orderId = null, quoteId = null, templateParams = null
}) {
    if (category === 'marketing') {
        const consent = await t.oneOrNone(
            `SELECT 1 FROM whatsapp_consents c JOIN whatsapp_contacts k ON k.id = c.contact_id
              WHERE c.contact_id = $1 AND c.consent_type = 'marketing' AND c.revoked_at IS NULL
                AND k.opted_out_at IS NULL`,
            [contactId]
        );
        if (!consent) {
            logEvent('whatsapp_marketing_refused', { contactId, reason: 'no_marketing_consent' });
            return null;
        }
    }
    return t.one(
        `INSERT INTO whatsapp_messages
             (contact_id, direction, message_type, kind, category, body, order_id, quote_id, template_params, status)
         VALUES ($1, 'outbound', 'text', $2, $3, $4, $5, $6, $7, 'queued')
         RETURNING *`,
        [contactId, kind, category, String(body).slice(0, 4096), orderId, quoteId,
            templateParams ? JSON.stringify(templateParams) : null]
    );
}

let lambdaClient;

/**
 * Starts the worker without waiting for it. Under Lambda that is an async
 * self-invoke (InvocationType Event); the current request returns at once and
 * Lambda retries the invoke on failure. Locally it runs on the next tick.
 * A failed kick is logged and harmless: the rows stay queued and the next kick
 * (any webhook, any enqueue) picks them up.
 */
export const dispatch = {
    async kick(reason) {
        try {
            if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
                lambdaClient ??= new LambdaClient({});
                await lambdaClient.send(new InvokeCommand({
                    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
                    InvocationType: 'Event',
                    Payload: Buffer.from(JSON.stringify({ source: WORKER_EVENT_SOURCE, reason }))
                }));
            } else {
                const { runWorker } = await import('./whatsapp.worker.js');
                setImmediate(() => runWorker().catch((err) => logFault('whatsapp_worker_failed', { error: err.message })));
            }
        } catch (err) {
            logFault('whatsapp_kick_failed', { reason, error: err.message });
        }
    }
};

// ---------------------------------------------------------------------------
// Business events -> notifications. Never throw into the caller.
// ---------------------------------------------------------------------------

const ORDER_EVENTS = {
    paid: { label: 'Payment confirmed', text: (ref) => `Payment confirmed for your ProtoDesign order ${ref}. We'll keep you posted here as it moves.` },
    shipped: { label: 'Shipped', text: (ref, url) => `Your ProtoDesign order ${ref} has been shipped.${url ? ` Track it here: ${url}/orders` : ''}` },
    delivered: { label: 'Delivered', text: (ref) => `Your ProtoDesign order ${ref} has been delivered. Thank you for shopping with us!` },
    cancelled: { label: 'Cancelled', text: (ref) => `Your ProtoDesign order ${ref} has been cancelled. Reply here if you have any questions.` }
};

const QUOTE_EVENTS = {
    contacted: { label: 'In review', text: (ref) => `Your ProtoDesign quote ${ref} is being reviewed. Our team will be in touch with you shortly.` },
    paid: { label: 'Paid', text: (ref) => `Payment received for your ProtoDesign quote ${ref}. We'll start on it and keep you posted here.` },
    completed: { label: 'Completed', text: (ref) => `Your ProtoDesign quote ${ref} is complete. Thank you!` },
    rejected: { label: 'Not accepted', text: (ref) => `We're unable to take on your ProtoDesign quote ${ref} as submitted. Reply here and we'll help you find a way forward.` }
};

/** Human labels for status replies (STATUS command, link confirmation). */
export const ORDER_STATUS_LABELS = {
    pending: 'Awaiting payment', pending_payment: 'Awaiting payment', processing: 'Being prepared',
    shipped: 'Shipped', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled'
};
export const QUOTE_STATUS_LABELS = {
    pending: 'Received, awaiting review', contacted: 'In review', paid: 'Paid',
    completed: 'Completed', rejected: 'Not accepted'
};

async function notify({ column, id, event, catalogue, kind }) {
    const config = getConfig();
    if (!config.enabled) return 0;
    const spec = catalogue[event];
    if (!spec) return 0;
    try {
        const ref = `#${shortId(id)}`;
        const queued = await db.tx(async (t) => {
            const links = await t.any(`SELECT contact_id FROM whatsapp_links WHERE ${column} = $1`, [id]);
            for (const { contact_id } of links) {
                await enqueueMessage(t, {
                    contactId: contact_id,
                    body: spec.text(ref, config.frontendUrl),
                    kind: 'notification',
                    orderId: kind === 'order' ? id : null,
                    quoteId: kind === 'quote' ? id : null,
                    templateParams: { kind, values: [ref, spec.label] }
                });
            }
            return links.length;
        });
        if (queued) {
            logEvent('whatsapp_notification_queued', { [`${kind}Id`]: id, event, recipients: queued });
            await dispatch.kick(`${kind}_${event}`);
        }
        return queued;
    } catch (err) {
        // The order/quote/payment operation that called us has already
        // succeeded; a WhatsApp problem must not undo or fail it.
        logFault('whatsapp_enqueue_failed', { [`${kind}Id`]: id, event, error: err.message });
        return 0;
    }
}

export const notifyOrder = (orderId, event) =>
    notify({ column: 'order_id', id: orderId, event, catalogue: ORDER_EVENTS, kind: 'order' });

export const notifyQuote = (quoteId, status) =>
    notify({ column: 'quote_id', id: quoteId, event: status, catalogue: QUOTE_EVENTS, kind: 'quote' });
