import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, FileText, IndianRupee, PackageCheck, ShoppingBag, Users, XCircle } from "lucide-react";
import { formatINR } from "@/lib/currency";
import {
    AdminOrder, AdminProduct, AdminQuote, AdminSection, ORDER_STATUSES, TONE_DOT, PERIODS, PeriodKey, TO_FULFIL,
    categoryRevenue, customerName, dailySeries, delta, relativeTime, shortId, statusBreakdown,
    statusMeta, stockState, summarise, topProducts,
} from "./model";
import { Empty, FilterPills, Kpi, PageHeader, Panel, StatusBadge } from "./ui";

const INK = "hsl(152 55% 36%)";

const compactINR = (n: number) =>
    n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(0)}k` : `₹${Math.round(n)}`;

export function Overview({ orders, quotes, products, go }: {
    orders: AdminOrder[]; quotes: AdminQuote[]; products: AdminProduct[];
    go: (section: AdminSection, filter?: string) => void;
}) {
    const [period, setPeriod] = useState<PeriodKey>("30d");
    const days = PERIODS.find((p) => p.key === period)!.days;

    const { current: now, previous: before } = useMemo(() => summarise(orders, quotes, days), [orders, quotes, days]);
    const series = useMemo(() => dailySeries(orders, days), [orders, days]);
    const statuses = useMemo(() => statusBreakdown(orders, days), [orders, days]);
    const best = useMemo(() => topProducts(orders, days), [orders, days]);
    const byCategory = useMemo(() => categoryRevenue(orders, products, days), [orders, products, days]);

    const attention = [
        { label: "Orders to ship", hint: "Paid, not yet shipped", count: orders.filter((o) => TO_FULFIL.has(o.status)).length, go: () => go("orders", "processing"), icon: PackageCheck },
        { label: "Awaiting payment", hint: "Placed, payment not confirmed", count: orders.filter((o) => o.status === "pending_payment" || o.status === "pending").length, go: () => go("orders", "open"), icon: ShoppingBag },
        { label: "New quote requests", hint: "Not contacted yet", count: quotes.filter((q) => q.status === "pending").length, go: () => go("quotes", "pending"), icon: FileText },
        { label: "Out of stock", hint: "Live listings at zero", count: products.filter((p) => stockState(p) === "out").length, go: () => go("products", "out"), icon: XCircle },
        { label: "Low stock", hint: "Fewer than 5 left", count: products.filter((p) => stockState(p) === "low").length, go: () => go("products", "low"), icon: AlertTriangle },
    ];

    const statusTotal = statuses.reduce((s, x) => s + x.count, 0);
    const catTotal = byCategory.reduce((s, x) => s + x.revenue, 0);
    const recent = orders.slice(0, 6);
    const periodLabel = PERIODS.find((p) => p.key === period)!.label;

    return (
        <>
            <PageHeader
                title="Overview"
                description={`Confirmed sales for the last ${periodLabel}, compared with the ${periodLabel} before.`}
                actions={<FilterPills<PeriodKey> value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.key, label: p.label }))} />}
            />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                <Kpi label="Revenue" value={formatINR(now.revenue)} change={delta(now.revenue, before.revenue)} hint="vs previous" icon={<IndianRupee className="h-4 w-4" />} />
                <Kpi label="Orders" value={String(now.orders)} change={delta(now.orders, before.orders)} hint="confirmed" icon={<ShoppingBag className="h-4 w-4" />} />
                <Kpi label="Avg. order value" value={formatINR(now.aov)} change={delta(now.aov, before.aov)} />
                <Kpi label="Customers" value={String(now.customers)} change={delta(now.customers, before.customers)} hint="who paid" icon={<Users className="h-4 w-4" />} />
                <Kpi label="Quote requests" value={String(now.quotes)} change={delta(now.quotes, before.quotes)} hint={`${Math.round(now.quoteWinRate * 100)}% won`} icon={<FileText className="h-4 w-4" />} />
                <Kpi label="Cancellations" value={String(now.cancelled)} change={delta(now.cancelled, before.cancelled)} hint={now.placed ? `${Math.round((now.cancelled / now.placed) * 100)}% of placed` : undefined} invert />
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <Panel title="Revenue" description={`Confirmed orders per day · ${formatINR(now.revenue)} total`} className="xl:col-span-2">
                    <div className="h-72 px-2 pb-3 pt-4">
                        {now.revenue === 0 ? (
                            <Empty title="No confirmed sales in this period" body="Revenue appears here once PhonePe confirms a payment." />
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={series} margin={{ left: 4, right: 12, top: 4, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="rev" x1="0" x2="0" y1="0" y2="1">
                                            <stop offset="0" stopColor={INK} stopOpacity={0.28} />
                                            <stop offset="1" stopColor={INK} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={24} stroke="hsl(var(--muted-foreground))" />
                                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tickFormatter={compactINR} stroke="hsl(var(--muted-foreground))" />
                                    <Tooltip
                                        cursor={{ stroke: "hsl(var(--border))" }}
                                        contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                                        formatter={(v: number, name) => [name === "revenue" ? formatINR(v) : v, name === "revenue" ? "Revenue" : "Orders"]}
                                    />
                                    <Area type="monotone" dataKey="revenue" stroke={INK} strokeWidth={2} fill="url(#rev)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </Panel>

                <Panel title="Needs attention" description="Right now, across all time">
                    <ul className="divide-y">
                        {attention.map((a) => (
                            <li key={a.label}>
                                <button type="button" onClick={a.go} className="group flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50">
                                    <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${a.count ? "bg-amber-500/10 text-amber-300" : "bg-muted text-muted-foreground"}`}>
                                        <a.icon className="h-4 w-4" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium">{a.label}</span>
                                        <span className="block text-xs text-muted-foreground">{a.hint}</span>
                                    </span>
                                    <span className={`font-display text-lg font-bold tabular-nums ${a.count ? "" : "text-muted-foreground"}`}>{a.count}</span>
                                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </Panel>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <Panel title="Orders by status" description={`${statusTotal} placed in the period`}>
                    {statusTotal === 0 ? <Empty title="No orders in this period" /> : (
                        <div className="space-y-3 p-5">
                            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                                {statuses.map((s) => (
                                    <div key={s.value} className={TONE_DOT[s.tone]} style={{ width: `${(s.count / statusTotal) * 100}%` }} title={`${s.label}: ${s.count}`} />
                                ))}
                            </div>
                            <ul className="space-y-2 text-sm">
                                {statuses.map((s) => (
                                    <li key={s.value} className="flex items-center justify-between">
                                        <StatusBadge label={s.label} tone={s.tone} />
                                        <span className="tabular-nums text-muted-foreground">
                                            <span className="font-medium text-foreground">{s.count}</span> · {Math.round((s.count / statusTotal) * 100)}%
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Panel>

                <Panel title="Top products" description="By confirmed revenue">
                    {best.length === 0 ? <Empty title="No sales yet in this period" /> : (
                        <ol className="divide-y">
                            {best.map((p, i) => (
                                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                                    <span className="w-4 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                                    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md border bg-card">
                                        {p.image && <img src={p.image} alt="" className="h-full w-full object-contain" loading="lazy" />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{p.name}</span>
                                        <span className="block text-xs text-muted-foreground">{p.units} sold</span>
                                    </span>
                                    <span className="text-sm font-semibold tabular-nums">{formatINR(p.revenue)}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                </Panel>

                <Panel title="Revenue by category" description="Confirmed line items">
                    {catTotal === 0 ? <Empty title="No sales yet in this period" /> : (
                        <ul className="space-y-3.5 p-5">
                            {byCategory.map((c) => (
                                <li key={c.key}>
                                    <div className="flex justify-between text-sm">
                                        <span>{c.label}</span>
                                        <span className="tabular-nums text-muted-foreground">{formatINR(c.revenue)}</span>
                                    </div>
                                    <div className="mt-1.5 h-1.5 rounded-full bg-muted">
                                        <div className="h-full rounded-full" style={{ width: `${(c.revenue / catTotal) * 100}%`, backgroundColor: INK }} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
            </div>

            <Panel
                title="Latest orders"
                className="mt-4"
                action={<button type="button" onClick={() => go("orders")} className="text-xs font-medium text-foreground/70 hover:text-foreground">View all</button>}
            >
                {recent.length === 0 ? <Empty title="No orders yet" /> : (
                    <ul className="divide-y">
                        {recent.map((o) => {
                            const s = statusMeta(ORDER_STATUSES, o.status);
                            return (
                                <li key={o.id}>
                                    <button type="button" onClick={() => go("orders", `id:${o.id}`)} className="flex w-full items-center gap-4 px-5 py-3 text-left text-sm hover:bg-muted/50">
                                        <span className="w-20 font-mono text-xs text-muted-foreground">#{shortId(o.id)}</span>
                                        <span className="min-w-0 flex-1 truncate font-medium">{customerName(o)}</span>
                                        <span className="hidden w-28 sm:block"><StatusBadge label={s.label} tone={s.tone} /></span>
                                        <span className="hidden w-24 text-right text-xs text-muted-foreground md:block">{relativeTime(o.created_at)}</span>
                                        <span className="w-24 text-right font-semibold tabular-nums">{formatINR(o.total_amount)}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Panel>
        </>
    );
}
