import express from 'express';
import db from '../config/database.js';
import authMiddleware from '../middleware/auth.js';
import isAdmin from '../middleware/isAdmin.js';
import { isUuid } from '../services/order.service.js';
import {
    dispatch,
    enqueueMessage,
    getConfig,
    makeRef,
    maskWaId,
    shortId,
    verifySignature,
    verifyToken,
    waMeUrl,
    windowOpen
} from '../services/whatsapp.service.js';

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

// ===========================================================================
// Meta webhook: mounted at /api/webhooks/whatsapp
// ===========================================================================
export const webhookRouter = express.Router();

/** Subscription handshake Meta performs when the callback URL is saved. */
webhookRouter.get('/', (req, res) => {
    const config = getConfig();
    if (!config.enabled) return res.sendStatus(404);

    if (req.query['hub.mode'] === 'subscribe' && verifyToken(req.query['hub.verify_token'], config.verifyToken)) {
        logEvent('whatsapp_webhook_verified');
        // Echo only a plain token back, as text: never reflect arbitrary markup.
        const challenge = String(req.query['hub.challenge'] ?? '');
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return res.sendStatus(400);
        return res.type('text/plain').send(challenge);
    }
    logFault('whatsapp_webhook_verify_rejected', { mode: String(req.query['hub.mode'] ?? '').slice(0, 20) });
    res.sendStatus(403);
});

const MAX_ID_LENGTH = 128;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;

/**
 * Splits one webhook delivery into events, one per message or status. Anything
 * not addressed to our phone number, or not shaped as documented, is dropped.
 */
function extractEvents(body, phoneNumberId, mode) {
    const events = [];
    if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return events;

    for (const entry of body.entry.slice(0, 50)) {
        for (const change of Array.isArray(entry?.changes) ? entry.changes.slice(0, 50) : []) {
            const value = change?.value;
            if (change?.field !== 'messages' || !value) continue;
            // In mock mode there is no real number to compare against.
            if (mode === 'live' && value.metadata?.phone_number_id !== phoneNumberId) {
                logFault('whatsapp_webhook_foreign_number', { phoneNumberId: String(value.metadata?.phone_number_id ?? '').slice(0, 30) });
                continue;
            }
            for (const message of Array.isArray(value.messages) ? value.messages.slice(0, 100) : []) {
                if (!isId(message?.id) || typeof message.from !== 'string') continue;
                const contact = (value.contacts || []).find((c) => c?.wa_id === message.from);
                events.push({
                    key: `message:${message.id}`,
                    type: 'message',
                    payload: { message, contact: contact ? { profile: { name: contact.profile?.name } } : null }
                });
            }
            for (const status of Array.isArray(value.statuses) ? value.statuses.slice(0, 100) : []) {
                if (!isId(status?.id) || typeof status.status !== 'string') continue;
                events.push({
                    key: `status:${status.id}:${status.status.slice(0, 20)}`,
                    type: 'status',
                    // Only what applyStatus reads; the recipient's number is not kept.
                    payload: { status: { id: status.id, status: status.status, errors: status.errors, pricing: status.pricing } }
                });
            }
        }
    }
    return events;
}

/**
 * Event delivery. Authenticity is proven by the X-Hub-Signature-256 HMAC over
 * the exact bytes received. The events are stored (deduplicated by key) and
 * processed by the worker in a separate invocation, so this returns quickly.
 * Storage failing is the one case that answers 5xx, so Meta retries.
 */
webhookRouter.post('/', async (req, res) => {
    const config = getConfig();
    if (!config.enabled) return res.sendStatus(404);

    if (!verifySignature(req.rawBody, req.headers['x-hub-signature-256'], config.appSecret)) {
        logFault('whatsapp_webhook_rejected', { reason: req.headers['x-hub-signature-256'] ? 'bad_signature' : 'missing_signature' });
        return res.sendStatus(401);
    }

    const events = extractEvents(req.body, config.phoneNumberId, config.mode);
    let stored = 0;
    try {
        for (const event of events) {
            const row = await db.oneOrNone(
                `INSERT INTO whatsapp_events (event_key, event_type, payload) VALUES ($1, $2, $3)
                 ON CONFLICT (event_key) DO NOTHING RETURNING id`,
                [event.key.slice(0, 200), event.type, JSON.stringify(event.payload)]
            );
            if (row) stored++;
        }
    } catch (err) {
        logFault('whatsapp_webhook_store_failed', { error: err.message });
        return res.sendStatus(500);
    }

    logEvent('whatsapp_webhook_received', { events: events.length, stored, duplicates: events.length - stored });
    if (stored) await dispatch.kick('webhook');
    res.sendStatus(200);
});

// ===========================================================================
// App API: mounted at /api/whatsapp
// ===========================================================================
const router = express.Router();

/** Public: whether to show WhatsApp buttons, and the general chat link. */
router.get('/status', (req, res) => {
    const config = getConfig();
    if (!config.enabled) return res.json({ enabled: false });
    res.json({ enabled: true, chatUrl: waMeUrl(config.businessNumber, 'Hi ProtoDesign!') });
});

/**
 * A wa.me link whose pre-filled text carries a signed reference to one of the
 * caller's own orders or quotes. Sending it is the customer's opt-in.
 */
