/**
 * Shop alerts over a Telegram bot: new paid and cash-on-delivery orders,
 * failed payments, unpaid checkouts cancelled to free stock, new quotes,
 * refunds needed, sign-ins and new accounts, and WhatsApp alerts, sent to the chats in
 * TELEGRAM_ADMIN_CHAT_IDS. Customers are not served here; their updates go
 * out on WhatsApp and email.
 *
 * Sends happen inline: Telegram answers in well under a second, so there is no
 * queue. Each send is one attempt capped at SEND_TIMEOUT_MS, because these run
 * inside checkout, payment settlement and quote requests, which share a 20 s
 * Lambda timeout; a slow Telegram must not use it up. Every function here logs
 * and swallows its own failures, because the order, payment or quote that
 * triggered it has already succeeded.
 * See docs/telegram-updates.md.
 */
import { timingSafeEqual } from 'node:crypto';
import db from '../config/database.js';
import { shortId } from './whatsapp.service.js';

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

const SEND_TIMEOUT_MS = 2000;
const MAX_TEXT = 4096; // Telegram's limit for one message

// Replaceable by tests only, so no test talks to Telegram.
export const transport = { fetch: (...args) => globalThis.fetch(...args) };

export function getConfig(env = process.env) {
    const token = env.TELEGRAM_BOT_TOKEN || '';
    const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET || '';
    return {
        enabled: Boolean(token && webhookSecret),
        token,
        webhookSecret,
        adminChatIds: String(env.TELEGRAM_ADMIN_CHAT_IDS || '').split(',').map((s) => s.trim()).filter((s) => /^-?\d{1,16}$/.test(s)),
        frontendUrl: String(env.FRONTEND_URL || '').replace(/\/$/, ''),
    };
}

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
    // Never log the description verbatim: it can echo the request URL, which holds the token.
    // 403 means an admin chat blocked the bot: alerts to it stop until it is unblocked.
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

// Name and email are typed by the customer: flattened to one line so they
// cannot draw a fake alert of their own below this one.
const oneLine = (value, max) => String(value).replace(/\s+/g, ' ').trim().slice(0, max);

/** The shop's alert for a sign-in, or a new account (isNew). Never throws. */
export async function alertSignIn({ name, email, method, isNew = false, role = 'user' }) {
    const who = `${oneLine(name || 'Customer', 100)} (${oneLine(email, 254)})${role === 'admin' ? ' · ADMIN' : ''}`;
    await notifyAdmin(isNew ? `🆕 New account via ${method}: ${who}` : `👤 Signed in via ${method}: ${who}`);
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

/** The shop's alert for a new lead (a repeat enquiry from a known lead is not alerted). */
export async function alertNewLead(lead, productName) {
    await notifyAdmin([
        `🧲 New ${lead.interest} lead: ${lead.name || 'No name given'}`,
        productName ? `Interested in: ${productName}` : null,
        lead.phone ? `Phone: +${lead.phone}` : null,
        lead.email ? `Email: ${lead.email}` : null,
        lead.source ? `Came from: ${lead.source} / ${lead.medium}` : null,
        lead.message ? `“${lead.message.slice(0, 200)}”` : null,
    ].filter(Boolean).join('\n') + adminLink('leads'));
}

// ---------------------------------------------------------------------------
// Bot webhook
// ---------------------------------------------------------------------------

/**
 * Handles one Telegram update. The bot only talks to admin chats; anyone else
 * gets one line with their chat id, which is how a new team member's chat is
 * added to TELEGRAM_ADMIN_CHAT_IDS. Nothing from other chats reaches the shop.
 * Only private chats are served; groups and channels are ignored.
 */
export async function handleUpdate(config, update) {
    const message = update?.message;
    const chat = message?.chat;
    if (!chat || chat.type !== 'private' || !Number.isSafeInteger(chat.id)) return;
    const isAdmin = config.adminChatIds.includes(String(chat.id));
    logEvent('telegram_update', { chat: maskChat(chat.id), admin: isAdmin });
    await sendMessage(config, chat.id, isAdmin
        ? `ProtoDesign shop alerts are on for this chat (${chat.id}).`
        : `This bot sends ProtoDesign shop alerts to the team only. For updates on your order, use WhatsApp or email.\n\nChat ID: ${chat.id}`);
}
