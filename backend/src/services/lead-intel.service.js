import db from '../config/database.js';
import { spoolKg } from './tools.service.js';

/**
 * Lead scoring, hot-lead alerts and filament reorder predictions
 * (docs/lead-intel.md).
 *
 * The score is a sum of plain rules, each shown with its points, not a
 * trained model: a shop this size has too few won leads to learn from, and a
 * score the team can read ("added to cart, back 3 days this fortnight") is one
 * they can act on and argue with. Change the weights in SCORING once there is
 * evidence of what predicts a sale.
 *
 * Reorder predictions estimate when a filament buyer will run out, from their
 * own buying rhythm, else their filament-calculator answer, else what is
 * typical for the shop's repeat buyers. They are a call list for the team;
 * nothing is sent to customers.
 */

export const LEAD_SCORING_EVENT_SOURCE = 'protodesign.lead-scoring';
export const REORDER_DIGEST_EVENT_SOURCE = 'protodesign.reorder-digest';

export const HOT_SCORE = 60;
// A hot lead is alerted once; it can be alerted again only after cooling
// below this, so a score hovering around 60 does not alert every hour.
const COOLED_SCORE = 45;
const MAX_ALERTS_PER_RUN = 5;
// Telegram may take 2 s a message; no send starts with less than this left.
const MIN_REMAINING_MS = 4000;
const PREMIUM_PRICE = 20_000;
const OPEN_STATUSES = ['new', 'contacted', 'qualified'];
const CONFIRMED_ORDER_STATUSES = ['processing', 'shipped', 'delivered', 'completed'];
const DAY_MS = 86_400_000;

const adminUrl = (frontendUrl) => (frontendUrl ? `\n\n${String(frontendUrl).replace(/\/+$/, '')}/admin?tab=leads` : '');

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const INTEREST = {
    printer: [15, 'Wants a printer'], resin: [12, 'Wants resin printing'], service: [10, 'Wants a printing service'],
    filament: [8, 'Wants filament'], other: [3, 'Asked about something else'],
};

/**
 * A lead's score (0-100) and the reasons for it, largest first. `s` holds the
 * signals gathered by runLeadScoring; activity counts cover the last 30 days.
 */
export function scoreLead(s, now = new Date()) {
    const reasons = [];
    const add = (points, label) => { if (points) reasons.push({ label, points }); };

    const [interestPoints, interestLabel] = INTEREST[s.interest] ?? INTEREST.other;
    add(interestPoints, interestLabel);
    add(Math.min(s.product_views, 5) * 3, `Viewed ${s.product_views} product page${s.product_views === 1 ? '' : 's'}`);
    if (s.premium_views > 0) add(10, `Looked at a product over ₹${PREMIUM_PRICE.toLocaleString('en-IN')}`);
    if (s.carts > 0) add(15, 'Added to cart');
    if (s.quotes > 0) add(10, 'Started a print quote');
    if (s.tools > 0) add(8, 'Used the advisor or calculator');
    if (s.alerts > 0) add(8, 'Asked for a stock or price alert');
    if (s.active_days >= 4) add(15, `Came back on ${s.active_days} days in two weeks`);
    else if (s.active_days >= 2) add(10, `Came back on ${s.active_days} days in two weeks`);
    if (s.verified) add(5, 'Confirmed their number or email');
    if (s.has_message) add(5, 'Wrote a message');
    if (s.submissions > 1) add(5, `Enquired ${s.submissions} times`);
    if (s.orders > 0) add(5, 'Already a customer');

    const last = Math.max(new Date(s.last_submitted_at).getTime(), s.last_event_at ? new Date(s.last_event_at).getTime() : 0);
    const idleDays = (now.getTime() - last) / DAY_MS;
    if (idleDays <= 2) add(15, 'Active in the last 2 days');
    else if (idleDays <= 7) add(8, 'Active this week');
    else if (idleDays > 30) add(-15, `Quiet for ${Math.floor(idleDays)} days`);

    const score = Math.max(0, Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0)));
    return { score, reasons: reasons.sort((a, b) => b.points - a.points) };
}

