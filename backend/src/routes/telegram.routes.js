import express from 'express';
import db from '../config/database.js';
import authMiddleware from '../middleware/auth.js';
import { isUuid } from '../services/order.service.js';
import { botUrl, getConfig, handleUpdate, startUrl, verifyWebhookSecret } from '../services/telegram.service.js';

const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

// ===========================================================================
// Bot webhook: mounted at /api/webhooks/telegram
// ===========================================================================
export const webhookRouter = express.Router();

/**
 * Telegram posts each update here, with the secret given to setWebhook in
 * X-Telegram-Bot-Api-Secret-Token. A failure to handle one is logged and still
 * answered 200: Telegram would otherwise redeliver it, and replay a reply.
 */
webhookRouter.post('/', async (req, res) => {
    const config = getConfig();
    if (!config.enabled) return res.sendStatus(404);
    if (!verifyWebhookSecret(req.get('x-telegram-bot-api-secret-token'), config.webhookSecret)) {
        logFault('telegram_webhook_rejected');
        return res.sendStatus(401);
    }
    try {
        await handleUpdate(config, req.body);
    } catch (err) {
        logFault('telegram_update_failed', { updateId: Number(req.body?.update_id) || null, error: err.message });
    }
    res.sendStatus(200);
});

// ===========================================================================
// App routes: mounted at /api/telegram
// ===========================================================================
const router = express.Router();

/** Whether Telegram is switched on, for the storefront's buttons. */
router.get('/status', (req, res) => {
    const config = getConfig();
    res.json(config.enabled ? { enabled: true, botUrl: botUrl(config) } : { enabled: false });
});

/** The signed link that subscribes the customer's chat to one of their orders or quotes. */
router.get('/link', authMiddleware, async (req, res, next) => {
    try {
        const config = getConfig();
        if (!config.enabled) return res.status(404).json({ error: 'Telegram updates are not available' });

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

        res.json({ url: startUrl(config, kind, id) });
    } catch (error) {
        next(error);
    }
});

export default router;
