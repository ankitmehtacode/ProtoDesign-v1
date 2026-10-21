/**
 * Order and quote updates over a Telegram bot, for customers and for the shop.
 *
 * Telegram has no message charge and no 24-hour window: once a chat has
 * started the bot, the bot may message it at any time. A customer starts it
 * from the signed link on their order or quote (GET /api/telegram/link), which
 * subscribes that chat to that order. The shop's own chats are listed in
 * TELEGRAM_ADMIN_CHAT_IDS and get an alert for every new paid order, failed
 * payment, quote request and customer message.
 *
 * Sends happen inline: Telegram answers in well under a second, so there is no
 * queue. Each send is one attempt capped at SEND_TIMEOUT_MS, because these run
 * inside checkout, payment settlement and status changes, which share a 20 s
 * Lambda timeout; a slow Telegram must not use it up. Every function here logs
 * and swallows its own failures, because the order, payment or quote that
 * triggered it has already succeeded.
 * See docs/telegram-updates.md.
 */
import { timingSafeEqual } from 'node:crypto';
import db from '../config/database.js';
import {
    ORDER_EVENTS, ORDER_STATUS_LABELS, QUOTE_EVENTS, QUOTE_STATUS_LABELS, makeRef, parseRef, resolveRef, shortId
} from './whatsapp.service.js';

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

const SEND_TIMEOUT_MS = 2000;
const FORWARD_COOLDOWN_SECONDS = 5; // per chat, so one chat cannot flood the admin chats
const MAX_TEXT = 4096; // Telegram's limit for one message

// Replaceable by tests only, so no test talks to Telegram.
export const transport = { fetch: (...args) => globalThis.fetch(...args) };

export function getConfig(env = process.env) {
    const token = env.TELEGRAM_BOT_TOKEN || '';
    const username = String(env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
    const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET || '';
    const linkSecret = env.JWT_SECRET || '';
    return {
        enabled: Boolean(token && username && webhookSecret && linkSecret),
        token,
        username,
        webhookSecret,
        linkSecret,
        adminChatIds: String(env.TELEGRAM_ADMIN_CHAT_IDS || '').split(',').map((s) => s.trim()).filter((s) => /^-?\d{1,16}$/.test(s)),
        frontendUrl: String(env.FRONTEND_URL || '').replace(/\/$/, ''),
    };
}

export const botUrl = (config) => `https://t.me/${config.username}`;

/** The link a customer opens to follow one order or quote. Telegram allows [A-Za-z0-9_-] here. */
export const startUrl = (config, kind, id) => `${botUrl(config)}?start=${makeRef(kind, id, config.linkSecret)}`;

/** Telegram's X-Telegram-Bot-Api-Secret-Token, compared in constant time. */
export function verifyWebhookSecret(given, expected) {
    if (!expected || typeof given !== 'string') return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

// Chat ids are not secret, but there is no reason to log them whole.
const maskChat = (chatId) => `…${String(chatId).slice(-4)}`;

/**
 * Sends one plain-text message, in one attempt (see SEND_TIMEOUT_MS above).
 * A chat that blocked the bot is stopped so it is not tried again.
 * @returns {Promise<boolean>} whether Telegram accepted it
 */
export async function sendMessage(config, chatId, text) {
    let res;
    let data;
    try {
        res = await transport.fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, MAX_TEXT), disable_web_page_preview: true }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        data = await res.json().catch(() => ({}));
    } catch (err) {
        logFault('telegram_send_failed', { chat: maskChat(chatId), error: err.name });
        return false;
    }
    if (data.ok) return true;
    if (res.status === 403) {
        logEvent('telegram_chat_blocked', { chat: maskChat(chatId) });
        try {
            await db.none('UPDATE telegram_chats SET stopped_at = now() WHERE chat_id = $1 AND stopped_at IS NULL', [chatId]);
        } catch (err) {
            logFault('telegram_stop_failed', { chat: maskChat(chatId), error: err.message });
        }
        return false;
    }
    // Never log the description verbatim: it can echo the request URL, which holds the token.
    logFault('telegram_send_failed', { chat: maskChat(chatId), status: res.status, code: data.error_code ?? null });
    return false;
}

/** An alert to every admin chat. Never throws. */
export async function notifyAdmin(text) {
    const config = getConfig();
    if (!config.enabled || config.adminChatIds.length === 0) return;
    try {
        await Promise.all(config.adminChatIds.map((id) => sendMessage(config, id, text)));
    } catch (err) {
        logFault('telegram_admin_alert_failed', { error: err.message });
    }
}

async function notifyFollowers({ column, id, spec }) {
    const config = getConfig();
    if (!config.enabled || !spec) return 0;
    try {
        const chats = await db.any(
            `SELECT l.chat_id FROM telegram_links l JOIN telegram_chats c USING (chat_id)
              WHERE l.${column} = $1 AND c.stopped_at IS NULL`,
            [id]
        );
        const text = spec.text(`#${shortId(id)}`, config.frontendUrl).replace('Reply here', 'Message us here');
        const sent = await Promise.all(chats.map(({ chat_id }) => sendMessage(config, chat_id, text)));
        return sent.filter(Boolean).length;
    } catch (err) {
        logFault('telegram_notify_failed', { [column]: id, error: err.message });
        return 0;
    }
}

