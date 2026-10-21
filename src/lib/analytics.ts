import { API_URL, apiService } from "@/services/api.service";

/*
 * First-party visit tracking (docs/lead-tracking.md). Nothing leaves the
 * browser until the visitor accepts analytics in the consent banner. Then
 * events are batched and sent with navigator.sendBeacon, as text/plain so no
 * CORS preflight is needed and the last batch survives the tab closing.
 *
 * Every storage access is guarded: with storage blocked, the visitor is
 * simply treated as not having consented.
 */

export type Consent = "granted" | "denied";
export type TrackedEvent = "page_view" | "product_view" | "add_to_cart" | "quote_start";

const CONSENT_KEY = "pd_analytics_consent";
const VISITOR_KEY = "pd_visitor_id";
const IDENTIFIED_KEY = "pd_visitor_identified";
const FLUSH_MS = 5_000;
const MAX_BATCH = 20; // the server's limit per request

const read = (store: () => Storage, key: string) => {
    try { return store().getItem(key); } catch { return null; }
};
const write = (store: () => Storage, key: string, value: string) => {
    try { store().setItem(key, value); return true; } catch { return false; }
};

// How this tab arrived: the URL and referrer of the first page loaded. Held in
// memory only, and sent only with the first batch after consent.
const landing = (() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    let referrerHost: string | null = null;
    try {
        const host = document.referrer ? new URL(document.referrer).hostname : "";
        referrerHost = host && host !== window.location.hostname ? host : null;
    } catch { /* malformed referrer: treat as direct */ }
    const pick = (k: string) => params.get(k) || undefined;
    return {
        utm_source: pick("utm_source"), utm_medium: pick("utm_medium"), utm_campaign: pick("utm_campaign"),
        utm_term: pick("utm_term"), gclid: pick("gclid"),
        referrer_host: referrerHost ?? undefined,
        // Path only: a query string can hold secrets (a password-reset token).
        landing_path: window.location.pathname,
    };
})();

let queue: { name: TrackedEvent; path?: string; productId?: string }[] = [];
let attributionSent = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(c: Consent | null) => void>();

export const getConsent = (): Consent | null => {
    const v = read(() => localStorage, CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
};

export function setConsent(value: Consent) {
    if (value === "denied") {
        // Withdrawing is as complete as granting: what was recorded from this
        // browser is deleted on the server, not just forgotten here.
        const id = read(() => localStorage, VISITOR_KEY);
        if (id) {
            const body = new Blob([JSON.stringify({ visitorId: id })], { type: "text/plain" });
            if (!navigator.sendBeacon?.(`${API_URL}/track/forget`, body)) {
                fetch(`${API_URL}/track/forget`, { method: "POST", body, keepalive: true, credentials: "omit" })
                    .catch((e) => console.warn("Tracking delete request failed", e));
            }
        }
        queue = [];
        attributionSent = false;
        try {
            localStorage.removeItem(VISITOR_KEY);
            localStorage.removeItem(IDENTIFIED_KEY);
        } catch { /* nothing stored */ }
    }
    write(() => localStorage, CONSENT_KEY, value);
    listeners.forEach((fn) => fn(value));
}

/** Shows the consent notice again (footer "Analytics preferences"). */
export function reopenConsent() {
    try { localStorage.removeItem(CONSENT_KEY); } catch { /* storage blocked: the notice shows anyway */ }
    listeners.forEach((fn) => fn(null));
}

export function onConsentChange(fn: (c: Consent | null) => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/** The visitor id, created on first use. Null without consent. */
export function visitorId(): string | null {
    if (getConsent() !== "granted") return null;
    const existing = read(() => localStorage, VISITOR_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    return write(() => localStorage, VISITOR_KEY, id) ? id : null;
}

/** The queue as request bodies, emptying it. The first carries this tab's attribution. */
function takeBatches(): Blob[] {
    if (timer) { clearTimeout(timer); timer = null; }
    const id = visitorId();
    if (!id) { queue = []; return []; }
    const batches: Blob[] = [];
    while (queue.length > 0) {
        const events = queue.splice(0, MAX_BATCH);
        const body = JSON.stringify({ visitorId: id, events, attribution: attributionSent ? undefined : landing });
        attributionSent = true;
        batches.push(new Blob([body], { type: "text/plain" }));
    }
    return batches;
}

const post = (body: Blob) =>
    fetch(`${API_URL}/track`, { method: "POST", body, keepalive: true, credentials: "omit" });

/** Sends whatever is queued as beacons, which survive the page closing. */
function flush() {
    for (const blob of takeBatches()) {
        if (!navigator.sendBeacon?.(`${API_URL}/track`, blob)) {
            // Beacon refused (queue full or unsupported): a plain request still
            // arrives unless the page is closing.
            post(blob).catch((e) => console.warn("Tracking request failed", e));
        }
    }
}

/**
 * Sends whatever is queued and waits for the server to store it. Used before
 * a request the server timestamps (an enquiry), so the views that led to it
 * come first in the lead's journey -- a beacon gives no such ordering. Never
 * rejects: tracking must not stop the enquiry.
 */
export async function flushAndWait() {
    await Promise.all(takeBatches().map((blob) =>
        post(blob).catch((e) => console.warn("Tracking request failed", e))));
}

export function track(name: TrackedEvent, data: { path?: string; productId?: string } = {}) {
    if (getConsent() !== "granted") return;
    queue.push({ name, path: data.path ?? window.location.pathname, productId: data.productId });
    if (queue.length >= MAX_BATCH) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Links this browser's visits to the signed-in account, once per browser. */
export async function identify() {
    const id = visitorId();
    const token = apiService.getToken();
    if (!id || !token || read(() => localStorage, IDENTIFIED_KEY) === id) return;
    try {
        // Not apiService.request: on a stale token that sends the visitor to
        // the login page, which a background call must never do.
        const res = await fetch(`${API_URL}/track/identify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ visitorId: id }),
        });
        if (res.ok) write(() => localStorage, IDENTIFIED_KEY, id);
    } catch (e) {
        console.warn("Visitor identify failed", e);
    }
}

if (typeof window !== "undefined") {
    // Send what is queued when the tab is hidden: the last moment a mobile
    // browser reliably lets a page talk to the network.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);
}
