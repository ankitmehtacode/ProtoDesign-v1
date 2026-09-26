/**
 * Daily catalog sync: lists trending, commercially licensed Printables models
 * as made-to-order products in the '3dprintables' category.
 *
 * Runs as an EventBridge-scheduled invoke of the API function (see
 * infra/template.yaml, CatalogSyncSchedule) and is dispatched in app.ts on
 * CATALOG_SYNC_EVENT_SOURCE. Manual run:
 *   aws lambda invoke --function-name <name> \
 *     --payload '{"source":"protodesign.catalog-sync"}' --cli-binary-format raw-in-base64-out out.json
 *
 * Rules, each enforced below:
 *  - Only licenses that allow selling prints are requested (COMMERCIAL_LICENSES),
 *    and the license is re-checked on every item rather than trusted.
 *  - Designer, license and source link are stored as specifications and in the
 *    description: CC BY / BY-SA / BY-ND require that attribution.
 *  - Only models whose page reports a filament weight are priced; the rest are
 *    skipped, so no model file is ever downloaded.
 *  - Trademarked characters and brands are skipped (BLOCKED_TERMS): a
 *    designer's license cannot grant rights to a character they do not own.
 *    LEGO-compatible parts are allowed when the title says so.
 *  - A model is imported at most once, keyed by its source URL. Archiving an
 *    imported product is how an admin rejects it: it is never re-imported.
 *
 * Printables has no public API; this uses the GraphQL endpoint its own site
 * calls. If it changes shape the run fails loudly (catalog_sync_failed) and
 * nothing is written.
 */

import db from '../config/database.js';
import { storageService } from './storage.service.js';

export const CATALOG_SYNC_EVENT_SOURCE = 'protodesign.catalog-sync';

const PRINTABLES_API = 'https://api.printables.com/graphql/';
const PRINTABLES_MEDIA = 'https://media.printables.com/';
const REQUEST_TIMEOUT_MS = 8000;

const MAX_NEW_PER_RUN = 5;
const MAX_PAGES = 10;            // 30 models a page; ~10% report a weight
const PAGE_SIZE = 30;
const MAX_IMAGES = 3;
const STOP_WHEN_REMAINING_MS = 6000;

// Printables license ids that permit commercial use of the model.
export const COMMERCIAL_LICENSES = new Map([
    ['7', 'CC0 1.0 (Public Domain)'],
    ['1', 'CC BY 4.0'],
    ['2', 'CC BY-SA 4.0'],
    ['8', 'CC BY-ND 4.0'],
    ['15', 'Printables Commercial Use'],
    ['14', 'Printables Commercial Use - No Derivatives'],
]);

// Materials we print. Printables reports PETG as "PET".
const MATERIALS = new Map([['PLA', 'PLA'], ['PETG', 'PETG'], ['PET', 'PETG'], ['ABS', 'ABS']]);

// One honest line per material for the product copy.
const MATERIAL_NOTES = {
    PLA: 'PLA is rigid and holds fine detail well; it suits indoor use away from heat.',
    PETG: 'PETG is tougher and more heat-tolerant than PLA, so it copes with everyday handling.',
    ABS: 'ABS is strong and heat-resistant, suited to parts that get warm or take knocks.',
};

// Vercel deploy hook: rebuilding the site prerenders the new products, so
// crawlers get their full title, description and Product data in the HTML.
const DEPLOY_HOOK_RE = /^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[A-Za-z0-9_/-]+$/;

// Printables reports 0 g for models without slicer data; that is no price basis.
const MIN_GRAMS = 5;

// Confirmed by the business (2026-09-26). Mirrors the quote page's ₹8 base
// rate and ₹150 setup fee, applied per gram of filament.
const PRICE_PER_GRAM = 8;
const BASE_PRICE = 150;