export const band = (score) => (score == null ? null : score >= HOT_SCORE ? 'hot' : score >= 35 ? 'warm' : 'cold');

const SIGNALS_SQL = `
    SELECT l.id, l.name, l.phone, l.email, l.interest, l.submissions, l.last_submitted_at,
           l.score, l.score_reasons, l.hot_alerted_at, p.name AS product_name,
           COALESCE(length(trim(l.message)) > 0, false) AS has_message,
           COALESCE(a.product_views, 0)::int AS product_views, COALESCE(a.premium_views, 0)::int AS premium_views,
           COALESCE(a.carts, 0)::int AS carts, COALESCE(a.quotes, 0)::int AS quotes,
           COALESCE(a.tools, 0)::int AS tools, COALESCE(a.alerts, 0)::int AS alerts,
           COALESCE(a.active_days, 0)::int AS active_days, a.last_event_at,
           (EXISTS (SELECT 1 FROM tool_results t WHERE t.lead_id = l.id AND t.delivered_at IS NOT NULL)
            OR EXISTS (SELECT 1 FROM product_alerts pa WHERE pa.lead_id = l.id AND pa.confirmed_at IS NOT NULL)) AS verified,
           (SELECT count(*) FROM orders o WHERE l.user_id IS NOT NULL AND o.user_id = l.user_id
               AND o.status IN ($2:csv))::int AS orders
      FROM leads l
      LEFT JOIN products p ON p.id = l.product_id
      LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE e.name = 'product_view') AS product_views,
                  count(DISTINCT e.product_id) FILTER (WHERE e.name = 'product_view' AND pr.price >= $3) AS premium_views,
                  count(*) FILTER (WHERE e.name = 'add_to_cart') AS carts,
                  count(*) FILTER (WHERE e.name = 'quote_start') AS quotes,
                  count(*) FILTER (WHERE e.name = 'tool_use') AS tools,
                  count(*) FILTER (WHERE e.name = 'alert_signup') AS alerts,
                  -- Days in India: a late-evening session is one day, not two UTC dates.
                  count(DISTINCT (e.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date)
                      FILTER (WHERE e.created_at > now() - interval '14 days') AS active_days,
                  max(e.created_at) AS last_event_at
             FROM visitors v
             JOIN visitor_events e ON e.visitor_id = v.id
             LEFT JOIN products pr ON pr.id = e.product_id
            WHERE v.lead_id = l.id AND e.created_at > now() - interval '30 days') a ON true
     WHERE l.status IN ($1:csv)`;

const sameReasons = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function hotAlert(lead) {
    return [
        `🔥 Hot lead (${lead.score}/100): ${lead.name || 'No name given'}`,
        lead.product_name ? `Interested in: ${lead.product_name}` : null,
        lead.phone ? `Phone: +${lead.phone}` : null,
        lead.email ? `Email: ${lead.email}` : null,
        `Why: ${lead.reasons.filter((r) => r.points > 0).slice(0, 4).map((r) => r.label.toLowerCase()).join('; ')}`,
    ].filter(Boolean).join('\n');
}

/**
 * Scores every open lead, stores what changed, and alerts the team (through
 * `alert`, telegram notifyAdmin, which resolves true once delivered) about
 * leads that just turned hot: up to five one by one, the rest in one summary.
 * A lead is alerted again only after its score falls below 45 and climbs back.
 * Hourly, from EventBridge.
 *
 * Each hot lead is claimed (hot_alerted_at set where it was empty) before its
 * alert is sent, so a duplicate or retried run cannot alert it twice; a claim
 * whose alert was not delivered, or not sent for lack of time, is released for
 * the next run.
 */
