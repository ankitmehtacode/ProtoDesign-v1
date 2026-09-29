/*
 * Admin data model and every number the dashboard shows, as pure functions.
 * One definition per metric, so a figure means the same thing wherever it
 * appears (tiles, charts, tables, exports).
 *
 * Revenue counts confirmed orders only: an order reaches `processing` once
 * PhonePe's status API confirms payment (backend order.service.js), and moves
 * on to shipped/delivered/completed from there. `pending` and
 * `pending_payment` are the open pipeline (unpaid, or cash on delivery not
 * yet collected); `cancelled` is excluded everywhere.
 */

import { FileText, LayoutDashboard, MessageCircle, Package, ShoppingBag } from "lucide-react";

export type AdminSection = "overview" | "orders" | "quotes" | "products" | "whatsapp";

export const SECTIONS: { key: AdminSection; label: string; icon: typeof LayoutDashboard }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "orders", label: "Orders", icon: ShoppingBag },
    { key: "quotes", label: "Quotes", icon: FileText },
    { key: "products", label: "Products", icon: Package },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
];

export interface AdminProduct {
    id: string;
    name: string;
    description: string;
    price: number;
    stock: number;
    image_url: string | null;
    category: string;
    specifications?: Record<string, string> | Array<{ key: string; value: string }>;
    short_description?: string;
    sub_category?: string;
    video_url?: string | null;
    product_images?: Array<{ id: string; image_url?: string; image_data?: string; display_order: number }>;
    is_archived?: boolean;
    slug?: string;
}

export interface AdminQuote {
    id: string;
    email: string | null; // null for quotes sent as a file over WhatsApp
    source?: "web" | "whatsapp";
    phone: string;
    file_url: string;
    file_name: string;
    specifications: unknown;
    status: string;
    estimated_price: number;
    admin_notes: string;
    created_at: string;
}

export interface OrderItem {
    product_id: string;
    quantity: number;
    line_total: number;
    product?: { name?: string; image_url?: string };
}

export interface AdminOrder {
    id: string;
    total_amount: number;
    subtotal_amount?: number;
    tax_amount?: number;
    shipping_amount?: number;
    status: string;
    created_at: string;
    user_id: string;
    items: OrderItem[];
    shipping_address?: {
        fullName?: string; email?: string; phone?: string;
        address?: string; city?: string; state?: string; pincode?: string;
    } | null;
    user_email?: string;
    user_name?: string;
    payment_gateway?: string | null;
    payment_status?: string | null;
}

// --- Statuses ------------------------------------------------------------------

export type Tone = "neutral" | "amber" | "blue" | "violet" | "green" | "red";

export const ORDER_STATUSES: { value: string; label: string; tone: Tone }[] = [
    { value: "pending", label: "Pending", tone: "neutral" },
    { value: "pending_payment", label: "Awaiting payment", tone: "amber" },
    { value: "processing", label: "Processing", tone: "blue" },
    { value: "shipped", label: "Shipped", tone: "violet" },
    { value: "delivered", label: "Delivered", tone: "green" },
    { value: "completed", label: "Completed", tone: "green" },
    { value: "cancelled", label: "Cancelled", tone: "red" },
];

export const QUOTE_STATUSES: { value: string; label: string; tone: Tone }[] = [
    { value: "pending", label: "New", tone: "amber" },
    { value: "contacted", label: "Contacted", tone: "blue" },
    { value: "paid", label: "Paid", tone: "violet" },
    { value: "completed", label: "Completed", tone: "green" },
    { value: "rejected", label: "Rejected", tone: "red" },
];

/** Dot colour per tone (badges, pills, the status bar). */
export const TONE_DOT: Record<Tone, string> = {
    neutral: "bg-foreground/40", amber: "bg-amber-500", blue: "bg-sky-500",
    violet: "bg-violet-500", green: "bg-emerald-500", red: "bg-rose-500",
};

export const statusMeta = (list: typeof ORDER_STATUSES, value: string) =>
    list.find((s) => s.value === value) ?? { value, label: value, tone: "neutral" as Tone };

export const CONFIRMED = new Set(["processing", "shipped", "delivered", "completed"]);
export const OPEN = new Set(["pending", "pending_payment"]);
/** Orders a person has to act on: paid but not yet shipped. */
export const TO_FULFIL = new Set(["processing"]);

export const MAIN_CATEGORIES = [
    { value: "3d_printer", label: "3D printer" },
    { value: "3dprintables", label: "3D printable" },
    { value: "filament", label: "Filament" },
    { value: "resin", label: "Resin" },
    { value: "accessory", label: "Accessory" },
    { value: "spare_part", label: "Spare part" },
];

export const SUB_CATEGORIES: Record<string, string[]> = {
    "3d_printer": ["FDM", "SLA", "Metal", "3D Pen", "Others"],
    filament: ["ABS", "PETG", "PLA", "Carbon Fiber", "Nylon Fiber", "Others"],
    resin: ["Standard", "Water-Washable", "Tough", "Others"],
};

export const LOW_STOCK = 5;

// --- Periods ---------------------------------------------------------------------

export type PeriodKey = "7d" | "30d" | "90d" | "365d";
export const PERIODS: { key: PeriodKey; label: string; days: number }[] = [
    { key: "7d", label: "7 days", days: 7 },
    { key: "30d", label: "30 days", days: 30 },
    { key: "90d", label: "90 days", days: 90 },
    { key: "365d", label: "12 months", days: 365 },
];

