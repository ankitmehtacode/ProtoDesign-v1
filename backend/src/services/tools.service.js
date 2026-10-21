import db from '../config/database.js';
import { festivalPrice } from './festival.js';
import { getConfig as getWhatsAppConfig, makeRef, waMeUrl } from './whatsapp.service.js';
import { InputError, isUuid } from './leads.service.js';

/**
 * The printer advisor and the filament estimator (docs/lead-tracking.md).
 *
 * Both answer from the live catalogue, on the server. A result is stored and
 * given a signed code; a visitor who sends that code to the shop's WhatsApp
 * gets this exact result back (whatsapp.worker.js) and becomes a lead with a
 * verified number. The browser never supplies the text the bot sends, so a
 * crafted code cannot make the shop's number deliver someone else's words.
 */

const RESULTS_PER_IP_DAILY = 60;
// All networks together; each row is a few KB under Neon's 0.5 GB cap.
const RESULTS_DAILY = () => Number(process.env.TOOL_RESULTS_DAILY_CAP) > 0 ? Number(process.env.TOOL_RESULTS_DAILY_CAP) : 2000;
const PICKS = 3;

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

const inr = (n) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
const siteUrl = () => (process.env.FRONTEND_URL || 'https://www.protodesignstudio.com').replace(/\/+$/, '');
const productLink = (p) => `${siteUrl()}/product/${encodeURIComponent(p.slug || p.id)}`;

// ---------------------------------------------------------------------------
// Specifications
// ---------------------------------------------------------------------------

// Spec keys arrive with stray tabs, colons and casing from several sources.
// These lists mirror COMPARABLE_SPECS in src/seo/site.js, which the product
// pages use; the backend cannot import from src/ (SAM builds backend/ alone).
const SPEC_KEYS = {
    technology: ['technology', 'print technology'],
    buildVolume: ['build volume', 'build size (mm)', 'print size (l x w x h) (mm)', 'build volume (w*d*h)', 'print volume', 'printing volume'],
    nozzleTemp: ['max nozzle temperature', 'nozzle max temperature (°c)', 'max hotend temperature', 'nozzle temperature (°c)'],
    multiColour: ['multi-colour'],
    bedLevelling: ['bed levelling'],
};

