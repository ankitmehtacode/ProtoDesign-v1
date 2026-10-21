import express from 'express';
import { getConfig, handleUpdate, verifyWebhookSecret } from '../services/telegram.service.js';

const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

/**
 * Bot webhook, mounted at /api/webhooks/telegram. Telegram posts each update
 * here, with the secret given to setWebhook in X-Telegram-Bot-Api-Secret-Token.
 * A failure to handle one is logged and still answered 200: Telegram would
 * otherwise redeliver it, and repeat the reply.
 */
const router = express.Router();

router.post('/', async (req, res) => {
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

export default router;
