import express from 'express';
import { clientIp, handle } from './leads.routes.js';
import { runTool } from '../services/tools.service.js';
import { confirm, subscribe, unsubscribe, validateAlert } from '../services/product-alerts.service.js';

/*
 * /api/tools: the printer advisor and filament estimator.
 * /api/alerts: back-in-stock and price-drop email alerts.
 * See docs/lead-tracking.md.
 */

const BUSY = 'Too many requests from your network today. Please try again tomorrow, or WhatsApp us.';

export const toolsRouter = express.Router();

for (const [path, tool] of [['/printer-advisor', 'printer_advisor'], ['/filament-estimator', 'filament_estimator']]) {
    toolsRouter.post(path, handle(async (req, res) => {
        const out = await runTool(tool, req.body?.inputs, { visitorId: req.body?.visitorId, ipHash: clientIp(req) });
        if (!out) return res.status(429).json({ error: BUSY });
        res.json(out);
    }));
}

export const alertsRouter = express.Router();

alertsRouter.post('/', handle(async (req, res) => {
    if (req.body?.website) { // honeypot, as on the enquiry form
        console.warn(JSON.stringify({ event: 'alert_honeypot_hit' }));
        return res.status(201).json({ success: true });
    }
    const outcome = await subscribe(validateAlert(req.body), { ipHash: clientIp(req) });
    if (!outcome) return res.status(429).json({ error: BUSY });
    res.status(outcome === 'created' ? 201 : 200).json({ success: true });
}));

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const page = (title, body, form = '') => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>ProtoDesign alerts</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${form}
<p><a href="https://www.protodesignstudio.com">ProtoDesign</a></p></body>`;

const button = (label) => `<form method="post"><button type="submit"
 style="font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:1px solid #333;cursor:pointer">${escapeHtml(label)}</button></form>`;

/*
 * The links in alert emails. GET only shows a button; the POST does the work,
 * so mail scanners and link previews that open every link change nothing.
 * The token is in the path; it is the only key to that one alert.
 */
const ACTIONS = {
    confirm: {
        run: confirm,
        ask: ['Confirm your alert', 'Press the button to turn on the email alert you asked for.', 'Confirm'],
        done: ["You're all set", "We'll email you once when it happens. Every email has an unsubscribe link."],
    },
    unsubscribe: {
        run: unsubscribe,
        ask: ['Stop this alert?', "Press the button and you won't get this alert.", 'Unsubscribe'],
        done: ["You're unsubscribed", "You won't get this alert. Nothing else was set up for this address."],
    },
};
const NOT_FOUND = ['Link not recognised', 'This link is not valid or the alert was stopped. Reply to any alert email and we will help.'];

for (const [action, a] of Object.entries(ACTIONS)) {
    alertsRouter.get(`/${action}/:token`, (req, res) => {
        res.type('html').send(page(a.ask[0], a.ask[1], button(a.ask[2])));
    });
    // Forms post urlencoded; the body itself is not used.
    alertsRouter.post(`/${action}/:token`, handle(async (req, res) => {
        const done = await a.run(req.params.token);
        res.status(done ? 200 : 404).type('html').send(page(...(done ? a.done : NOT_FOUND)));
    }));
}