const normKey = (k) => String(k).replace(/[\t:]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function specEntries(specs) {
    let s = specs;
    if (typeof s === 'string') {
        try { s = JSON.parse(s); } catch { return []; }
    }
    if (Array.isArray(s)) return s.map((e) => [e?.key, e?.value]);
    return s && typeof s === 'object' ? Object.entries(s) : [];
}

function spec(product, keys) {
    const byKey = new Map(specEntries(product.specifications)
        .filter(([k]) => k !== undefined && k !== null)
        .map(([k, v]) => [normKey(k), String(v ?? '').trim()]));
    for (const key of keys) {
        const value = byKey.get(key);
        if (value) return value;
    }
    return undefined;
}

const numbers = (text) => (String(text ?? '').match(/\d+(\.\d+)?/g) || []).map(Number);

/** What the advisor needs to know about a printer, from whatever its specs record. */
export function printerTraits(p) {
    const tech = `${spec(p, SPEC_KEYS.technology) ?? ''} ${p.sub_category ?? ''}`;
    const resin = /\b(sla|msla|dlp|lcd|resin)\b/i.test(tech);
    const sizes = numbers(spec(p, SPEC_KEYS.buildVolume)).filter((n) => n >= 20 && n <= 2000);
    const nozzle = numbers(spec(p, SPEC_KEYS.nozzleTemp)).find((n) => n >= 150 && n <= 600);
    const colourSpec = spec(p, SPEC_KEYS.multiColour);
    return {
        resin,
        buildMax: sizes.length ? Math.max(...sizes) : null,
        nozzleMax: nozzle ?? null,
        multiColour: (colourSpec ? !/^(no|none|single|n\/a)\b/i.test(colourSpec) : false)
            || /\b(ams|combo|multi[- ]?colou?r|cfs)\b/i.test(p.name),
        autoLevel: /auto/i.test(spec(p, SPEC_KEYS.bedLevelling) ?? ''),
    };
}

// ---------------------------------------------------------------------------
// Printer advisor
// ---------------------------------------------------------------------------

export const BUDGETS = { under_30k: 30_000, '30k_60k': 60_000, '60k_100k': 100_000, over_100k: Infinity };
export const USES = {
    first_printer: 'a first printer',
    functional: 'functional parts',
    detail: 'fine detail and miniatures',
    large: 'large prints',
    multicolour: 'multi-colour prints',
};
export const MATERIALS = { pla: 'PLA', petg_abs: 'PETG and ABS', engineering: 'carbon fibre and nylon' };

// Machines that are not general-purpose printers.
const NOT_A_PRINTER = new Set(['3D Pen', '3D Scanner', 'Laser Engraver', 'Wash & Cure']);

// Own keys only: `in` would accept "constructor" or "toString" and put
// function source into the result text the bot sends.
const isKey = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function validateAdvisor(raw) {
    const { budget, use, material } = asObject(raw);
    if (!isKey(BUDGETS, budget) || !isKey(USES, use) || !isKey(MATERIALS, material)) {
        throw new InputError('Choose a budget, a use and a material');
    }
    return { budget, use, material };
}

/** Scores one printer against the answers; higher fits better. Pure. */
export function scorePrinter(p, { use, material }, maxBudget) {
    const t = printerTraits(p);
    const price = Number(p.price);
    let score = 0;
    const reasons = [];

    if (use === 'detail') {
        if (t.resin) { score += 40; reasons.push('Resin printing gives the finest detail for miniatures and jewellery'); }
    } else if (t.resin) {
        score -= 30;
    }

    if (material !== 'pla' && t.resin) score -= 40; // resin machines cannot print filament
    if (material === 'engineering') {
        if (t.nozzleMax >= 300) { score += 30; reasons.push(`Hotend reaches ${t.nozzleMax} °C, enough for carbon fibre and nylon`); }
        else if (t.nozzleMax) score -= 40;
    } else if (material === 'petg_abs') {
        if (t.nozzleMax >= 260) { score += 10; reasons.push(`Hotend reaches ${t.nozzleMax} °C for PETG and ABS`); }
        else if (t.nozzleMax && t.nozzleMax < 250) score -= 20;
    }

    if (use === 'large') {
        if (t.buildMax >= 300) { score += 25; reasons.push(`Large build volume, up to ${t.buildMax} mm`); }
        else if (t.buildMax >= 250) score += 10;
    }
    if (use === 'multicolour') {
        if (t.multiColour) { score += 40; reasons.push('Prints in several colours in one go'); }
        else score -= 10;
    }
    if (use === 'first_printer') {
        if (t.autoLevel) { score += 10; reasons.push('Automatic bed levelling, so setup is easy'); }
        if (Number.isFinite(maxBudget)) score += (1 - price / maxBudget) * 10;
    }
    if (Number(p.stock) > 0) score += 5;
    return { score, reasons };
}

/**
 * The best three in-stock printers for the answers. When nothing fits the
 * budget, the closest one above it is offered and said to be over budget.
 */
export function advisePrinters(inputs, products) {
    const maxBudget = BUDGETS[inputs.budget];
    const printers = products
        .filter((p) => p.category === '3d_printer' && !p.is_archived && Number(p.stock) > 0
            && !NOT_A_PRINTER.has(p.sub_category))
        .map((p) => festivalPrice(p));

    const rank = (list) => list
        .map((p) => ({ p, ...scorePrinter(p, inputs, maxBudget) }))
        .sort((a, b) => b.score - a.score || Number(a.p.price) - Number(b.p.price));

    let ranked = rank(printers.filter((p) => Number(p.price) <= maxBudget)).slice(0, PICKS);
    let overBudget = false;
    if (ranked.length === 0) {
        ranked = rank(printers).sort((a, b) => Number(a.p.price) - Number(b.p.price)).slice(0, 1);
        overBudget = ranked.length > 0;
    }

    const picks = ranked.map(({ p, reasons }) => ({
        id: p.id, name: p.name, slug: p.slug ?? null, price: Number(p.price), image_url: p.image_url ?? null,
        reasons: reasons.length ? reasons : ['A solid all-rounder for the price'],
        url: productLink(p),
    }));
    const budgetLabel = Number.isFinite(maxBudget) ? `up to ${inr(maxBudget)}` : 'over ₹1,00,000';
    const headline = `Printer picks for ${USES[inputs.use]} in ${MATERIALS[inputs.material]}, budget ${budgetLabel}`;
    const note = picks.length === 0
        ? 'We have no printer in stock for this right now. Message us and we will source one.'
        : overBudget ? 'Nothing in stock fits this budget, so this is the closest one above it.' : null;
    return { headline, note, picks, summary: summaryText(headline, note, picks.map((x) => [x.name, inr(x.price), x.reasons[0], x.url])) };
}

// ---------------------------------------------------------------------------
// Filament estimator
// ---------------------------------------------------------------------------

// The filament sub-categories the shop uses (src/App.tsx /filaments).
export const FILAMENTS = ['PLA', 'PETG', 'ABS', 'Carbon Fiber', 'Nylon Fiber'];

/** Spool weight in kg from the name or specs ("1kg", "500 g"); null if not stated. */
export function spoolKg(p) {
    const text = `${p.name} ${specEntries(p.specifications).map(([k, v]) => `${k} ${v}`).join(' ')}`;
    // Not a density ("1.24 g/cm3"): a weight is not followed by a slash.
    const m = /(\d+(?:\.\d+)?)\s*(kg|g)\b(?!\s*\/)/i.exec(text);
    if (!m) return null;
    const kg = m[2].toLowerCase() === 'kg' ? Number(m[1]) : Number(m[1]) / 1000;
    return kg >= 0.1 && kg <= 10 ? kg : null;
}

export function validateEstimator(raw) {
    const inputs = asObject(raw);
    const material = FILAMENTS.includes(inputs.material) ? inputs.material : null;
    const printsPerWeek = Number(inputs.printsPerWeek);
    const gramsPerPrint = Number(inputs.gramsPerPrint);
    if (!material) throw new InputError('Choose a material');
    if (!(printsPerWeek > 0 && printsPerWeek <= 500)) throw new InputError('Prints per week must be between 1 and 500');
    if (!(gramsPerPrint > 0 && gramsPerPrint <= 5000)) throw new InputError('Grams per print must be between 1 and 5000');
    return { material, printsPerWeek, gramsPerPrint };
}

/** Monthly use and cost, priced from the cheapest in-stock spool of that material per kg. */
export function estimateFilament(inputs, products) {
    const gramsPerMonth = (inputs.printsPerWeek * inputs.gramsPerPrint * 52) / 12;
    const spools = products
        .filter((p) => p.category === 'filament' && !p.is_archived && Number(p.stock) > 0 && p.sub_category === inputs.material)
        .map((p) => festivalPrice(p))
        .map((p) => {
            const kg = spoolKg(p);
            return { p, kg: kg ?? 1, assumedKg: kg === null, perKg: Number(p.price) / (kg ?? 1) };
        })
        .sort((a, b) => a.perKg - b.perKg);

    const best = spools[0] ?? null;
    const kgPerMonth = gramsPerMonth / 1000;
    const spoolsPerMonth = best ? kgPerMonth / best.kg : kgPerMonth;
    const result = {
        material: inputs.material,
        grams_per_month: Math.round(gramsPerMonth),
        spools_per_month: Math.round(spoolsPerMonth * 10) / 10,
        days_per_spool: spoolsPerMonth > 0 ? Math.max(1, Math.round(30 / spoolsPerMonth)) : null,
        cost_per_month: best ? Math.round(kgPerMonth * best.perKg) : null,
        bulk: spoolsPerMonth >= 3,
        pick: best ? {
            id: best.p.id, name: best.p.name, slug: best.p.slug ?? null, price: Number(best.p.price),
            spool_kg: best.kg, assumed_kg: best.assumedKg, url: productLink(best.p),
        } : null,
    };

    const headline = `${inputs.material}: about ${(gramsPerMonth / 1000).toFixed(1)} kg a month`;
    const lines = [
        `You use about ${result.grams_per_month.toLocaleString('en-IN')} g of ${inputs.material} a month`
            + (best ? `, roughly ${result.spools_per_month} spool${result.spools_per_month === 1 ? '' : 's'} of ${best.kg} kg (one every ${result.days_per_spool} days).` : '.'),
        best ? `At ${inr(best.p.price)} a spool (${best.p.name}), that is about ${inr(result.cost_per_month)} a month.\n${result.pick.url}`
            : `We have no ${inputs.material} in stock right now. Reply and we will tell you when it is.`,
        result.bulk ? 'At this volume a bulk order saves money. Reply here and we will quote one.' : null,
    ].filter(Boolean);
    result.headline = headline;
    result.summary = `${headline}\n\n${lines.join('\n\n')}\n\nReply here with any question and our team will help.`;
    return result;
}

function summaryText(headline, note, rows) {
    const body = rows.map(([name, price, reason, url], i) => `${i + 1}. ${name} (${price})\n${reason}\n${url}`).join('\n\n');
    return [headline, note, body, 'Reply here with any question and our team will help.'].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Storing a result
// ---------------------------------------------------------------------------

const PROMPTS = {
    printer_advisor: 'Send me my ProtoDesign printer picks',
    filament_estimator: 'Send me my ProtoDesign filament estimate',
};

/**
 * Computes and stores one tool run. Returns the result, and when WhatsApp is
 * on, a code and a wa.me link that sends it. Returns null past the per-network
 * daily cap (logged), so a script cannot fill the database.
 */
export async function runTool(tool, rawInputs, { visitorId = null, ipHash = null } = {}) {
    const inputs = tool === 'printer_advisor' ? validateAdvisor(rawInputs) : validateEstimator(rawInputs);
    const counts = await db.one(
        `SELECT (SELECT count(*) FROM tool_results WHERE created_at > now() - interval '1 day')::int AS total,
                (SELECT count(*) FROM tool_results WHERE $1::text IS NOT NULL AND ip_hash = $1
                                                     AND created_at > now() - interval '1 day')::int AS from_ip`,
        [ipHash]);
    if (counts.from_ip >= RESULTS_PER_IP_DAILY || counts.total >= RESULTS_DAILY()) {
        logFault('tool_cap_reached', { tool, perIp: counts.from_ip >= RESULTS_PER_IP_DAILY });
        return null;
    }

    const products = await db.any(
        `SELECT id, name, slug, price, compare_at_price, category, sub_category, stock, specifications, image_url, is_archived
           FROM products WHERE category = $1 AND (is_archived = false OR is_archived IS NULL)`,
        [tool === 'printer_advisor' ? '3d_printer' : 'filament']
    );
    const result = tool === 'printer_advisor' ? advisePrinters(inputs, products) : estimateFilament(inputs, products);

    const row = await db.tx(async (t) => {
        const visitor = isUuid(visitorId) ? await t.oneOrNone('SELECT id FROM visitors WHERE id = $1', [visitorId]) : null;
        const saved = await t.one(
            `INSERT INTO tool_results (tool, inputs, result, visitor_id, ip_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [tool, JSON.stringify(inputs), JSON.stringify(result), visitor?.id ?? null, ipHash]
        );
        if (visitor) {
            await t.none(`INSERT INTO visitor_events (visitor_id, name, path) VALUES ($1, 'tool_use', $2)`,
                [visitor.id, tool === 'printer_advisor' ? '/printer-advisor' : '/filament-calculator']);
        }
        return saved;
    });

    const wa = getWhatsAppConfig();
    const code = wa.enabled ? makeRef('advice', row.id, wa.linkSecret) : null;
    logEvent('tool_run', { tool, resultId: row.id });
    return {
        id: row.id,
        result,
        code,
        whatsappUrl: code ? waMeUrl(wa.businessNumber, `${PROMPTS[tool]}: ${code}`) : null,
    };
}

/** The stored result a WhatsApp code points at, with its tool. */
export async function loadResult(id) {
    return db.oneOrNone('SELECT id, tool, result, visitor_id, lead_id FROM tool_results WHERE id = $1', [id]);
}
