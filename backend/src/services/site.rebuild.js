/**
 * Asks Vercel to rebuild the frontend so product pages are prerendered again
 * with current names, prices and availability. Without a rebuild, crawlers see
 * the page as it was at the last build, and Google Merchant Center flags a
 * price that differs from the feed.
 *
 * Called by the catalog sync after it adds products and by admin product
 * changes. Given the changed page paths, it also announces them over IndexNow
 * (Bing, which ChatGPT search uses, plus Yandex, Seznam and others), so they
 * are recrawled in minutes instead of days.
 *
 * Never throws: a failed rebuild or announcement must not fail the caller.
 * Outcomes are logged as site_rebuild_* and indexnow_* events with a reason.
 */

// The hook URL is a credential (anyone holding it can trigger builds), so it
// is validated before use and never logged.
const DEPLOY_HOOK_RE = /^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[A-Za-z0-9_/-]+$/;
const REQUEST_TIMEOUT_MS = 5000;

// IndexNow keys are public by design: the protocol proves site ownership by
// serving this same value at /<key>.txt (public/01a76bc8....txt).
const INDEXNOW_KEY = '01a76bc8a5479ffb1bb864b0563ad890';
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

const log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

/**
 * @param {string} reason  what changed, for the log (e.g. 'admin_product_update')
 * @param {{ fetchImpl?: typeof fetch, paths?: string[] }} [opts]  paths: changed pages, e.g. '/product/desk-hook-ab12'
 */
export async function requestSiteRebuild(reason, { fetchImpl = globalThis.fetch, paths = [] } = {}) {
    await Promise.all([rebuild(reason, fetchImpl), announce(reason, paths, fetchImpl)]);
}

async function rebuild(reason, fetchImpl) {
    const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
    if (!hook) return log('site_rebuild_skipped', { reason, detail: 'VERCEL_DEPLOY_HOOK_URL unset' });
    if (!DEPLOY_HOOK_RE.test(hook)) return log('site_rebuild_skipped', { reason, detail: 'VERCEL_DEPLOY_HOOK_URL is not a Vercel deploy hook' });
    try {
        const res = await fetchImpl(hook, { method: 'POST', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        log(res.ok ? 'site_rebuild_triggered' : 'site_rebuild_failed', { reason, status: res.status });
    } catch (err) {
        log('site_rebuild_failed', { reason, error: err.message });
    }
}

async function announce(reason, paths, fetchImpl) {
    if (paths.length === 0) return;
    let origin;
    try { origin = new URL(process.env.FRONTEND_URL ?? ''); } catch { origin = null; }
    // Only the public https site is announced; never localhost or a preview.
    if (!origin || origin.protocol !== 'https:') return log('indexnow_skipped', { reason, detail: 'FRONTEND_URL is not an https URL' });
    const urlList = paths.map(p => new URL(p, origin).href);
    try {
        const res = await fetchImpl(INDEXNOW_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ host: origin.host, key: INDEXNOW_KEY, keyLocation: `${origin.origin}/${INDEXNOW_KEY}.txt`, urlList }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        log(res.ok ? 'indexnow_submitted' : 'indexnow_failed', { reason, status: res.status, urls: urlList.length });
    } catch (err) {
        log('indexnow_failed', { reason, error: err.message });
    }
}
