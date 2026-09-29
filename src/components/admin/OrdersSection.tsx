import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Check, Copy, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { apiService } from "@/services/api.service";
import { formatINR } from "@/lib/currency";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    AdminOrder, OPEN, ORDER_STATUSES, customerName, downloadCsv, formatDate, money, relativeTime, shortId, statusMeta,
} from "./model";
import { Empty, FilterPills, PageHeader, StatusBadge } from "./ui";

const PAGE = 20;
type Range = "all" | "7" | "30" | "90" | "custom";
type SortKey = "created_at" | "total_amount";

/** Status filter; "open" groups the two unpaid states the way the overview counts them. */
const matchesStatus = (o: AdminOrder, f: string) => (f === "all" ? true : f === "open" ? OPEN.has(o.status) : o.status === f);

export function OrdersSection({ orders, initialFilter, onChanged }: {
    orders: AdminOrder[]; initialFilter?: string; onChanged: (id: string, status: string) => void;
}) {
    const [status, setStatus] = useState("all");
    const [q, setQ] = useState("");
    const [range, setRange] = useState<Range>("all");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created_at", dir: -1 });
    const [page, setPage] = useState(1);
    const [openId, setOpenId] = useState<string | null>(null);

    // Arriving from the overview: "processing", "open" or "id:<order id>".
    useEffect(() => {
        if (!initialFilter) return;
        if (initialFilter.startsWith("id:")) setOpenId(initialFilter.slice(3));
        else setStatus(initialFilter);
    }, [initialFilter]);

    const inDates = useMemo(() => {
        const now = Date.now();
        return orders.filter((o) => {
            const t = new Date(o.created_at).getTime();
            if (range === "custom") {
                if (from && t < new Date(from).setHours(0, 0, 0, 0)) return false;
                if (to && t > new Date(to).setHours(23, 59, 59, 999)) return false;
                return true;
            }
            return range === "all" || t >= now - Number(range) * 86_400_000;
        });
    }, [orders, range, from, to]);

    const searched = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return inDates;
        return inDates.filter((o) =>
            [o.id, customerName(o), o.user_email, o.shipping_address?.email, o.shipping_address?.phone, ...(o.items ?? []).map((i) => i.product?.name)]
                .some((v) => v && String(v).toLowerCase().includes(needle)),
        );
    }, [inDates, q]);

    const counts = useMemo(() => {
        const c: Record<string, number> = { all: searched.length, open: 0 };
        for (const o of searched) {
            c[o.status] = (c[o.status] ?? 0) + 1;
            if (OPEN.has(o.status)) c.open += 1;
        }
        return c;
    }, [searched]);

    const rows = useMemo(() => {
        const list = searched.filter((o) => matchesStatus(o, status));
        const val = (o: AdminOrder) => (sort.key === "created_at" ? new Date(o.created_at).getTime() : money(o.total_amount));
        return [...list].sort((a, b) => (val(a) - val(b)) * sort.dir);
    }, [searched, status, sort]);

    useEffect(() => setPage(1), [status, q, range, from, to]);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    const visible = rows.slice((page - 1) * PAGE, page * PAGE);
    const total = rows.reduce((s, o) => s + money(o.total_amount), 0);

    const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }));

    const exportCsv = () =>
        downloadCsv(`orders-${new Date().toISOString().slice(0, 10)}.csv`,
            ["Order", "Date", "Status", "Customer", "Email", "Phone", "City", "State", "Pincode", "Items", "Subtotal", "GST included", "Shipping", "Total"],
            rows.map((o) => [
                o.id, formatDate(o.created_at), statusMeta(ORDER_STATUSES, o.status).label, customerName(o),
                o.shipping_address?.email || o.user_email || "", o.shipping_address?.phone || "",
                o.shipping_address?.city || "", o.shipping_address?.state || "", o.shipping_address?.pincode || "",
                (o.items ?? []).map((i) => `${i.product?.name ?? "Item"} x${i.quantity}`).join("; "),
                money(o.subtotal_amount), money(o.tax_amount), money(o.shipping_amount), money(o.total_amount),
            ]));

    const open = orders.find((o) => o.id === openId) ?? null;

    return (
        <>
            <PageHeader
                title="Orders"
                description={`${rows.length} orders · ${formatINR(total)} in the current view`}
                actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="mr-2 h-4 w-4" />Export CSV</Button>}
            />

            <div className="rounded-xl border bg-card">
                <div className="flex flex-col gap-3 border-b p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order #, customer, email, phone or product" className="pl-9" />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Select value={range} onValueChange={(v) => setRange(v as Range)}>
                                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All time</SelectItem>
                                    <SelectItem value="7">Last 7 days</SelectItem>
                                    <SelectItem value="30">Last 30 days</SelectItem>
                                    <SelectItem value="90">Last 90 days</SelectItem>
                                    <SelectItem value="custom">Custom range</SelectItem>
                                </SelectContent>
                            </Select>
                            {range === "custom" && (
                                <>
                                    <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" />
                                    <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" />
                                </>
                            )}
                        </div>
                    </div>
                    <FilterPills
                        value={status}
                        onChange={setStatus}
                        options={[
                            { value: "all", label: "All", count: counts.all },
                            { value: "open", label: "Open", count: counts.open, tone: "amber" },
                            ...ORDER_STATUSES.filter((s) => !OPEN.has(s.value)).map((s) => ({ value: s.value, label: s.label, count: counts[s.value] ?? 0, tone: s.tone })),
                        ]}
                    />
                </div>

                {visible.length === 0 ? (
                    <Empty title="No orders match" body="Try another status, date range or search." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2.5 font-medium">Order</th>
                                    <th className="px-4 py-2.5 font-medium">
                                        <button type="button" onClick={() => toggleSort("created_at")} className="inline-flex items-center gap-1 hover:text-foreground">Date <ArrowUpDown className="h-3 w-3" /></button>
                                    </th>
                                    <th className="px-4 py-2.5 font-medium">Customer</th>
                                    <th className="px-4 py-2.5 font-medium">Items</th>
                                    <th className="px-4 py-2.5 font-medium">Status</th>
                                    <th className="px-4 py-2.5 text-right font-medium">
                                        <button type="button" onClick={() => toggleSort("total_amount")} className="inline-flex items-center gap-1 hover:text-foreground">Total <ArrowUpDown className="h-3 w-3" /></button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {visible.map((o) => {
                                    const s = statusMeta(ORDER_STATUSES, o.status);
                                    const units = (o.items ?? []).reduce((n, i) => n + (Number(i.quantity) || 0), 0);
                                    return (
                                        <tr key={o.id} onClick={() => setOpenId(o.id)} className="cursor-pointer transition-colors hover:bg-muted/40">
                                            <td className="px-4 py-3 font-mono text-xs">#{shortId(o.id)}</td>
                                            <td className="px-4 py-3">
                                                <div>{new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
                                                <div className="text-xs text-muted-foreground">{relativeTime(o.created_at)}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium">{customerName(o)}</div>
                                                <div className="text-xs text-muted-foreground">{o.shipping_address?.city || o.user_email}</div>
                                            </td>
                                            <td className="max-w-[16rem] px-4 py-3">
                                                <div className="truncate">{o.items?.[0]?.product?.name ?? "—"}</div>
                                                <div className="text-xs text-muted-foreground">{units} unit{units === 1 ? "" : "s"}{(o.items?.length ?? 0) > 1 ? ` · ${o.items.length} products` : ""}</div>
                                            </td>
                                            <td className="px-4 py-3"><StatusBadge label={s.label} tone={s.tone} /></td>
                                            <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatINR(o.total_amount)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {pages > 1 && (
                    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                        <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, rows.length)} of {rows.length}</span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                            <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                        </div>
                    </div>
                )}
            </div>

            <OrderSheet order={open} onClose={() => setOpenId(null)} onChanged={onChanged} />
        </>
    );
}

function OrderSheet({ order, onClose, onChanged }: { order: AdminOrder | null; onClose: () => void; onChanged: (id: string, status: string) => void }) {
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);

    const setStatus = async (next: string) => {
        if (!order || next === order.status) return;
        if (next === "cancelled" && !window.confirm("Cancel this order? The customer will see it as cancelled.")) return;
        setSaving(true);
        try {
            await apiService.updateOrderStatus(order.id, next);
            onChanged(order.id, next);
            toast.success(`Order #${shortId(order.id)} is now ${statusMeta(ORDER_STATUSES, next).label.toLowerCase()}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update the order");
        } finally {
            setSaving(false);
        }
    };

    const a = order?.shipping_address;
    const addressText = a ? [a.fullName, a.address, [a.city, a.state, a.pincode].filter(Boolean).join(", "), a.phone].filter(Boolean).join("\n") : "";
    const copyAddress = async () => {
        await navigator.clipboard.writeText(addressText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <Sheet open={!!order} onOpenChange={(v) => !v && onClose()}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
                {order && (
                    <>
                        <SheetHeader className="text-left">
                            <SheetTitle className="font-mono">Order #{shortId(order.id)}</SheetTitle>
                            <SheetDescription>{formatDate(order.created_at)}</SheetDescription>
                        </SheetHeader>

                        <div className="mt-6 space-y-6 text-sm">
                            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                                <span className="text-muted-foreground">Status</span>
                                <Select value={order.status} onValueChange={setStatus} disabled={saving}>
                                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ORDER_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>

                            <section>
                                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer</h3>
                                <p className="font-medium">{customerName(order)}</p>
                                <p className="text-muted-foreground">{a?.email || order.user_email}</p>
                                {a?.phone && <a href={`tel:${a.phone}`} className="text-muted-foreground hover:text-foreground">{a.phone}</a>}
                            </section>

                            {a && (
                                <section>
                                    <div className="mb-2 flex items-center justify-between">
                                        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ship to</h3>
                                        <button type="button" onClick={copyAddress} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                                            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy"}
                                        </button>
                                    </div>
                                    <p className="whitespace-pre-line leading-relaxed">{addressText}</p>
                                </section>
                            )}

                            <section>
                                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</h3>
                                <ul className="divide-y rounded-lg border">
                                    {(order.items ?? []).map((it, i) => (
                                        <li key={i} className="flex items-center gap-3 p-3">
                                            <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-card">
                                                {it.product?.image_url && <img src={it.product.image_url} alt="" className="h-full w-full object-contain" />}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium">{it.product?.name ?? "Item"}</span>
                                                <span className="text-xs text-muted-foreground">Qty {it.quantity}</span>
                                            </span>
                                            <span className="tabular-nums">{formatINR(it.line_total)}</span>
                                        </li>
                                    ))}
                                </ul>
                                <dl className="mt-3 space-y-1.5">
                                    {order.subtotal_amount !== undefined && <Row label="Subtotal" value={formatINR(money(order.subtotal_amount))} />}
                                    {order.tax_amount !== undefined && <Row label="GST (included)" value={formatINR(money(order.tax_amount))} muted />}
                                    {order.shipping_amount !== undefined && <Row label="Shipping" value={formatINR(money(order.shipping_amount))} />}
                                    <div className="flex justify-between border-t pt-2 font-semibold">
                                        <dt>Total</dt><dd className="tabular-nums">{formatINR(order.total_amount)}</dd>
                                    </div>
                                </dl>
                            </section>

                            {(order.payment_gateway || order.payment_status) && (
                                <section className="text-muted-foreground">
                                    Payment: {order.payment_gateway ?? "—"}{order.payment_status ? ` · ${order.payment_status}` : ""}
                                </section>
                            )}
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}

const Row = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
        <dt>{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>
);
