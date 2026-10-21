import express from 'express';
import db from '../config/database.js';
import authMiddleware from '../middleware/auth.js';
import optionalAuthMiddleware from '../middleware/optionalAuth.js';
import isAdmin from '../middleware/isAdmin.js';
import { alertNewLead } from '../services/telegram.service.js';
import {
    adminLeadDetail, adminOverview, captureLead, deleteLead, forgetVisitor, identifyVisitor, ipHash, parseBeacon,
    recordEvents, updateLead, validateLead,
} from '../services/leads.service.js';
import { SEARCH_PERIODS, runSearchConsoleSync, searchDemand } from '../services/search-console.service.js';

/*
 * /api/track: visit events from browsers that accepted analytics.
 * /api/leads: the public enquiry form, and the admin Leads and Search demand sections.
 * See docs/lead-tracking.md.
 */

// An input problem gets its message; anything else goes to errorHandler, which
// logs it and hides the details.
export const handle = (fn) => async (req, res, next) => {
    try {
        await fn(req, res);
    } catch (err) {
        if (err.status === 400) return res.status(400).json({ error: err.message });
        next(err);
    }
};

// Under Lambda, serverless-http sets the socket address from AWS's sourceIp,
// which a client cannot forge with a header.
export const clientIp = (req) => ipHash(req.socket?.remoteAddress);

export const trackRouter = express.Router();

// navigator.sendBeacon posts text/plain so the browser skips the CORS
// preflight. The answer is always 204: a beacon cannot read it anyway.
trackRouter.post('/', express.text({ type: 'text/plain', limit: '16kb' }), handle(async (req, res) => {
    const body = parseBeacon(req.body);
    await recordEvents({ visitorId: body.visitorId, events: body.events, attribution: body.attribution, ipHash: clientIp(req) });
    res.status(204).end();
}));

// The visitor changed their mind: their browser's visits are deleted.
trackRouter.post('/forget', express.text({ type: 'text/plain', limit: '1kb' }), handle(async (req, res) => {
    await forgetVisitor(parseBeacon(req.body).visitorId);
    res.status(204).end();
}));

trackRouter.post('/identify', authMiddleware, handle(async (req, res) => {
    await identifyVisitor({ visitorId: req.body?.visitorId, userId: req.userId });
    res.status(204).end();
}));

export const leadsRouter = express.Router();

leadsRouter.post('/', optionalAuthMiddleware, handle(async (req, res) => {
    // Honeypot: a field people never see. Bots that fill it get a normal-looking
    // answer and nothing is stored.
    if (req.body?.website) {
        console.warn(JSON.stringify({ event: 'lead_honeypot_hit' }));
        return res.status(201).json({ success: true });
    }
    const input = validateLead(req.body);
    const result = await captureLead(input, { userId: req.userId ?? null, ipHash: clientIp(req) });
    if (!result) return res.status(503).json({ error: 'We could not take your details right now. Please WhatsApp us instead.' });

    if (result.alert) {
        const product = result.lead.product_id
            ? await db.oneOrNone('SELECT name FROM products WHERE id = $1', [result.lead.product_id])
            : null;
        // notifyAdmin logs its own failures and never throws.
        await alertNewLead(result.lead, product?.name);
    }
    res.status(201).json({ success: true });
}));

leadsRouter.get('/admin', authMiddleware, isAdmin, handle(async (req, res) => {
    res.json(await adminOverview());
}));

// Search demand (docs/search-demand.md). Registered before /admin/:id.
leadsRouter.get('/search-demand', authMiddleware, isAdmin, handle(async (req, res) => {
    const days = Number(req.query.days);
    res.json(await searchDemand({ days: SEARCH_PERIODS.includes(days) ? days : 28 }));
}));

// "Sync now": the same run as the daily schedule, inside this request, so it
// stops early enough to answer before the 20-second function timeout. No
// Telegram alert: the admin who pressed it sees the outcome.
leadsRouter.post('/search-demand/sync', authMiddleware, isAdmin, handle(async (req, res) => {
    const deadline = Date.now() + 14_000;
    const result = await runSearchConsoleSync({ remainingMs: () => deadline - Date.now() });
    const status = { failed: 502, busy: 409, not_configured: 409 }[result.status] ?? 200;
    // `error` is what the admin client shows for a non-2xx answer.
    res.status(status).json(status === 200 ? result : { ...result, error: result.detail });
}));

leadsRouter.get('/admin/:id', authMiddleware, isAdmin, handle(async (req, res) => {
    const detail = await adminLeadDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Lead not found' });
    res.json(detail);
}));

leadsRouter.patch('/admin/:id', authMiddleware, isAdmin, handle(async (req, res) => {
    const updated = await updateLead(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Lead not found' });
    res.json(updated);
}));

leadsRouter.delete('/admin/:id', authMiddleware, isAdmin, handle(async (req, res) => {
    if (!(await deleteLead(req.params.id))) return res.status(404).json({ error: 'Lead not found' });
    res.status(204).end();
}));