export async function runLeadScoring({ alert, now = new Date(), frontendUrl = process.env.FRONTEND_URL, remainingMs = () => Infinity } = {}) {
    // Logged and alerted rather than thrown: EventBridge would retry the run
    // twice, and a retry after alerts went out would send them again.
    try {
        return await scoreAll({ alert, now, frontendUrl, remainingMs });
    } catch (err) {
        logFault('lead_scoring_failed', { error: err.message });
        await alert?.('⚠️ Lead scoring failed. Details are in the function log.');
        return { status: 'failed' };
    }
}

async function scoreAll({ alert, now, frontendUrl, remainingMs }) {
    // A closed lead keeps no score: a won or lost lead is nobody to call.
    await db.none(
        `UPDATE leads SET score = NULL, score_reasons = NULL, scored_at = NULL, hot_alerted_at = NULL
          WHERE status NOT IN ($1:csv) AND (score IS NOT NULL OR hot_alerted_at IS NOT NULL)`, [OPEN_STATUSES]);
    const leads = await db.any(SIGNALS_SQL, [OPEN_STATUSES, CONFIRMED_ORDER_STATUSES, PREMIUM_PRICE]);
    const updates = [];
    const turnedHot = [];
    for (const lead of leads) {
        const { score, reasons } = scoreLead(lead, now);
        let alertedAt = lead.hot_alerted_at;
        if (score < COOLED_SCORE) alertedAt = null;
        if (score >= HOT_SCORE && !alertedAt) turnedHot.push({ ...lead, score, reasons });
        if (score !== lead.score || !sameReasons(reasons, lead.score_reasons) || alertedAt !== lead.hot_alerted_at) {
            updates.push({ id: lead.id, score, reasons, cooled: alertedAt === null && lead.hot_alerted_at !== null });
        }
    }

    if (updates.length) {
        await db.none(
            `UPDATE leads SET score = u.score, score_reasons = u.reasons, scored_at = now(),
                    hot_alerted_at = CASE WHEN u.cooled THEN NULL ELSE leads.hot_alerted_at END
               FROM jsonb_to_recordset($1::jsonb) AS u(id uuid, score smallint, reasons jsonb, cooled boolean)
              WHERE leads.id = u.id AND leads.status IN ($2:csv)`,
            [JSON.stringify(updates), OPEN_STATUSES]
        );
    }

    const { alerted, unsent } = alert ? await alertHot(turnedHot, { alert, link: adminUrl(frontendUrl), remainingMs }) : { alerted: 0, unsent: 0 };
    const result = { status: 'ok', scored: leads.length, updated: updates.length, alerted, unsent };
    if (unsent) logFault('hot_lead_alerts_unsent', { unsent });
    logEvent('lead_scoring', result);
    return result;
}

async function alertHot(turnedHot, { alert, link, remainingMs }) {
    if (!turnedHot.length) return { alerted: 0, unsent: 0 };
    // Only leads still open, hot and unclaimed: a concurrent run, or the
    // admin closing the lead meanwhile, takes them out.
    const claimed = new Set((await db.any(
        `UPDATE leads SET hot_alerted_at = now()
          WHERE id = ANY($1::uuid[]) AND hot_alerted_at IS NULL AND status IN ($2:csv) AND score >= $3
          RETURNING id`,
        [turnedHot.map((l) => l.id), OPEN_STATUSES, HOT_SCORE])).map((r) => r.id));
    const hot = turnedHot.filter((l) => claimed.has(l.id)).sort((a, b) => b.score - a.score);

    const unsent = [];
    const send = async (leadsInMessage, text) => {
        if (remainingMs() < MIN_REMAINING_MS || !(await alert(text))) unsent.push(...leadsInMessage.map((l) => l.id));
    };
    for (const lead of hot.slice(0, MAX_ALERTS_PER_RUN)) await send([lead], hotAlert(lead) + link);
    const rest = hot.slice(MAX_ALERTS_PER_RUN);
    if (rest.length) {
        await send(rest, `🔥 ${rest.length} more lead${rest.length === 1 ? '' : 's'} turned hot: `
            + `${rest.slice(0, 10).map((l) => l.name || (l.phone ? `+${l.phone}` : l.email)).join(', ')}${link}`);
    }
    if (unsent.length) await db.none('UPDATE leads SET hot_alerted_at = NULL WHERE id = ANY($1::uuid[])', [unsent]);
    return { alerted: hot.length - unsent.length, unsent: unsent.length };
}