// Made-to-order items have no real stock; this caps open orders per item and
// is restored on every run.
export const MADE_TO_ORDER_STOCK = 10;
export const MADE_TO_ORDER_SPEC = { key: 'Fulfilment', value: 'Made to order' };

// Matched as whole words against name, summary and tags, case-insensitively.
const BLOCKED_TERMS = [
    // Trademarks and characters
    'pokemon', 'pikachu', 'nintendo', 'mario', 'zelda', 'marvel', 'avengers', 'spiderman', 'spider-man',
    'disney', 'pixar', 'star wars', 'darth', 'vader', 'mandalorian', 'yoda', 'batman', 'superman', 'dc comics',
    'harry potter', 'hogwarts', 'hello kitty', 'sanrio', 'minecraft', 'fortnite', 'warhammer',
    'transformers', 'hot wheels', 'barbie', 'naruto', 'dragon ball', 'one piece', 'sonic', 'playstation', 'xbox',
    'apple', 'iphone', 'airpods', 'tesla', 'ferrari', 'bmw', 'porsche', 'mercedes', 'nike', 'adidas',
    // Not sellable
    'gun', 'pistol', 'rifle', 'firearm', 'ammo', 'suppressor', 'knife', 'blade', 'weapon',
    'calibration', 'benchy', 'test print', 'nsfw',
];
const BLOCKED_RE = new RegExp(`\\b(${BLOCKED_TERMS.map(t => t.replace(/[-]/g, '\\-')).join('|')})\\b`, 'i');
// Parts that fit LEGO bricks are fine to sell; LEGO-branded sets and minifigures are not.
const LEGO_RE = /\blego\b/i;
const COMPATIBLE_RE = /\b(compatible|fits|for)\b/i;

const MEDIA_PATH_RE = /^media\/[A-Za-z0-9_\-./]+\.(jpe?g|png|webp)$/i;
// A generated render is not a photo of the product; listing it as one misleads.
const AI_IMAGE_RE = /chatgpt|dall-?e|midjourney|stable-?diffusion|ai-?generated|firefly|gemini/i;

/** Drops file-format lists and "Easy to Print"-style suffixes from a model title. */
const cleanName = (name) => name
    .replace(/[,\s]*\.(stl|step|stp|f3d|3mf|obj)\b/gi, '')
    .replace(/\s*[|–-]\s*(easy to print|no supports?( needed)?|print[- ]in[- ]place)\s*$/i, '')
    .replace(/[\s,|–-]+$/, '')
    .trim();

const PRINTS_QUERY = `query ($limit: Int!, $cursor: String, $licenses: [ID]) {
  morePrints(limit: $limit, cursor: $cursor, ordering: "trending", licenses: $licenses) {
    cursor
    items {
      id name slug summary nsfw weight printDuration
      materials { name } tags { name }
      license { id }
      user { publicUsername }
      images { filePath }
    }
  }
}`;

const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

/** Plain single-line text: no tags, no control characters, bounded length. */
const plainText = (value, max) => String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const slugify = (name) =>
    `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'print'}-${Math.random().toString(36).substring(2, 6)}`;

export const priceFor = (grams) => Math.ceil((grams * PRICE_PER_GRAM + BASE_PRICE) / 10) * 10;

