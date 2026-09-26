// runCatalogSync against a real Postgres, with Printables and Cloudinary
// stubbed. Covers the license gate, the skip rules, idempotency, the per-run
// cap, restocking and failure handling.
//
//   tsx --test test/catalog.sync.test.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTempPostgres } from './helpers/temp-postgres.mjs';

const pg = await startTempPostgres();
process.env.DATABASE_URL = pg.url;

const { runCatalogSync, MADE_TO_ORDER_STOCK, priceFor } = await import('../src/services/catalog.sync.js');
const { default: db, pgp } = await import('../src/config/database.js');

const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const level of ['log', 'warn', 'error']) console[level] = () => {};

after(async () => {
    Object.assign(console, realConsole);
    await pgp.end();
    pg.stop();
});

beforeEach(() => db.none('TRUNCATE products CASCADE'));

let nextId = 1000;
const model = (overrides = {}) => {
    const id = String(nextId++);
    return {
        id, name: `Cable clip ${id}`, slug: `cable-clip-${id}`, summary: 'Keeps desk cables tidy.', nsfw: false,
        weight: '20.00', printDuration: '1.10', materials: [{ name: 'PLA' }], tags: [{ name: 'desk' }],
        license: { id: '1' }, user: { publicUsername: 'Maker' },
        images: [{ filePath: `media/prints/${id}/images/photo.jpg` }],
        ...overrides,
    };
};

const HOOK = 'https://api.vercel.com/v1/integrations/deploy/prj_test/abc123';

/** A fetch stub serving the given Printables pages in order, recording each request. */
const printables = (...pages) => {
    const calls = [];
    const hookCalls = [];
    const fetchImpl = async (url, init) => {
        if (url === HOOK) { hookCalls.push(init.method); return { ok: true, status: 201 }; }
        calls.push(JSON.parse(init.body));
        const items = pages[calls.length - 1] ?? [];
        const cursor = calls.length < pages.length ? `c${calls.length}` : null;
        return { ok: true, json: async () => ({ data: { morePrints: { cursor, items } } }) };
    };
    return { fetchImpl, calls, hookCalls };
};

const uploads = [];
const uploadImage = async (url) => { uploads.push(url); return `https://res.cloudinary.com/demo/image/upload/${uploads.length}.jpg`; };

const specsOf = (p) => Object.fromEntries(p.specifications.map(s => [s.key, s.value]));