/** Tells every chat following this order. Events are those in ORDER_EVENTS; others are ignored. */
export const notifyOrder = (orderId, event) => notifyFollowers({ column: 'order_id', id: orderId, spec: ORDER_EVENTS[event] });

/** Tells every chat following this quote. */
export const notifyQuote = (quoteId, status) => notifyFollowers({ column: 'quote_id', id: quoteId, spec: QUOTE_EVENTS[status] });

const inr = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Order, items and buyer for an admin alert. */
async function orderSummary(orderId) {
    const order = await db.oneOrNone(
        `SELECT o.id, o.total_amount, o.shipping_address, u.full_name, u.email
           FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
        [orderId]
    );
    if (!order) return null;
    const items = await db.any(
        `SELECT COALESCE(p.name, 'Product') AS name, oi.quantity
           FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1`,
        [orderId]
    );
    const address = typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address) : (order.shipping_address || {});
    const name = address.fullName || order.full_name || 'Customer';
    const place = [address.city, address.state, address.pincode].filter(Boolean).join(', ');
    return [
        `${name} · ${inr(order.total_amount)}`,
        ...items.map((i) => `• ${i.quantity} × ${i.name}`),
        address.phone ? `Phone: ${address.phone}` : null,
        order.email ? `Email: ${order.email}` : null,
        place ? `Ship to: ${place}` : null,
    ].filter(Boolean).join('\n');
}

// Skips the order lookup when no alert could be sent anyway.
const adminAlertsOn = () => {
    const config = getConfig();
    return config.enabled && config.adminChatIds.length > 0;
};

const adminLink = (tab) => {
    const url = getConfig().frontendUrl;
    return url ? `\n\n${url}/admin?tab=${tab}` : '';
};

/**
 * The shop's alert for a new order to fulfil: paid online, or cash on delivery
 * (cod), which never goes through payment settlement. Never throws.
 */
export async function alertNewOrder(orderId, { cod = false } = {}) {
    if (!adminAlertsOn()) return;
    try {
        const summary = await orderSummary(orderId);
        const title = cod ? 'New cash-on-delivery order' : 'New paid order';
        if (summary) await notifyAdmin(`🛒 ${title} #${shortId(orderId)}\n${summary}${adminLink('orders')}`);
    } catch (err) {
        logFault('telegram_admin_alert_failed', { orderId, error: err.message });
    }
}

/** The shop's alert for a failed payment, so the customer can be followed up. Never throws. */
export async function alertPaymentFailed(orderId) {
    if (!adminAlertsOn()) return;
    try {
        const summary = await orderSummary(orderId);
        if (summary) await notifyAdmin(`⚠️ Payment failed for order #${shortId(orderId)}\n${summary}${adminLink('orders')}`);
    } catch (err) {
        logFault('telegram_admin_alert_failed', { orderId, error: err.message });
    }
}

/** One alert for abandoned checkouts cancelled together to free their stock. */
export async function alertStaleHoldsReleased(orderIds) {
    if (orderIds.length === 0) return;
    await notifyAdmin(`♻️ Cancelled ${orderIds.length} unpaid checkout${orderIds.length === 1 ? '' : 's'} to free stock: `
        + orderIds.map((id) => `#${shortId(id)}`).join(', ') + adminLink('orders'));
}

/** The shop's alert for a new quote request. */
export async function alertNewQuote({ quoteId, fileName, price, contact }) {
    await notifyAdmin([
        `🧊 New quote #${shortId(quoteId)}: ${fileName}`,
        `${contact.name || 'Customer'} · ${inr(price)}`,
        contact.phone ? `Phone: ${contact.phone}` : null,
        contact.email ? `Email: ${contact.email}` : null,
    ].filter(Boolean).join('\n') + adminLink('quotes'));
}

// ---------------------------------------------------------------------------
// Bot webhook: commands from a private chat
// ---------------------------------------------------------------------------

const HELP = 'Send /status to see your orders and quotes, or /stop to turn updates off.';

async function statusLines(chatId) {
    const rows = await db.any(
        `SELECT 'order' AS kind, o.id, o.status FROM telegram_links l JOIN orders o ON o.id = l.order_id WHERE l.chat_id = $1
         UNION ALL
         SELECT 'quote', q.id, q.status FROM telegram_links l JOIN quotes q ON q.id = l.quote_id WHERE l.chat_id = $1
         ORDER BY 1, 2 LIMIT 20`,
        [chatId]
    );
    return rows.map((r) => {
        const label = (r.kind === 'order' ? ORDER_STATUS_LABELS : QUOTE_STATUS_LABELS)[r.status] || r.status;
        return `${r.kind === 'order' ? 'Order' : 'Quote'} #${shortId(r.id)}: ${label}`;
    });
}

