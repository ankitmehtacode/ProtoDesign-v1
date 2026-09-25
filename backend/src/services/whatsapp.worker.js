import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import path from 'path';
import db from '../config/database.js';
import { emailService } from './email.service.js';
import { isModelFilename, storageService } from './storage.service.js';
import {
    GraphError,
    ORDER_STATUS_LABELS,
    QUOTE_STATUS_LABELS,
    dispatch,
    downloadMedia,
    enqueueMessage,
    getConfig,
    getMediaInfo,
    maskWaId,
    normalizeWaId,
    parseRef,
    resolveRef,
    sendToGraph,
    shortId,
    windowOpen
} from './whatsapp.service.js';

/**
 * Processes stored webhook events and sends queued messages. Runs in its own
 * Lambda invocation (see dispatch.kick), never inside a customer's request.
 *
 * Every step is idempotent and claims work with a lease, so duplicate
 * deliveries, concurrent workers and a worker killed mid-run are all safe:
 *   - whatsapp_events.event_key and whatsapp_messages.wa_message_id are unique;
 *   - an event is claimed by setting claimed_at; a claim older than
 *     LEASE_MINUTES is considered abandoned and re-claimed;
 *   - an outbound message moves queued -> sending (claimed) -> sent/failed/skipped.
 */

const MAX_ATTEMPTS = 5;
const LEASE_MINUTES = 2;
// Chat intake is for convenience; big files belong on the website uploader
// (200MB). This keeps download + S3 upload well inside the Lambda timeout.
const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 12_000;
// Stop claiming new work when less than this remains in the invocation.
const RESERVE_MS = 13_000;
const PROCESSED_EVENT_RETENTION_DAYS = 30;

const STOP_WORDS = new Set(['STOP', 'STOP ALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPT OUT', 'OPTOUT']);
const START_WORDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE']);
const STATUS_WORDS = new Set(['STATUS', 'TRACK', 'ORDER STATUS']);

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

/** An input problem retrying cannot fix: record it and move on. */
class PermanentError extends Error {}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

let localRunInFlight = false;

/**
 * @param {object} [opts]
 * @param {() => number} [opts.remainingMs] Lambda's context.getRemainingTimeInMillis
 * @returns {Promise<{events: number, sent: number, more: boolean}>}
 */
export async function runWorker({ remainingMs = () => Infinity } = {}) {
    // Locally, overlapping kicks share one run; under Lambda each invocation is
    // its own process and the leases keep concurrent runs apart.
    if (localRunInFlight) return { events: 0, sent: 0, more: false };
    localRunInFlight = true;
    try {
        const config = getConfig();
        const stats = { events: 0, sent: 0, more: false };
        const hasTime = () => remainingMs() > RESERVE_MS;

        while (hasTime()) {
            const event = await claimNextEvent();
            if (!event) break;
            await processEvent(config, event);
            stats.events++;
        }
        while (hasTime()) {
            const message = await claimNextMessage();
            if (!message) break;
            if (await sendMessage(config, message)) stats.sent++;
        }
        stats.more = !hasTime() && await hasPendingWork();
        await housekeeping(config);

        // Ran out of time with work left: hand over to a fresh invocation.
        if (stats.more) await dispatch.kick('continuation');
        if (stats.events || stats.sent) logEvent('whatsapp_worker_run', stats);
        return stats;
    } finally {
        localRunInFlight = false;
    }
}

async function hasPendingWork() {
    const row = await db.one(
        `SELECT EXISTS (SELECT 1 FROM whatsapp_events WHERE processed_at IS NULL AND attempts < $1)
             OR EXISTS (SELECT 1 FROM whatsapp_messages WHERE status = 'queued') AS pending`,
        [MAX_ATTEMPTS]
    );
    return row.pending;
}

async function housekeeping(config) {
    // Data minimisation: message text is kept only as long as support needs it.
    await db.none(
        `UPDATE whatsapp_messages SET body = NULL
          WHERE body IS NOT NULL AND created_at < NOW() - make_interval(days => $1)`,
        [config.bodyRetentionDays]
    );
    await db.none(
        `DELETE FROM whatsapp_events
          WHERE processed_at IS NOT NULL AND processed_at < NOW() - make_interval(days => $1)`,
        [PROCESSED_EVENT_RETENTION_DAYS]
    );
}

