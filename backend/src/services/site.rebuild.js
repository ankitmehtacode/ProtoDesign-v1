/**
 * Asks Vercel to rebuild the frontend so product pages are prerendered again
 * with current names, prices and availability. Without a rebuild, crawlers see
 * the page as it was at the last build, and Google Merchant Center flags a
 * price that differs from the feed.
 *
 * Called by the catalog sync after it adds products and by admin product
 * changes. Never throws: a failed rebuild must not fail the caller. Each
 * outcome is logged as site_rebuild_{triggered,skipped,failed} with a reason.
 */

// The hook URL is a credential (anyone holding it can trigger builds), so it
// is validated before use and never logged.
const DEPLOY_HOOK_RE = /^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[A-Za-z0-9_/-]+$/;
const REQUEST_TIMEOUT_MS = 5000;

const log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

/**
 * @param {string} reason  what changed, for the log (e.g. 'admin_product_update')
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function requestSiteRebuild(reason, { fetchImpl = globalThis.fetch } = {}) {
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
