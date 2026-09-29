import { useEffect, useMemo, useState } from "react";
import { Download, FileBox, MessageCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { apiService } from "@/services/api.service";
import { formatINR } from "@/lib/currency";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminQuote, QUOTE_STATUSES, downloadCsv, formatDate, money, relativeTime, statusMeta } from "./model";
import { Empty, FilterPills, PageHeader, StatusBadge } from "./ui";

const PAGE = 20;

type Specs = {
    material?: string; quality?: string; infill?: string; scale?: string; rotation?: string;
    estimatedTime?: string; estimatedWeight?: string;
    printDimensions?: { x?: number; y?: number; z?: number };
    originalStats?: { volume?: number; triangles?: number; dimensions?: { x?: number; y?: number; z?: number } };
};

/** Specs arrive as JSON text or an object, depending on how the quote was made. */
const specsOf = (q: AdminQuote): Specs => {
    const raw = q.specifications;
    if (typeof raw === "string") { try { return JSON.parse(raw) as Specs; } catch { return {}; } }
    return (raw ?? {}) as Specs;
};

const dims = (d?: { x?: number; y?: number; z?: number }) =>
    d?.x ? `${Number(d.x).toFixed(1)} × ${Number(d.y).toFixed(1)} × ${Number(d.z).toFixed(1)} mm` : "—";

/** wa.me needs the country code; Indian numbers are often stored as 10 digits. */
const waNumber = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    return digits.length === 10 ? `91${digits}` : digits;
};

/** Quote files are private: each download is a short-lived signed URL. */
const openFile = async (id: string) => {
    try {
        window.open(await apiService.getQuoteDownloadUrl(id), "_blank", "noopener,noreferrer");
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not open that file.");
    }
};