// ---------------------------------------------------------------------------
// Inbound events
// ---------------------------------------------------------------------------

async function claimNextEvent() {
    return db.oneOrNone(
        `UPDATE whatsapp_events SET claimed_at = NOW(), attempts = attempts + 1
          WHERE id = (
                SELECT id FROM whatsapp_events
                 WHERE processed_at IS NULL AND attempts < $1
                   AND (claimed_at IS NULL OR claimed_at < NOW() - make_interval(mins => $2))
                 ORDER BY received_at
                 LIMIT 1
                   FOR UPDATE SKIP LOCKED)
      RETURNING *`,
        [MAX_ATTEMPTS, LEASE_MINUTES]
    );
}

async function processEvent(config, event) {
    try {
        if (event.event_type === 'status') await applyStatus(event.payload.status);
        else await handleInbound(config, event.payload);
        await db.none(
            `UPDATE whatsapp_events SET processed_at = NOW(), payload = NULL, last_error = NULL, claimed_at = NULL WHERE id = $1`,
            [event.id]
        );
    } catch (err) {
        const permanent = err instanceof PermanentError || event.attempts >= MAX_ATTEMPTS;
        logFault(permanent ? 'whatsapp_event_dropped' : 'whatsapp_event_failed', {
            eventKey: event.event_key, attempt: event.attempts, error: err.message
        });
        await db.none(
            `UPDATE whatsapp_events
                -- Keeping claimed_at set holds the lease, so a retryable failure
                -- is retried after LEASE_MINUTES, not immediately in this run.
                SET last_error = $2, claimed_at = NOW(),
                    processed_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
                    payload = CASE WHEN $3 THEN NULL ELSE payload END
              WHERE id = $1`,
            [event.id, String(err.message).slice(0, 500), permanent]
        );
    }
}

// Status ranks: a status only ever moves forward (a late 'sent' must not
// overwrite 'read'). 'failed' wins over anything but 'read'.
const STATUS_RANK = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4 };

async function applyStatus(status) {
    const next = status?.status;
    if (!['sent', 'delivered', 'read', 'failed'].includes(next)) {
        throw new PermanentError(`Unhandled status '${String(next).slice(0, 20)}'`);
    }
    const error = next === 'failed' ? status.errors?.[0] : null;
    const billable = typeof status.pricing?.billable === 'boolean' ? status.pricing.billable : null;

    const updated = await db.oneOrNone(
        `UPDATE whatsapp_messages
            SET status = CASE
                    WHEN $2 = 'failed' AND status <> 'read' THEN 'failed'
                    WHEN $2 <> 'failed' AND status NOT IN ('failed', 'skipped')
                         AND COALESCE(($4::jsonb ->> status)::int, 0) < ($4::jsonb ->> $2)::int THEN $2
                    ELSE status END,
                error_code = COALESCE($3, error_code),
                error_message = COALESCE($5, error_message),
                billable = COALESCE($6, billable)
          WHERE wa_message_id = $1
      RETURNING id, order_id, quote_id, status`,
        [status.id, next, error?.code != null ? String(error.code) : null, JSON.stringify(STATUS_RANK),
            error ? String(error.error_data?.details || error.title || error.message || '').slice(0, 300) : null, billable]
    );
    if (!updated) {
        // Sent outside this system (e.g. from Meta's own tools), or already purged.
        logEvent('whatsapp_status_unknown_message', { waMessageId: status.id, status: next });
        return;
    }
    const log = next === 'failed' ? logFault : logEvent;
    log('whatsapp_message_status', {
        waMessageId: status.id, status: updated.status, orderId: updated.order_id, quoteId: updated.quote_id,
        errorCode: error?.code ?? null
    });
}

/** Text of an inbound message, whatever the message type carries. */
function inboundText(message) {
    switch (message.type) {
        case 'text': return message.text?.body ?? '';
        case 'button': return message.button?.text ?? '';
        case 'interactive': return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? '';
        case 'document': return message.document?.caption ?? '';
        default: return '';
    }
}