async function follow(config, chatId, payload) {
    const ref = parseRef(payload);
    const row = ref && await resolveRef(ref, config.linkSecret);
    if (!row) return 'That link did not work. Open your order on protodesignstudio.com and tap "Get updates on Telegram" again.';

    const column = ref.kind === 'order' ? 'order_id' : 'quote_id';
    await db.none(
        `INSERT INTO telegram_links (chat_id, ${column}) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [chatId, row.id]
    );
    const { status } = await db.one(`SELECT status FROM ${ref.kind === 'order' ? 'orders' : 'quotes'} WHERE id = $1`, [row.id]);
    const label = (ref.kind === 'order' ? ORDER_STATUS_LABELS : QUOTE_STATUS_LABELS)[status] || status;
    logEvent('telegram_linked', { chat: maskChat(chatId), kind: ref.kind, id: row.id });
    return `You'll get updates for your ProtoDesign ${ref.kind} #${shortId(row.id)} here.\nCurrent status: ${label}\n\n${HELP}`;
}

/**
 * Handles one Telegram update and returns nothing; replies are sent from here.
 * Only private chats are served; groups and channels are ignored.
 */
export async function handleUpdate(config, update) {
    const message = update?.message;
    const chat = message?.chat;
    if (!chat || chat.type !== 'private' || !Number.isSafeInteger(chat.id)) return;
    const chatId = chat.id;
    const text = typeof message.text === 'string' ? message.text.trim().slice(0, 1000) : '';
    const firstName = String(message.from?.first_name || '').slice(0, 100);
    const isAdmin = config.adminChatIds.includes(String(chatId));

    await db.none(
        `INSERT INTO telegram_chats (chat_id, first_name) VALUES ($1, $2)
         ON CONFLICT (chat_id) DO UPDATE SET first_name = EXCLUDED.first_name`,
        [chatId, firstName]
    );

    const [command, ...rest] = text.split(/\s+/);
    const cmd = command?.toLowerCase().replace(/@.*$/, '') ?? '';

    if (cmd === '/start') {
        await db.none('UPDATE telegram_chats SET stopped_at = NULL WHERE chat_id = $1', [chatId]);
        if (rest[0]) return void await sendMessage(config, chatId, await follow(config, chatId, rest[0]));
        // The chat id is shown so the shop can add its own chats to TELEGRAM_ADMIN_CHAT_IDS.
        return void await sendMessage(config, chatId, isAdmin
            ? `Admin alerts are on for this chat (${chatId}).`
            : `Welcome to ProtoDesign! To follow an order, open it on protodesignstudio.com and tap "Get updates on Telegram".\n\n${HELP}\n\nChat ID: ${chatId}`);
    }
    if (cmd === '/stop') {
        await db.none('UPDATE telegram_chats SET stopped_at = now() WHERE chat_id = $1', [chatId]);
        return void await sendMessage(config, chatId, 'Updates are off. Send /start to turn them back on.');
    }
    if (cmd === '/status') {
        const lines = await statusLines(chatId);
        return void await sendMessage(config, chatId, lines.length
            ? lines.join('\n')
            : 'You are not following any orders yet. Open your order on protodesignstudio.com and tap "Get updates on Telegram".');
    }
    if (isAdmin) {
        // "/reply <chat id> <message>" answers a customer from the admin chat.
        const target = rest[0];
        const answer = text.slice(text.indexOf(target ?? '') + String(target ?? '').length).trim();
        if (cmd !== '/reply' || !/^\d{1,16}$/.test(target ?? '') || !Number.isSafeInteger(Number(target)) || !answer) {
            return void await sendMessage(config, chatId, 'To answer a customer: /reply <chat id> <your message>');
        }
        const known = await db.oneOrNone('SELECT stopped_at FROM telegram_chats WHERE chat_id = $1', [target]);
        if (!known || known.stopped_at) return void await sendMessage(config, chatId, `Chat ${target} is not following the bot, so it cannot be messaged.`);
        const ok = await sendMessage(config, target, `ProtoDesign: ${answer}`);
        return void await sendMessage(config, chatId, ok ? `Sent to ${target}.` : `Could not send to ${target}.`);
    }
    if (!text) return;

    // Anything else is a message for the team, at most one per chat per cooldown.
    const fresh = await db.oneOrNone(
        `UPDATE telegram_chats SET last_forwarded_at = now()
          WHERE chat_id = $1 AND (last_forwarded_at IS NULL OR last_forwarded_at < now() - make_interval(secs => $2))
          RETURNING chat_id`,
        [chatId, FORWARD_COOLDOWN_SECONDS]
    );
    if (!fresh) return void await sendMessage(config, chatId, 'Please wait a few seconds, then send that again.');
    const following = await statusLines(chatId);
    await notifyAdmin(`💬 Telegram message from ${firstName || 'a customer'}${following.length ? ` (${following.join('; ')})` : ''}:\n\n${text}\n\nAnswer with: /reply ${chatId} <your message>`);
    await sendMessage(config, chatId, 'Thanks! We have passed your message to the ProtoDesign team, and they will get back to you soon.');
}