// ---------------------------------------------------------------------------
// Filament reorder predictions
// ---------------------------------------------------------------------------

// One 1 kg spool a month: a hobbyist printing a few evenings a week. Used
// until five repeat buyers give the shop its own typical rate.
const DEFAULT_KG_PER_DAY = 1 / 30;
const MIN_REPEAT_BUYERS = 5;
// An order within this many days of the one before is part of the same
// purchase (a forgotten colour), not a sign of fast use.
const MIN_GAP_DAYS = 7;
// Listed from 45 days after the predicted date (lapsed beyond that) to 21 before.
const OVERDUE_DAYS = 45;
const AHEAD_DAYS = 21;
const DIGEST_OVERDUE_DAYS = 14;

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Groups filament order lines into each customer's purchases (kg per order)
 * and, where they have bought more than once, their rate: what they bought
 * before their last purchase, used up over the time between first and last.
 */
export function buyingHistory(lines) {
    const customers = new Map();
    for (const l of lines) {
        const c = customers.get(l.user_id) ?? { user_id: l.user_id, name: l.full_name, email: l.email, phone: null,
            orders: new Map(), materials: new Set() };
        const o = c.orders.get(l.order_id) ?? { at: new Date(l.created_at), kg: 0, assumedKg: false };
        const kg = spoolKg({ name: l.product_name, specifications: l.specifications });
        if (kg === null) o.assumedKg = true;
        o.kg += (kg ?? 1) * l.quantity;
        c.orders.set(l.order_id, o);
        if (l.sub_category) c.materials.add(l.sub_category);
        c.phone ??= l.phone || null;
        c.name ||= l.ship_name;
        customers.set(l.user_id, c);
    }
    return [...customers.values()].map((c) => {
        const orders = [];
        for (const o of [...c.orders.values()].sort((a, b) => a.at - b.at)) {
            const prev = orders.at(-1);
            if (prev && (o.at - prev.lastAt) / DAY_MS < MIN_GAP_DAYS) {
                prev.kg += o.kg;
                prev.lastAt = o.at;
                prev.assumedKg ||= o.assumedKg;
            } else {
                orders.push({ ...o, lastAt: o.at });
            }
        }
        const last = orders.at(-1);
        // From the first purchase to the start of the last one.
        const spanDays = (last.at - orders[0].at) / DAY_MS;
        const earlierKg = orders.slice(0, -1).reduce((sum, o) => sum + o.kg, 0);
        return {
            user_id: c.user_id, name: c.name, email: c.email, phone: c.phone, materials: [...c.materials],
            // Whether the last purchase's weight was guessed, which is the one shown.
            assumedKg: last.assumedKg, orders: orders.length, lastOrderAt: last.lastAt,
            lastKg: Math.round(last.kg * 100) / 100,
            historyRate: orders.length > 1 && spanDays >= MIN_GAP_DAYS ? earlierKg / spanDays : null,
        };
    });
}

/**
 * Who is likely to run out of filament soon, most overdue first. `calculator`
 * maps user ids to grams a month from their newest filament-calculator result.
 */