describe('runCatalogSync', () => {
    it('imports a licensed model as a made-to-order product with attribution', async () => {
        const m = model();
        const { fetchImpl, calls } = printables([m]);
        const result = await runCatalogSync({ fetchImpl, uploadImage });

        assert.equal(result.created.length, 1);
        assert.deepEqual(calls[0].variables.licenses, ['7', '1', '2', '8', '15', '14']);

        const p = await db.one('SELECT * FROM products');
        assert.equal(p.category, '3dprintables');
        assert.equal(p.stock, MADE_TO_ORDER_STOCK);
        assert.equal(Number(p.price), priceFor(20));
        assert.match(p.image_url, /^https:\/\/res\.cloudinary\.com\//);
        const specs = specsOf(p);
        assert.equal(specs.Fulfilment, 'Made to order');
        assert.equal(specs.License, 'CC BY 4.0');
        assert.equal(specs.Designer, 'Maker');
        assert.equal(specs.Source, `https://www.printables.com/model/${m.id}-${m.slug}`);
        assert.match(p.description, /by Maker, published on Printables under CC BY 4\.0/);
        // Own copy first; the designer's text is only quoted, so the page is not a duplicate.
        assert.match(p.description, new RegExp(`^${m.name}, 3D printed to order in PLA at our workshop in Indore`));
        assert.match(p.description, /From the designer: "Keeps desk cables tidy\."/);
        assert.equal(p.short_description, '3D printed to order in PLA in Indore, about 20 g.');
        assert.equal((await db.one('SELECT count(*)::int AS n FROM product_images WHERE product_id = $1', [p.id])).n, 1);
    });

    it('skips unlicensed, blocked, unpriced, unsupported and AI-illustrated models', async () => {
        const { fetchImpl } = printables([
            model({ license: { id: '3' } }),                                    // CC BY-NC
            model({ name: 'Pikachu planter' }),
            model({ name: 'LEGO Batmobile set' }),
            model({ weight: null }),
            model({ weight: '0.00' }),
            model({ materials: [{ name: 'TPU' }] }),
            model({ nsfw: true }),
            model({ images: [{ filePath: 'media/prints/1/images/chatgpt-image-1.png' }] }),
            model({ images: [{ filePath: 'https://evil.example/x.jpg' }] }),
            model({ slug: '../../admin' }),
        ]);
        const result = await runCatalogSync({ fetchImpl, uploadImage });

        assert.equal(result.created.length, 0);
        assert.deepEqual(result.skipped, {
            license: 1, blocked_term: 2, weight: 2, material: 1, nsfw: 1, no_image: 2, malformed: 1,
        });
        assert.equal((await db.one('SELECT count(*)::int AS n FROM products')).n, 0);
    });

    it('imports large, long prints and LEGO-compatible parts', async () => {
        const result = await runCatalogSync({ ...printables([
            model({ weight: '1800.00', printDuration: '60.00' }),
            model({ name: 'Wheel hub compatible with LEGO Technic' }),
        ]), uploadImage });
        assert.equal(result.created.length, 2);
        assert.equal(result.created[0].price, priceFor(1800));
    });

    it('never imports the same model twice, even after an admin archives it', async () => {
        const m = model();
        await runCatalogSync({ ...printables([m]), uploadImage });
        await db.none('UPDATE products SET is_archived = true');

        const again = await runCatalogSync({ ...printables([m]), uploadImage });
        assert.equal(again.created.length, 0);
        assert.equal(again.skipped.duplicate, 1);
    });

    it('adds at most 5 products per run, across pages', async () => {
        const { fetchImpl, calls } = printables([model(), model(), model()], [model(), model(), model()], [model()]);
        const result = await runCatalogSync({ fetchImpl, uploadImage });
        assert.equal(result.created.length, 5);
        assert.equal(calls.length, 2);
    });

    it('restores the stock of made-to-order products', async () => {
        await runCatalogSync({ ...printables([model()]), uploadImage });
        await db.none('UPDATE products SET stock = 1');
        const result = await runCatalogSync({ ...printables([]), uploadImage });
        assert.equal(result.restocked, 1);
        assert.equal((await db.one('SELECT stock FROM products')).stock, MADE_TO_ORDER_STOCK);
    });

    it('records a failed image upload and carries on with the next model', async () => {
        const bad = model();
        let first = true;
        const flaky = async (url) => {
            if (first) { first = false; throw new Error('cloudinary down'); }
            return uploadImage(url);
        };
        const result = await runCatalogSync({ ...printables([bad, model()]), uploadImage: flaky });
        assert.equal(result.created.length, 1);
        assert.deepEqual(result.failed, [`https://www.printables.com/model/${bad.id}-${bad.slug}`]);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM products')).n, 1);
    });

    it('fails loudly and writes nothing when Printables changes its response', async () => {
        const fetchImpl = async () => ({ ok: true, json: async () => ({ errors: [{ message: 'Unknown field' }] }) });
        await assert.rejects(runCatalogSync({ fetchImpl, uploadImage }), /Unexpected Printables response/);
        assert.equal((await db.one('SELECT count(*)::int AS n FROM products')).n, 0);
    });

    it('triggers a site rebuild only when products were added and the hook is valid', async () => {
        const saved = process.env.VERCEL_DEPLOY_HOOK_URL;
        try {
            process.env.VERCEL_DEPLOY_HOOK_URL = HOOK;
            const added = printables([model()]);
            await runCatalogSync({ fetchImpl: added.fetchImpl, uploadImage });
            assert.deepEqual(added.hookCalls, ['POST']);

            const nothingNew = printables([]);
            await runCatalogSync({ fetchImpl: nothingNew.fetchImpl, uploadImage });
            assert.deepEqual(nothingNew.hookCalls, []);

            process.env.VERCEL_DEPLOY_HOOK_URL = 'https://evil.example/steal';
            const badHook = printables([model()]);
            await runCatalogSync({ fetchImpl: badHook.fetchImpl, uploadImage });
            assert.deepEqual(badHook.hookCalls, []);
        } finally {
            if (saved === undefined) delete process.env.VERCEL_DEPLOY_HOOK_URL; else process.env.VERCEL_DEPLOY_HOOK_URL = saved;
        }
    });

    it('stops before the Lambda deadline', async () => {
        const { fetchImpl, calls } = printables([model()]);
        const result = await runCatalogSync({ fetchImpl, uploadImage, remainingMs: () => 1000 });
        assert.equal(calls.length, 0);
        assert.equal(result.created.length, 0);
    });
});
