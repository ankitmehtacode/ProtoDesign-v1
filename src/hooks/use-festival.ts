import { useEffect, useState } from 'react';
import { apiService } from '@/services/api.service';

export interface FestivalSale {
    id: string;
    name: string;
    percent_off: number;
    category: string;
    starts_at: string;
    ends_at: string;
}

export interface FestivalStatus {
    now: string;
    active: FestivalSale | null;
    next: FestivalSale | null;
}

// Server time minus this device's time. Deadlines are the server's, so a phone
// with a wrong clock must still count down to the moment prices really change.
let clockOffsetMs = 0;
export const serverNow = () => Date.now() + clockOffsetMs;

// One request per page load, shared by every banner and product page.
let pending: Promise<FestivalStatus | null> | null = null;
const load = () => (pending ??= apiService.getFestival().then((status: FestivalStatus) => {
    const server = Date.parse(status.now);
    if (Number.isFinite(server)) clockOffsetMs = server - Date.now();
    scheduleReloadAt(status.active?.ends_at);
    return status;
}).catch((error: unknown) => {
    console.error('Failed to load festival sale', error);
    pending = null; // let the next mount retry
    return null;
}));

/**
 * When the running sale ends, every price on the page is out of date: the
 * server already charges the new one. Reload rather than keep advertising a
 * sale that is over. Checkout does not rely on this; the server refuses an
 * order whose total the shopper was not shown.
 */
let reloadTimer: number | undefined;
function scheduleReloadAt(endsAt: string | undefined) {
    if (!endsAt || reloadTimer !== undefined) return;
    const wait = Date.parse(endsAt) - serverNow() + 1500;
    // setTimeout overflows past ~24.8 days; a tab open that long reloads on its next navigation anyway.
    if (wait > 0 && wait < 2 ** 31 - 1) reloadTimer = window.setTimeout(() => window.location.reload(), wait);
}

/** The running and upcoming festival sale, from the server's schedule. */
export function useFestival(): FestivalStatus | null {
    const [status, setStatus] = useState<FestivalStatus | null>(null);
    useEffect(() => {
        let cancelled = false;
        load().then((s) => { if (!cancelled) setStatus(s); });
        return () => { cancelled = true; };
    }, []);
    return status;
}

/**
 * Time left until `endsAt`, ticking each second; null once it has passed. The
 * deadline is the server's: when it passes, prices really change.
 */
export function useCountdown(endsAt: string | undefined): { d: number; h: number; m: number; s: number } | null {
    const [now, setNow] = useState(serverNow);
    useEffect(() => {
        if (!endsAt) return;
        const id = window.setInterval(() => setNow(serverNow()), 1000);
        return () => window.clearInterval(id);
    }, [endsAt]);
    if (!endsAt) return null;
    const left = Math.floor((new Date(endsAt).getTime() - now) / 1000);
    if (left <= 0) return null;
    return { d: Math.floor(left / 86400), h: Math.floor(left / 3600) % 24, m: Math.floor(left / 60) % 60, s: left % 60 };
}

/** "6d 4h" while days remain, then "4h 3m 2s": precise only when it matters. */
export const shortLeft = (left: { d: number; h: number; m: number; s: number }) =>
    left.d > 0 ? `${left.d}d ${left.h}h` : `${left.h}h ${left.m}m ${left.s}s`;

/** "21 Oct" in IST, the timezone the sale dates are set in. */
export const saleDay = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