const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** [start, end) of the current period and the one before it, ending now. */
export function periodWindows(days: number, now = Date.now()) {
    const end = now;
    const start = startOfDay(now) - (days - 1) * DAY;
    return { current: [start, end] as const, previous: [start - days * DAY, start] as const };
}

const inWindow = (iso: string, [a, b]: readonly [number, number]) => {
    const t = new Date(iso).getTime();
    return t >= a && t < b;
};

// --- Metrics ---------------------------------------------------------------------

export const money = (n: unknown) => Number(n) || 0;

export function summarise(orders: AdminOrder[], quotes: AdminQuote[], days: number, now = Date.now()) {
    const { current, previous } = periodWindows(days, now);
    const calc = (win: readonly [number, number]) => {
        const inPeriod = orders.filter((o) => inWindow(o.created_at, win));
        const confirmed = inPeriod.filter((o) => CONFIRMED.has(o.status));
        const revenue = confirmed.reduce((s, o) => s + money(o.total_amount), 0);
        const customers = new Set(confirmed.map((o) => o.user_id)).size;
        const quoteCount = quotes.filter((q) => inWindow(q.created_at, win)).length;
        const quoteWon = quotes.filter((q) => inWindow(q.created_at, win) && (q.status === "paid" || q.status === "completed")).length;
        return {
            revenue,
            orders: confirmed.length,
            aov: confirmed.length ? revenue / confirmed.length : 0,
            customers,
            cancelled: inPeriod.filter((o) => o.status === "cancelled").length,
            placed: inPeriod.length,
            quotes: quoteCount,
            quoteWinRate: quoteCount ? quoteWon / quoteCount : 0,
        };
    };
    return { current: calc(current), previous: calc(previous) };
}

/** Relative change, or null when there's nothing to compare with. */
export const delta = (now: number, before: number) => (before > 0 ? (now - before) / before : null);

/** Confirmed revenue and order count per day across the period (every day present, zeros included). */
export function dailySeries(orders: AdminOrder[], days: number, now = Date.now()) {
    const { current } = periodWindows(days, now);
    const buckets = new Map<number, { revenue: number; orders: number }>();
    for (let t = current[0]; t < current[1]; t += DAY) buckets.set(startOfDay(t), { revenue: 0, orders: 0 });
    for (const o of orders) {
        if (!CONFIRMED.has(o.status) || !inWindow(o.created_at, current)) continue;
        const b = buckets.get(startOfDay(new Date(o.created_at).getTime()));
        if (b) { b.revenue += money(o.total_amount); b.orders += 1; }
    }
    return [...buckets.entries()].map(([t, v]) => ({
        date: t,
        label: new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        ...v,
    }));
}

export function statusBreakdown(orders: AdminOrder[], days: number, now = Date.now()) {
    const { current } = periodWindows(days, now);
    const counts = new Map<string, number>();
    for (const o of orders) if (inWindow(o.created_at, current)) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    return ORDER_STATUSES.map((s) => ({ ...s, count: counts.get(s.value) ?? 0 })).filter((s) => s.count > 0);
}

/** Best sellers by confirmed revenue in the period. */
export function topProducts(orders: AdminOrder[], days: number, limit = 5, now = Date.now()) {
    const { current } = periodWindows(days, now);
    const acc = new Map<string, { id: string; name: string; image?: string; units: number; revenue: number }>();
    for (const o of orders) {
        if (!CONFIRMED.has(o.status) || !inWindow(o.created_at, current)) continue;
        for (const it of o.items ?? []) {
            const row = acc.get(it.product_id) ?? { id: it.product_id, name: it.product?.name ?? "Unknown product", image: it.product?.image_url, units: 0, revenue: 0 };
            row.units += Number(it.quantity) || 0;
            row.revenue += money(it.line_total);
            acc.set(it.product_id, row);
        }
    }
    return [...acc.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

export function categoryRevenue(orders: AdminOrder[], products: AdminProduct[], days: number, now = Date.now()) {
    const { current } = periodWindows(days, now);
    const catOf = new Map(products.map((p) => [p.id, p.category]));
    const acc = new Map<string, number>();
    for (const o of orders) {
        if (!CONFIRMED.has(o.status) || !inWindow(o.created_at, current)) continue;
        for (const it of o.items ?? []) {
            const cat = catOf.get(it.product_id) ?? "other";
            acc.set(cat, (acc.get(cat) ?? 0) + money(it.line_total));
        }
    }
    const label = (v: string) => MAIN_CATEGORIES.find((c) => c.value === v)?.label ?? "Other";
    return [...acc.entries()].map(([k, v]) => ({ key: k, label: label(k), revenue: v })).sort((a, b) => b.revenue - a.revenue);
}

export const stockState = (p: AdminProduct) =>
    p.is_archived ? "archived" : p.stock <= 0 ? "out" : p.stock < LOW_STOCK ? "low" : "ok";

// --- Formatting ------------------------------------------------------------------

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export const customerName = (o: AdminOrder) => o.shipping_address?.fullName || o.user_name || o.user_email || "Customer";

export function relativeTime(iso: string, now = Date.now()) {
    const s = Math.round((now - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24); if (d < 30) return `${d} d ago`;
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** A CSV download of rows, with every cell quoted (spreadsheet-safe). */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
    const cell = (v: string | number) => {
        let s = String(v ?? "");
        if (/^[=+\-@]/.test(s)) s = `'${s}`; // no formula injection when opened in Excel/Sheets
        return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