export function predictReorders(history, calculator = new Map(), now = new Date()) {
    const rates = history.map((c) => c.historyRate).filter((r) => r !== null);
    const typical = rates.length >= MIN_REPEAT_BUYERS ? median(rates) : DEFAULT_KG_PER_DAY;
    return history
        .map((c) => {
            const grams = calculator.get(c.user_id);
            const [rate, basis] = c.historyRate !== null ? [c.historyRate, 'history']
                : grams > 0 ? [grams / 1000 / 30, 'calculator']
                    : [typical, 'typical'];
            const runsOutAt = new Date(c.lastOrderAt.getTime() + (c.lastKg / rate) * DAY_MS);
            return { ...c, kgPerMonth: Math.round(rate * 30 * 10) / 10, basis, runsOutAt,
                // `|| 0`: never -0, which would show as "-0 days".
                daysLeft: Math.round((runsOutAt - now) / DAY_MS) || 0 };
        })
        .filter((c) => c.daysLeft >= -OVERDUE_DAYS && c.daysLeft <= AHEAD_DAYS)
        .sort((a, b) => a.runsOutAt - b.runsOutAt);
}

/** The admin's "Filament running low" list. */
export async function reorderPredictions({ now = new Date() } = {}) {
    const [lines, calc] = await Promise.all([
        db.any(
            `SELECT o.user_id, o.id AS order_id, o.created_at, oi.quantity, p.name AS product_name, p.specifications,
                    p.sub_category, u.email, u.full_name, o.shipping_address->>'phone' AS phone,
                    o.shipping_address->>'fullName' AS ship_name
               FROM orders o
               JOIN order_items oi ON oi.order_id = o.id
               JOIN products p ON p.id = oi.product_id
               JOIN users u ON u.id = o.user_id
              WHERE o.status IN ($1:csv) AND p.category = 'filament' AND o.created_at > now() - interval '400 days'
              ORDER BY o.created_at DESC`,
            [CONFIRMED_ORDER_STATUSES]
        ),
        db.any(
            `SELECT DISTINCT ON (l.user_id) l.user_id, (t.result->>'grams_per_month')::numeric AS grams
               FROM tool_results t JOIN leads l ON l.id = t.lead_id
              WHERE t.tool = 'filament_estimator' AND l.user_id IS NOT NULL
              ORDER BY l.user_id, t.created_at DESC`
        ),
    ]);
    const calculator = new Map(calc.map((r) => [r.user_id, Number(r.grams)]));
    const history = buyingHistory(lines);
    return {
        customers: predictReorders(history, calculator, now),
        buyers: history.length,
        repeatBuyers: history.filter((c) => c.historyRate !== null).length,
    };
}

/** Monday's Telegram list of customers likely to run out within a week. */
export async function runReorderDigest({ alert, now = new Date(), frontendUrl = process.env.FRONTEND_URL } = {}) {
    let due;
    try {
        // Up to two weeks overdue: past that they have bought elsewhere or
        // stopped, and would crowd out this week's names every Monday.
        due = (await reorderPredictions({ now })).customers.filter((c) => c.daysLeft >= -DIGEST_OVERDUE_DAYS && c.daysLeft <= 7);
    } catch (err) {
        logFault('reorder_digest_failed', { error: err.message });
        await alert?.('⚠️ The weekly filament reorder list could not be built. Details are in the function log.');
        return { status: 'failed' };
    }
    logEvent('reorder_digest', { due: due.length });
    if (!due.length) return { status: 'ok', due: 0 };
    const day = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
    const lines = due.slice(0, 10).map((c) => `• ${c.name || c.email} (${c.materials.join(', ') || 'filament'}): `
        + `${c.daysLeft < 0 ? `likely ran out ${day(c.runsOutAt)}` : `runs out ~${day(c.runsOutAt)}`}`
        + `${c.phone ? ` · ${c.phone}` : ''}`);
    await alert?.([`🧵 ${due.length} customer${due.length === 1 ? '' : 's'} likely to need filament this week`, ...lines,
        due.length > 10 ? `…and ${due.length - 10} more in the admin.` : null].filter(Boolean).join('\n')
        + adminUrl(frontendUrl));
    return { status: 'ok', due: due.length };
}