export function QuotesSection({ quotes, initialFilter, onChanged }: {
    quotes: AdminQuote[]; initialFilter?: string; onChanged: (id: string, status: string) => void;
}) {
    const [status, setStatus] = useState("all");
    const [q, setQ] = useState("");
    const [page, setPage] = useState(1);
    const [openId, setOpenId] = useState<string | null>(null);

    useEffect(() => { if (initialFilter) setStatus(initialFilter); }, [initialFilter]);

    const searched = useMemo(() => {
        const n = q.trim().toLowerCase();
        return n ? quotes.filter((x) => [x.email, x.phone, x.file_name, specsOf(x).material].some((v) => v && v.toLowerCase().includes(n))) : quotes;
    }, [quotes, q]);

    // Pipeline: count and value per stage.
    const stages = useMemo(() => QUOTE_STATUSES.map((s) => {
        const list = searched.filter((x) => x.status === s.value);
        return { ...s, count: list.length, amount: list.reduce((a, x) => a + money(x.estimated_price), 0) };
    }), [searched]);

    const rows = useMemo(() => (status === "all" ? searched : searched.filter((x) => x.status === status)), [searched, status]);
    useEffect(() => setPage(1), [status, q]);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    const visible = rows.slice((page - 1) * PAGE, page * PAGE);

    const update = async (id: string, next: string) => {
        try {
            await apiService.request(`/quotes/${id}/status`, { method: "PUT", body: JSON.stringify({ status: next }) });
            onChanged(id, next);
            toast.success(`Quote marked ${statusMeta(QUOTE_STATUSES, next).label.toLowerCase()}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update the quote");
        }
    };

    const exportCsv = () =>
        downloadCsv(`quotes-${new Date().toISOString().slice(0, 10)}.csv`,
            ["Quote", "Date", "Status", "Email", "Phone", "Source", "File", "Material", "Quality", "Infill", "Print size", "Weight", "Time", "Estimated price"],
            rows.map((x) => {
                const s = specsOf(x);
                return [x.id, formatDate(x.created_at), statusMeta(QUOTE_STATUSES, x.status).label, x.email ?? "", x.phone ?? "",
                    x.source ?? (x.email ? "web" : "whatsapp"), x.file_name, s.material ?? "", s.quality ?? "", s.infill ?? "",
                    dims(s.printDimensions), s.estimatedWeight ?? "", s.estimatedTime ?? "", money(x.estimated_price)];
            }));

    const open = quotes.find((x) => x.id === openId) ?? null;

    return (
        <>
            <PageHeader
                title="Quote requests"
                description="Custom print requests from the quote page and WhatsApp."
                actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="mr-2 h-4 w-4" />Export CSV</Button>}
            />

            {/* The pipeline */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                {stages.map((s) => (
                    <button
                        key={s.value}
                        type="button"
                        onClick={() => setStatus(status === s.value ? "all" : s.value)}
                        className={`rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/30 ${status === s.value ? "border-foreground ring-1 ring-foreground" : ""}`}
                    >
                        <StatusBadge label={s.label} tone={s.tone} />
                        <p className="mt-3 font-display text-2xl font-bold tabular-nums">{s.count}</p>
                        <p className="text-xs text-muted-foreground">{formatINR(s.amount)} estimated</p>
                    </button>
                ))}
            </div>

            <div className="rounded-xl border bg-card">
                <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email, phone, file or material" className="pl-9" />
                    </div>
                    <FilterPills value={status} onChange={setStatus} options={[{ value: "all", label: "All", count: searched.length }, ...stages.map((s) => ({ value: s.value, label: s.label, count: s.count, tone: s.tone }))]} />
                </div>

                {visible.length === 0 ? <Empty title="No quote requests match" /> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2.5 font-medium">Received</th>
                                    <th className="px-4 py-2.5 font-medium">From</th>
                                    <th className="px-4 py-2.5 font-medium">Model</th>
                                    <th className="px-4 py-2.5 font-medium">Specs</th>
                                    <th className="px-4 py-2.5 text-right font-medium">Estimate</th>
                                    <th className="px-4 py-2.5 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {visible.map((x) => {
                                    const s = specsOf(x);
                                    return (
                                        <tr key={x.id} className="transition-colors hover:bg-muted/40">
                                            <td className="cursor-pointer px-4 py-3" onClick={() => setOpenId(x.id)}>
                                                <div>{new Date(x.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
                                                <div className="text-xs text-muted-foreground">{relativeTime(x.created_at)}</div>
                                            </td>
                                            <td className="cursor-pointer px-4 py-3" onClick={() => setOpenId(x.id)}>
                                                <div className="flex items-center gap-1.5 font-medium">
                                                    {!x.email && <MessageCircle className="h-3.5 w-3.5 text-emerald-300" />}
                                                    {x.email ?? "WhatsApp"}
                                                </div>
                                                <div className="text-xs text-muted-foreground">{x.phone}</div>
                                            </td>
                                            <td className="max-w-[14rem] px-4 py-3">
                                                <button type="button" onClick={() => openFile(x.id)} className="flex max-w-full items-center gap-1.5 text-left font-medium hover:underline" title={`Download ${x.file_name}`}>
                                                    <FileBox className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                    <span className="truncate">{x.file_name}</span>
                                                </button>
                                            </td>
                                            <td className="cursor-pointer px-4 py-3 text-xs text-muted-foreground" onClick={() => setOpenId(x.id)}>
                                                <div className="text-sm text-foreground">{s.material ?? "—"}</div>
                                                {dims(s.printDimensions)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatINR(money(x.estimated_price))}</td>
                                            <td className="px-4 py-3">
                                                <Select value={x.status} onValueChange={(v) => update(x.id, v)}>
                                                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {QUOTE_STATUSES.map((st) => <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </td>
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

            <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
                <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
                    {open && <QuoteDetail quote={open} />}
                </SheetContent>
            </Sheet>
        </>
    );
}

function QuoteDetail({ quote }: { quote: AdminQuote }) {
    const s = specsOf(quote);
    const st = statusMeta(QUOTE_STATUSES, quote.status);
    const facts: [string, string][] = [
        ["Estimate", formatINR(money(quote.estimated_price))],
        ["Print time", s.estimatedTime ?? "—"],
        ["Weight", s.estimatedWeight ?? "—"],
        ["Volume", s.originalStats?.volume ? `${Number(s.originalStats.volume).toFixed(2)} cm³` : "—"],
    ];
    const settings: [string, string][] = [
        ["Material", s.material ?? "—"], ["Quality", s.quality ?? "—"], ["Infill", s.infill ?? "—"], ["Scale", s.scale ?? "100%"],
        ["Print size", dims(s.printDimensions)], ["Original size", dims(s.originalStats?.dimensions)],
        ["Rotation", s.rotation ?? "—"], ["Triangles", s.originalStats?.triangles?.toLocaleString("en-IN") ?? "—"],
    ];
    return (
        <>
            <SheetHeader className="text-left">
                <SheetTitle className="break-all">{quote.file_name}</SheetTitle>
                <SheetDescription>{formatDate(quote.created_at)} · {quote.email ?? `${quote.phone} via WhatsApp`}</SheetDescription>
            </SheetHeader>
            <div className="mt-4"><StatusBadge label={st.label} tone={st.tone} /></div>
            <div className="mt-6 grid grid-cols-2 gap-3">
                {facts.map(([k, v]) => (
                    <div key={k} className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">{k}</p>
                        <p className="mt-1 font-semibold tabular-nums">{v}</p>
                    </div>
                ))}
            </div>
            <dl className="mt-6 divide-y rounded-lg border text-sm">
                {settings.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 px-3 py-2">
                        <dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd>
                    </div>
                ))}
            </dl>
            {quote.admin_notes && (
                <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                    <p className="mb-1 text-xs font-medium text-amber-300">Customer notes</p>
                    <p className="whitespace-pre-line">{quote.admin_notes}</p>
                </div>
            )}
            <div className="mt-6 flex gap-2">
                <Button className="flex-1" onClick={() => openFile(quote.id)}><Download className="mr-2 h-4 w-4" />Download model</Button>
                {quote.phone && <Button variant="outline" asChild><a href={`https://wa.me/${waNumber(quote.phone)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp</a></Button>}
            </div>
        </>
    );
}