router.get('/link', authMiddleware, async (req, res, next) => {
    try {
        const config = getConfig();
        if (!config.enabled) return res.status(404).json({ error: 'WhatsApp updates are not available' });

        const { kind, id } = req.query;
        if (!['order', 'quote'].includes(kind) || !isUuid(id)) {
            return res.status(400).json({ error: 'kind must be order or quote, with a valid id' });
        }
        const owned = await db.oneOrNone(
            `SELECT id FROM ${kind === 'order' ? 'orders' : 'quotes'} WHERE id = $1 AND user_id = $2`,
            [id, req.userId]
        );
        // Same answer for "not yours" and "does not exist".
        if (!owned) return res.status(404).json({ error: `${kind === 'order' ? 'Order' : 'Quote'} not found` });

        const text = `Hi ProtoDesign! Please send me WhatsApp updates for my ${kind} #${shortId(id)} `
            + `(ref ${makeRef(kind, id, config.linkSecret)}).`;
        res.json({ url: waMeUrl(config.businessNumber, text) });
    } catch (error) {
        next(error);
    }
});

// ---- Admin -----------------------------------------------------------------

router.get('/admin/overview', authMiddleware, isAdmin, async (req, res, next) => {
    try {
        const config = getConfig();
        const [stats, conversations, failed] = await Promise.all([
            db.one(`
                SELECT (SELECT count(*)::int FROM whatsapp_contacts) AS contacts,
                       (SELECT count(*)::int FROM whatsapp_contacts WHERE opted_out_at IS NOT NULL) AS opted_out,
                       (SELECT count(*)::int FROM whatsapp_messages
                         WHERE billable AND created_at > NOW() - INTERVAL '30 days') AS billable_30d,
                       (SELECT count(*)::int FROM whatsapp_messages
                         WHERE status = 'failed' AND created_at > NOW() - INTERVAL '7 days') AS failed_7d,
                       (SELECT count(*)::int FROM whatsapp_messages
                         WHERE status = 'skipped' AND error_code = 'window_closed'
                           AND created_at > NOW() - INTERVAL '30 days') AS skipped_window_30d`),
            db.any(`
                SELECT c.id, c.wa_id, c.profile_name, c.last_inbound_at, c.opted_out_at,
                       m.direction AS last_direction, m.body AS last_body, m.message_type AS last_type,
                       m.status AS last_status, m.created_at AS last_at,
                       (SELECT json_agg(json_build_object('order_id', l.order_id, 'quote_id', l.quote_id))
                          FROM whatsapp_links l WHERE l.contact_id = c.id) AS links
                  FROM whatsapp_contacts c
                  JOIN LATERAL (SELECT * FROM whatsapp_messages WHERE contact_id = c.id
                                 ORDER BY created_at DESC LIMIT 1) m ON true
                 ORDER BY m.created_at DESC
                 LIMIT 25`),
            db.any(`
                SELECT m.id, m.contact_id, c.wa_id, m.order_id, m.quote_id, m.error_code, m.error_message, m.created_at
                  FROM whatsapp_messages m JOIN whatsapp_contacts c ON c.id = m.contact_id
                 WHERE m.status = 'failed'
                 ORDER BY m.created_at DESC
                 LIMIT 10`)
        ]);

        res.json({
            config: {
                mode: config.mode,
                enabled: config.enabled,
                missing: config.missing,
                paidTemplates: config.paidTemplates,
                businessNumber: config.businessNumber
            },
            stats,
            conversations: conversations.map((c) => ({ ...c, window_open: windowOpen(c.last_inbound_at) })),
            failed
        });
    } catch (error) {
        next(error);
    }
});

router.get('/admin/contacts/:id/messages', authMiddleware, isAdmin, async (req, res, next) => {
    try {
        if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Contact not found' });
        const contact = await db.oneOrNone('SELECT * FROM whatsapp_contacts WHERE id = $1', [req.params.id]);
        if (!contact) return res.status(404).json({ error: 'Contact not found' });
        const messages = await db.any(
            `SELECT * FROM (
                 SELECT id, direction, message_type, kind, body, status, error_code, error_message,
                        billable, order_id, quote_id, created_at
                   FROM whatsapp_messages WHERE contact_id = $1
                  ORDER BY created_at DESC LIMIT 50) recent
              ORDER BY created_at ASC`,
            [contact.id]
        );
        res.json({ contact: { ...contact, window_open: windowOpen(contact.last_inbound_at) }, messages });
    } catch (error) {
        next(error);
    }
});

/**
 * Support reply from the dashboard. Only inside the free 24-hour window: a
 * free-form message outside it is not permitted by WhatsApp at all.
 */
router.post('/admin/contacts/:id/reply', authMiddleware, isAdmin, async (req, res, next) => {
    try {
        const config = getConfig();
        if (!config.enabled) return res.status(409).json({ error: 'WhatsApp is not enabled' });
        if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Contact not found' });

        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!text || text.length > 4096) return res.status(400).json({ error: 'Reply must be 1 to 4096 characters' });

        const contact = await db.oneOrNone('SELECT id, wa_id, last_inbound_at FROM whatsapp_contacts WHERE id = $1', [req.params.id]);
        if (!contact) return res.status(404).json({ error: 'Contact not found' });
        if (!windowOpen(contact.last_inbound_at)) {
            return res.status(409).json({ error: "More than 24 hours since the customer's last message. Reply by email or phone instead." });
        }

        const message = await enqueueMessage(db, { contactId: contact.id, body: text, kind: 'reply' });
        logEvent('whatsapp_admin_reply_queued', { contactId: contact.id, messageId: message.id, adminId: req.userId, to: maskWaId(contact.wa_id) });
        await dispatch.kick('admin_reply');
        res.status(202).json({ message });
    } catch (error) {
        next(error);
    }
});

export default router;