async function handleInbound(config, { message, contact: profile }) {
    const waId = normalizeWaId(message?.from);
    if (!waId || typeof message.id !== 'string') throw new PermanentError('Malformed inbound message');

    const sentAt = Math.min(Number(message.timestamp) * 1000 || Date.now(), Date.now());
    const text = String(inboundText(message)).slice(0, 4096);

    const outcome = await db.tx(async (t) => {
        const before = await t.oneOrNone('SELECT * FROM whatsapp_contacts WHERE wa_id = $1 FOR UPDATE', [waId]);
        const contact = await t.one(
            `INSERT INTO whatsapp_contacts (wa_id, profile_name, last_inbound_at)
             VALUES ($1, $2, to_timestamp($3 / 1000.0))
             ON CONFLICT (wa_id) DO UPDATE
                SET profile_name = COALESCE(EXCLUDED.profile_name, whatsapp_contacts.profile_name),
                    last_inbound_at = GREATEST(whatsapp_contacts.last_inbound_at, EXCLUDED.last_inbound_at)
             RETURNING *`,
            [waId, profile?.profile?.name ? String(profile.profile.name).slice(0, 255) : null, sentAt]
        );
        const inserted = await t.oneOrNone(
            `INSERT INTO whatsapp_messages (contact_id, wa_message_id, direction, message_type, body, status, created_at)
             VALUES ($1, $2, 'inbound', $3, $4, 'received', to_timestamp($5 / 1000.0))
             ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
            [contact.id, message.id, String(message.type || 'unknown').slice(0, 20), text || null, sentAt]
        );
        return { contact, isNew: Boolean(inserted), windowWasOpen: windowOpen(before?.last_inbound_at, sentAt) };
    });

    if (!outcome.isNew) return; // same message delivered twice under different event keys
    const { contact, windowWasOpen } = outcome;
    logEvent('whatsapp_inbound', { contactId: contact.id, waId: maskWaId(waId), type: message.type, waMessageId: message.id });

    if (message.type === 'document') return handleDocument(config, contact, message);

    const command = text.trim().toUpperCase().replace(/\s+/g, ' ');
    if (STOP_WORDS.has(command)) return optOut(contact);
    if (START_WORDS.has(command)) return optIn(contact);
    if (STATUS_WORDS.has(command)) return replyWithStatus(contact);

    const ref = parseRef(text);
    if (ref) return linkReference(config, contact, ref);

    if (['image', 'video', 'audio', 'sticker'].includes(message.type)) {
        return reply(contact, 'Thanks! To get a 3D printing quote, please send your model as a document (STL, OBJ, 3MF or STEP), or upload it on our website.');
    }

    // A new conversation: acknowledge once, and tell the shop. Further
    // messages in the same window get no automatic reply.
    if (!windowWasOpen) {
        await reply(contact, 'Thanks for messaging ProtoDesign! Our team will reply here shortly. '
            + 'Send STATUS for updates on orders you have linked, or send your STL/OBJ file as a document for a printing quote.');
        await alertAdmin(`New WhatsApp conversation: ${contact.profile_name || '+' + contact.wa_id}`,
            `From: ${contact.profile_name || 'Unknown'} (+${contact.wa_id})\n\n${text.slice(0, 500) || `[${message.type}]`}\n\nReply from the Admin Dashboard (WhatsApp panel) within 24 hours.`);
    }
}

async function reply(contact, body) {
    await enqueueMessage(db, { contactId: contact.id, body, kind: 'reply' });
}

async function alertAdmin(subject, text) {
    try {
        await emailService.sendAdminAlert(subject, text);
    } catch (err) {
        logFault('email_failed', { type: 'whatsapp_admin_alert', error: err.message });
    }
}

const SERVICE_CONSENT_TEXT = 'Customer messaged ProtoDesign on WhatsApp to receive updates about {what}. '
    + 'ProtoDesign sends order and quote updates only; reply STOP to opt out.';

async function grantServiceConsent(t, contactId, source, what) {
    await t.none(
        `INSERT INTO whatsapp_consents (contact_id, consent_type, source, consent_text)
         VALUES ($1, 'service', $2, $3)
         ON CONFLICT (contact_id, consent_type) WHERE revoked_at IS NULL DO NOTHING`,
        [contactId, source, SERVICE_CONSENT_TEXT.replace('{what}', what)]
    );
    await t.none('UPDATE whatsapp_contacts SET opted_out_at = NULL WHERE id = $1', [contactId]);
}

async function optOut(contact) {
    await db.tx(async (t) => {
        await t.none('UPDATE whatsapp_contacts SET opted_out_at = NOW() WHERE id = $1', [contact.id]);
        // Consents are revoked, not deleted, and message history is kept:
        // transactional records stay intact.
        await t.none('UPDATE whatsapp_consents SET revoked_at = NOW() WHERE contact_id = $1 AND revoked_at IS NULL', [contact.id]);
        // Anything already queued for this contact is not sent.
        await t.none(
            `UPDATE whatsapp_messages SET status = 'skipped', error_code = 'opted_out'
              WHERE contact_id = $1 AND status = 'queued' AND kind = 'notification'`,
            [contact.id]
        );
    });
    logEvent('whatsapp_opt_out', { contactId: contact.id });
    await reply(contact, "You've been unsubscribed and won't receive further updates from ProtoDesign on WhatsApp. "
        + 'Reply START at any time to turn them back on. (To cancel an order, use the Orders page on our website.)');
}

async function optIn(contact) {
    await db.tx((t) => grantServiceConsent(t, contact.id, 'start_keyword', 'orders and quotes linked to this number'));
    logEvent('whatsapp_opt_in', { contactId: contact.id });
    await reply(contact, "You're subscribed again. We'll send order and quote updates here. Reply STOP at any time to opt out.");
}

async function linkReference(config, contact, ref) {
    const target = await resolveRef(ref, config.linkSecret);
    if (!target) {
        logEvent('whatsapp_link_rejected', { contactId: contact.id, kind: ref.kind });
        return reply(contact, "Sorry, we couldn't match that reference. Please use the WhatsApp button on your Orders page to try again.");
    }
    const label = `${ref.kind} #${shortId(target.id)}`;
    await db.tx(async (t) => {
        await t.none(
            `INSERT INTO whatsapp_links (contact_id, ${ref.kind}_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [contact.id, target.id]
        );
        await grantServiceConsent(t, contact.id, 'website_link', label);
        if (target.user_id) {
            await t.none('UPDATE whatsapp_contacts SET user_id = COALESCE(user_id, $2) WHERE id = $1', [contact.id, target.user_id]);
        }
    });
    logEvent('whatsapp_linked', { contactId: contact.id, [`${ref.kind}Id`]: target.id });

    const current = await describe(ref.kind, target.id);
    await reply(contact, `You're all set! We'll send updates for ${label} here. Current status: ${current}. `
        + 'Send STATUS any time for the latest, or STOP to opt out.');
}

async function describe(kind, id) {
    const row = await db.oneOrNone(`SELECT status FROM ${kind === 'order' ? 'orders' : 'quotes'} WHERE id = $1`, [id]);
    const labels = kind === 'order' ? ORDER_STATUS_LABELS : QUOTE_STATUS_LABELS;
    return labels[row?.status] || row?.status || 'unknown';
}

async function replyWithStatus(contact) {
    const links = await db.any(
        `SELECT l.order_id, l.quote_id, o.status AS order_status, q.status AS quote_status
           FROM whatsapp_links l
           LEFT JOIN orders o ON o.id = l.order_id
           LEFT JOIN quotes q ON q.id = l.quote_id
          WHERE l.contact_id = $1
          ORDER BY l.created_at DESC LIMIT 10`,
        [contact.id]
    );
    if (links.length === 0) {
        return reply(contact, 'No orders or quotes are linked to this number yet. Use the WhatsApp button on your Orders page on our website to link one.');
    }
    const lines = links.map((l) => (l.order_id
        ? `Order #${shortId(l.order_id)}: ${ORDER_STATUS_LABELS[l.order_status] || l.order_status}`
        : `Quote #${shortId(l.quote_id)}: ${QUOTE_STATUS_LABELS[l.quote_status] || l.quote_status}`));
    await reply(contact, `Your ProtoDesign updates:\n${lines.join('\n')}`);
}

// A model file sent in chat becomes a quote, stored exactly like a web upload.
async function handleDocument(config, contact, message) {
    const doc = message.document || {};
    const filename = path.basename(String(doc.filename || '')).slice(0, 200);
    const websiteHint = config.frontendUrl ? ` You can also upload it at ${config.frontendUrl}/custom.` : '';

    if (!isModelFilename(filename)) {
        return reply(contact, `Thanks! We can quote STL, OBJ, 3MF and STEP files. Please send one of those as a document.${websiteHint}`);
    }
    if (config.mode !== 'live') {
        logEvent('whatsapp_document_skipped', { contactId: contact.id, reason: `mode_${config.mode}` });
        return reply(contact, `Thanks! File intake over WhatsApp is not available right now.${websiteHint}`);
    }

    try {
        return await intakeDocument(config, contact, doc, filename, websiteHint);
    } catch (err) {
        if (!(err instanceof GraphError) || err.retryable) throw err; // retried via the event lease
        logFault('whatsapp_document_failed', { contactId: contact.id, errorCode: err.code ?? err.httpStatus ?? null, error: err.message });
        return reply(contact, `Sorry, we couldn't download that file.${websiteHint || ' Please upload it on our website.'}`);
    }
}

async function intakeDocument(config, contact, doc, filename, websiteHint) {
    const info = await getMediaInfo(config, doc.id);
    const size = Number(info.file_size);
    if (!Number.isInteger(size) || size <= 0) throw new GraphError('Media has no size');
    if (size > MAX_CHAT_FILE_BYTES) {
        return reply(contact, `That file is ${(size / 1024 / 1024).toFixed(1)} MB, which is too large for WhatsApp intake (limit ${MAX_CHAT_FILE_BYTES / 1024 / 1024} MB).${websiteHint || ' Please upload it on our website.'}`);
    }

    const media = await downloadMedia(config, info.url, MEDIA_TIMEOUT_MS);
    const key = await storageService.storeModel({
        ownerKey: `whatsapp/${contact.id}`,
        filename,
        body: Readable.fromWeb(media.body),
        contentLength: size
    });

    const quote = await db.tx(async (t) => {
        const q = await t.one(
            `INSERT INTO quotes (user_id, email, phone, file_url, file_name, specifications, admin_notes, status, source)
             VALUES ($1, NULL, $2, $3, $4, $5, $6, 'pending', 'whatsapp') RETURNING id`,
            [contact.user_id, `+${contact.wa_id}`, key, filename,
                JSON.stringify({ source: 'whatsapp', fileSize: size }),
                doc.caption ? String(doc.caption).slice(0, 1000) : null]
        );
        await t.none('INSERT INTO whatsapp_links (contact_id, quote_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [contact.id, q.id]);
        await grantServiceConsent(t, contact.id, 'whatsapp_file', `quote #${shortId(q.id)}`);
        return q;
    });
    logEvent('whatsapp_quote_created', { contactId: contact.id, quoteId: quote.id, bytes: size });

    await reply(contact, `Thanks! We've received ${filename} as quote #${shortId(quote.id)}. `
        + "Our team will review it and reply here with pricing. Tell us the material, colour and quantity you'd like.");
    await alertAdmin(`New WhatsApp quote #${shortId(quote.id)}: ${filename}`,
        `From: ${contact.profile_name || 'Unknown'} (+${contact.wa_id})\nFile: ${filename} (${(size / 1024 / 1024).toFixed(2)} MB)\n`
        + `Notes: ${doc.caption || 'none'}\n\nOpen the Admin Dashboard to download the model and reply.`);
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

async function claimNextMessage() {
    return db.oneOrNone(
        `UPDATE whatsapp_messages SET status = 'sending', attempts = attempts + 1
          WHERE id = (
                SELECT id FROM whatsapp_messages
                 WHERE direction = 'outbound'
                   -- A retried message waits one minute per attempt so far.
                   AND ((status = 'queued' AND (attempts = 0 OR updated_at < NOW() - make_interval(mins => attempts)))
                        OR (status = 'sending' AND updated_at < NOW() - make_interval(mins => $1)))
                 ORDER BY created_at
                 LIMIT 1
                   FOR UPDATE SKIP LOCKED)
      RETURNING *`,
        [LEASE_MINUTES]
    );
}

async function finish(message, status, fields = {}) {
    await db.none(
        `UPDATE whatsapp_messages
            SET status = $2, wa_message_id = COALESCE($3, wa_message_id), template_name = COALESCE($4, template_name),
                billable = COALESCE($5, billable), error_code = $6, error_message = $7
          WHERE id = $1`,
        [message.id, status, fields.waMessageId ?? null, fields.templateName ?? null, fields.billable ?? null,
            fields.errorCode ?? null, fields.errorMessage ?? null]
    );
    const log = status === 'failed' ? logFault : logEvent;
    log('whatsapp_outbound', {
        messageId: message.id, status, waMessageId: fields.waMessageId ?? null, kind: message.kind,
        orderId: message.order_id, quoteId: message.quote_id, errorCode: fields.errorCode ?? null
    });
}

/**
 * Decides whether and how a queued message may go out, then sends it.
 * @returns {Promise<boolean>} true when handed to WhatsApp.
 */
async function sendMessage(config, message) {
    const contact = await db.one('SELECT * FROM whatsapp_contacts WHERE id = $1', [message.contact_id]);
    const skip = (code, detail) => finish(message, 'skipped', { errorCode: code, errorMessage: detail }).then(() => false);

    if (!config.enabled) return skip('disabled', `WhatsApp mode is ${config.mode}`);

    if (message.category === 'marketing') {
        const consent = await db.oneOrNone(
            `SELECT 1 FROM whatsapp_consents WHERE contact_id = $1 AND consent_type = 'marketing' AND revoked_at IS NULL`,
            [contact.id]
        );
        if (!consent || contact.opted_out_at) return skip('no_marketing_consent');
    }

    if (message.kind === 'notification') {
        if (contact.opted_out_at) return skip('opted_out');
        const consent = await db.oneOrNone(
            `SELECT 1 FROM whatsapp_consents WHERE contact_id = $1 AND consent_type = 'service' AND revoked_at IS NULL`,
            [contact.id]
        );
        if (!consent) return skip('no_service_consent');
    }

    // Environment guard: only production may message arbitrary numbers.
    if (config.mode === 'live' && !config.production && !config.testRecipients.has(contact.wa_id)) {
        return skip('non_production_recipient', 'Not in WHATSAPP_TEST_RECIPIENTS');
    }

    // Free inside the customer service window; a billed template outside it,
    // and only if the operator has opted in to paying.
    let payload;
    let billable = false;
    let templateName = null;
    if (windowOpen(contact.last_inbound_at)) {
        payload = { to: contact.wa_id, type: 'text', text: { body: message.body, preview_url: false } };
    } else if (message.kind === 'notification' && config.paidTemplates && config.templates[message.template_params?.kind]) {
        templateName = config.templates[message.template_params.kind];
        billable = true;
        payload = {
            to: contact.wa_id,
            type: 'template',
            template: {
                name: templateName,
                language: { code: config.templateLanguage },
                components: [{
                    type: 'body',
                    parameters: message.template_params.values.map((v) => ({ type: 'text', text: String(v) }))
                }]
            }
        };
    } else {
        return skip('window_closed', config.paidTemplates ? 'No template configured' : 'Free-only mode (WHATSAPP_PAID_TEMPLATES=false)');
    }

    if (config.mode === 'mock') {
        logEvent('whatsapp_mock_send', { messageId: message.id, to: maskWaId(contact.wa_id), type: payload.type });
        await finish(message, 'sent', { waMessageId: `mock.${randomUUID()}`, templateName, billable });
        return true;
    }

    try {
        const waMessageId = await sendToGraph(config, payload);
        await finish(message, 'sent', { waMessageId, templateName, billable });
        return true;
    } catch (err) {
        const code = err.code != null ? String(err.code) : (err.httpStatus ? `http_${err.httpStatus}` : 'network');
        // 131047: more than 24h since the customer's last message (a race with
        // the window check above). Nothing more to do for free.
        if (err.code === 131047) return skip('window_closed', err.message);
        if (err.retryable && message.attempts < MAX_ATTEMPTS) {
            await db.none(
                `UPDATE whatsapp_messages SET status = 'queued', error_code = $2, error_message = $3 WHERE id = $1`,
                [message.id, code, err.message]
            );
            logFault('whatsapp_send_retry', { messageId: message.id, attempt: message.attempts, errorCode: code });
            return false;
        }
        await finish(message, 'failed', { errorCode: code, errorMessage: err.message });
        return false;
    }
}