export async function fetchPage(fetchImpl, cursor) {
    const res = await fetchImpl(PRINTABLES_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://www.printables.com' },
        body: JSON.stringify({
            query: PRINTS_QUERY,
            variables: { limit: PAGE_SIZE, cursor, licenses: [...COMMERCIAL_LICENSES.keys()] },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Printables responded ${res.status}`);
    const body = await res.json();
    const page = body?.data?.morePrints;
    if (body?.errors?.length || !page || !Array.isArray(page.items)) {
        throw new Error(`Unexpected Printables response: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
    }
    return page;
}

/**
 * Turns one Printables item into a listing, or returns { skip: reason }.
 * Everything from the API is treated as untrusted.
 */
export function toListing(item) {
    const license = COMMERCIAL_LICENSES.get(String(item?.license?.id));
    if (!license) return { skip: 'license' };
    if (item.nsfw) return { skip: 'nsfw' };

    const id = String(item.id ?? '');
    const slug = String(item.slug ?? '');
    if (!/^\d+$/.test(id) || !/^[a-z0-9-]+$/.test(slug)) return { skip: 'malformed' };

    const name = cleanName(plainText(item.name, 120));
    const summary = plainText(item.summary, 400);
    const tagList = [...new Set((item.tags ?? []).map(t => plainText(t?.name, 40).toLowerCase()).filter(Boolean))].slice(0, 5);
    const tags = tagList.join(' ');
    if (!name) return { skip: 'malformed' };
    const text = `${name} ${summary} ${tags}`;
    if (BLOCKED_RE.test(text)) return { skip: 'blocked_term' };
    if (LEGO_RE.test(text) && !COMPATIBLE_RE.test(name)) return { skip: 'blocked_term' };

    const grams = Number(item.weight);
    const hours = Number(item.printDuration);
    if (!Number.isFinite(grams) || grams < MIN_GRAMS) return { skip: 'weight' };

    const reported = (item.materials ?? []).map(m => String(m?.name ?? '').toUpperCase());
    const materials = reported.length === 0 ? ['PLA'] : reported.map(m => MATERIALS.get(m));
    if (materials.some(m => !m)) return { skip: 'material' };
    const material = materials[0];

    const imagePaths = (item.images ?? [])
        .map(i => String(i?.filePath ?? ''))
        .filter(p => MEDIA_PATH_RE.test(p) && !p.includes('..') && !AI_IMAGE_RE.test(p))
        .slice(0, MAX_IMAGES);
    if (imagePaths.length === 0) return { skip: 'no_image' };

    const designer = plainText(item.user?.publicUsername, 80) || 'the designer';
    const sourceUrl = `https://www.printables.com/model/${id}-${slug}`;

    return {
        name,
        sourceUrl,
        imageUrls: imagePaths.map(p => PRINTABLES_MEDIA + p),
        price: priceFor(grams),
        // Written from this listing's own facts. Copying the Printables text
        // would make the page a duplicate that search engines rank below the original.
        shortDescription: `3D printed to order in ${material} in Indore, about ${Math.round(grams)} g.`,
        description: [
            `${name}, 3D printed to order in ${material} at our workshop in Indore and delivered anywhere in India.`,
            MATERIAL_NOTES[material],
            `It weighs about ${Math.round(grams)} g${hours > 0 ? ` and takes about ${Math.max(1, Math.round(hours))} hour${Math.round(hours) > 1 ? 's' : ''} to print` : ''}. We print it after you order and pack it for shipping.`,
            tagList.length >= 2 ? `Good for: ${tagList.join(', ')}.` : '',
            summary ? `From the designer: "${summary}"` : '',
            `Design: "${name}" by ${designer}, published on Printables under ${license}. Source: ${sourceUrl}`,
        ].filter(Boolean).join('\n'),
        specifications: [
            { key: 'Material', value: material },
            { key: 'Approx. weight', value: `${Math.round(grams)} g` },
            MADE_TO_ORDER_SPEC,
            { key: 'Designer', value: designer },
            { key: 'License', value: license },
            { key: 'Source', value: sourceUrl },
        ],
    };
}

const alreadyImported = (sourceUrl) => db.oneOrNone(
    `SELECT 1 FROM products WHERE specifications @> $1::jsonb`,
    [JSON.stringify([{ key: 'Source', value: sourceUrl }])]);

async function createProduct(listing, uploadImage) {
    // Upload first: a failed upload must not leave a product without images.
    const images = await Promise.all(listing.imageUrls.map(url => uploadImage(url, 'products/printables')));
    return db.tx(async t => {
        const product = await t.one(
            `INSERT INTO products (name, slug, description, short_description, price, category, stock, specifications, image_url)
             VALUES ($1, $2, $3, $4, $5, '3dprintables', $6, $7::jsonb, $8) RETURNING id`,
            [listing.name, slugify(listing.name), listing.description, listing.shortDescription, listing.price,
             MADE_TO_ORDER_STOCK, JSON.stringify(listing.specifications), images[0]]);
        for (let i = 0; i < images.length; i++) {
            await t.none('INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3)',
                [product.id, images[i], i]);
        }
        return product.id;
    });
}

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(url: string, folder: string) => Promise<string>} [opts.uploadImage]
 * @param {() => number} [opts.remainingMs]  Lambda's remaining time; Infinity locally.
 */
export async function runCatalogSync({
    fetchImpl = globalThis.fetch,
    uploadImage = storageService.uploadFromUrl,
    remainingMs = () => Infinity,
} = {}) {
    const skipped = {};
    const created = [];
    const failed = [];

    try {
        const restocked = await db.result(
            `UPDATE products SET stock = $1 WHERE stock < $1 AND specifications @> $2::jsonb`,
            [MADE_TO_ORDER_STOCK, JSON.stringify([MADE_TO_ORDER_SPEC])]);
        const summary = () => {
            const out = { created, skipped, failed, restocked: restocked.rowCount };
            log('catalog_sync_done', out);
            return out;
        };

        let cursor = null;
        for (let page = 0; page < MAX_PAGES && created.length < MAX_NEW_PER_RUN; page++) {
            if (remainingMs() < STOP_WHEN_REMAINING_MS + REQUEST_TIMEOUT_MS) {
                log('catalog_sync_out_of_time', { created: created.length });
                return summary();
            }
            const result = await fetchPage(fetchImpl, cursor);

            for (const item of result.items) {
                if (created.length >= MAX_NEW_PER_RUN) break;
                if (remainingMs() < STOP_WHEN_REMAINING_MS) {
                    log('catalog_sync_out_of_time', { created: created.length });
                    return summary();
                }

                const listing = toListing(item);
                if (listing.skip) { skipped[listing.skip] = (skipped[listing.skip] ?? 0) + 1; continue; }
                if (await alreadyImported(listing.sourceUrl)) { skipped.duplicate = (skipped.duplicate ?? 0) + 1; continue; }

                try {
                    const id = await createProduct(listing, uploadImage);
                    created.push({ id, name: listing.name, source: listing.sourceUrl, price: listing.price });
                } catch (err) {
                    // One bad model must not stop the run; it is logged and retried on the next run.
                    failed.push(listing.sourceUrl);
                    log('catalog_sync_item_failed', { source: listing.sourceUrl, error: err.message });
                }
            }

            if (!result.cursor) break;
            cursor = result.cursor;
        }

        return summary();
    } catch (err) {
        log('catalog_sync_failed', { error: err.message });
        throw err;
    } finally {
        if (created.length > 0) await triggerRebuild(fetchImpl);
    }
}

/** Asks Vercel to rebuild the site. Never fails the sync; every outcome is logged. */
async function triggerRebuild(fetchImpl) {
    const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
    if (!hook) return log('catalog_sync_rebuild_skipped', { reason: 'VERCEL_DEPLOY_HOOK_URL unset' });
    // The hook URL is a credential: validated, never logged.
    if (!DEPLOY_HOOK_RE.test(hook)) return log('catalog_sync_rebuild_skipped', { reason: 'VERCEL_DEPLOY_HOOK_URL is not a Vercel deploy hook' });
    try {
        const res = await fetchImpl(hook, { method: 'POST', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        log(res.ok ? 'catalog_sync_rebuild_triggered' : 'catalog_sync_rebuild_failed', { status: res.status });
    } catch (err) {
        log('catalog_sync_rebuild_failed', { error: err.message });
    }
}
