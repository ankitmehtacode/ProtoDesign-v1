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
    active: FestivalSale | null;
    next: FestivalSale | null;
}

// One request per page load, shared by every banner and product page.
let pending: Promise<FestivalStatus | null> | null = null;
const load = () => (pending ??= apiService.getFestival().catch((error: unknown) => {
    console.error('Failed to load festival sale', error);
    pending = null; // let the next mount retry
    return null;
}));

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
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!endsAt) return;
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [endsAt]);
    if (!endsAt) return null;
    const left = Math.floor((new Date(endsAt).getTime() - now) / 1000);
    if (left <= 0) return null;
    return { d: Math.floor(left / 86400), h: Math.floor(left / 3600) % 24, m: Math.floor(left / 60) % 60, s: left % 60 };
}

/** "21 Oct" in IST, the timezone the sale dates are set in. */
export const saleDay = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
