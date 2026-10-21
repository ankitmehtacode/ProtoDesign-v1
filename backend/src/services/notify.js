/**
 * Customer updates for an order or quote, on every channel the customer has
 * linked: WhatsApp (whatsapp.service.js) and Telegram (telegram.service.js).
 * Neither throws, so a channel's failure never affects the other or the caller.
 */
import * as telegram from './telegram.service.js';
import * as whatsapp from './whatsapp.service.js';

export async function notifyOrder(orderId, event) {
    await Promise.all([whatsapp.notifyOrder(orderId, event), telegram.notifyOrder(orderId, event)]);
}

export async function notifyQuote(quoteId, status) {
    await Promise.all([whatsapp.notifyQuote(quoteId, status), telegram.notifyQuote(quoteId, status)]);
}
