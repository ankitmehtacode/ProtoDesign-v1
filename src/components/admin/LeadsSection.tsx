import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Mail, Megaphone, Trash2 } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { API_URL, apiService } from "@/services/api.service";
import { formatINR } from "@/lib/currency";
import { Empty, FilterPills, Kpi, PageHeader, Panel, StatusBadge } from "./ui";
import { LEAD_STATUSES, delta, downloadCsv, formatDate, relativeTime, statusMeta } from "./model";

/*
 * Leads: who asked to be contacted, how they found the shop, and what they
 * looked at first; plus the 30-day funnel by channel, which is the number that
 * says where marketing money works. Data: GET /api/leads/admin
 * (backend/src/services/leads.service.js adminOverview).
 */

interface Lead {
    id: string; name: string | null; phone: string | null; email: string | null;
    interest: string; message: string | null; form: string; status: string; admin_notes: string | null;
    source: string | null; medium: string | null; campaign: string | null; landing_path: string | null;
    submissions: number; created_at: string; last_submitted_at: string; product_name: string | null;
    events: number; product_views: number; last_activity_at: string;
    score: number | null; score_reasons: { label: string; points: number }[] | null;
}

interface AdsStatus {
    feedEnabled: boolean; leadConversion: string; purchaseConversion: string; feedDays: number;
    lastFetch: { fetched_at: string; conversions: number } | null;
    feed: { leads: number; purchases: number; value: number };
    ad_visitors: number; ad_consented: number; match_consented: number; matchRows: number;
}

interface Reorder {
    user_id: string; name: string | null; email: string | null; phone: string | null; materials: string[];
    orders: number; lastOrderAt: string; lastKg: number; assumedKg: boolean;
    kgPerMonth: number; basis: "history" | "calculator" | "typical"; runsOutAt: string; daysLeft: number;
}

interface Overview {
    totals: { visitors_30d: number; visitors_prev: number; leads_30d: number; leads_prev: number; converted_30d: number; leads_new: number };
    channels: { source: string; medium: string; visitors: number; leads: number }[];
    landings: { path: string; visitors: number; leads: number }[];
    products: { id: string; name: string; category: string; views: number; viewers: number; carts: number; leads: number }[];
    leads: Lead[];
    storage: { bytes: number; limitBytes: number; alertBytes: number };
    tools: { tool: string; runs: number; sent_to_whatsapp: number }[];
    waiting: { id: string; name: string; kind: string; people: number }[];
}

const TOOL_LABEL: Record<string, string> = { printer_advisor: "Printer advisor", filament_estimator: "Filament calculator" };

interface Detail {
    lead: Lead & {
        gclid: string | null; referrer_host: string | null; term: string | null; consent_text: string; consented_at: string;
        ads_consent_text: string | null; ads_consented_at: string | null;
    };
    events: { name: string; path: string | null; created_at: string; product_id: string | null; product_name: string | null }[];
    orders: { id: string; status: string; total_amount: string; created_at: string }[];
}

// Same bands as backend lead-intel.service.js: hot from 60, warm from 35.
const scoreMeta = (score: number | null): { label: string; tone: "red" | "amber" | "neutral" } | null =>
    score === null ? null : score >= 60 ? { label: `Hot ${score}`, tone: "red" } : score >= 35 ? { label: `Warm ${score}`, tone: "amber" } : { label: `Cold ${score}`, tone: "neutral" };
const BASIS_LABEL: Record<Reorder["basis"], string> = {
    history: "from their buying rhythm", calculator: "from their filament calculator answer", typical: "typical rate, first purchase",
};
const runsOut = (d: number) => (d < 0 ? `likely ran out ${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "likely runs out today" : `runs out in ~${d} day${d === 1 ? "" : "s"}`);
// Checkout phones are free text: "98765 43210", "09876543210" or "+91 98765 43210".
const waNumber = (phone: string) => {
    const d = phone.replace(/\D/g, "").replace(/^0(?=\d{10}$)/, "");
    return d.length === 10 ? `91${d}` : d;
};

const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "–");
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(0)} MB`;
const contact = (l: Lead) => l.name || (l.phone ? `+${l.phone}` : l.email) || "Unknown";
const channel = (l: { source: string | null; medium: string | null }) => (l.source ? `${l.source} / ${l.medium}` : "No analytics consent");

const EVENT_LABEL: Record<string, string> = {
    page_view: "Viewed page", product_view: "Viewed product", add_to_cart: "Added to cart",
    quote_start: "Started a print quote", lead_submit: "Sent the enquiry",
    tool_use: "Used", alert_signup: "Asked for an alert on",
};

export function LeadsSection({ initialFilter }: { initialFilter?: string }) {
    const [filter, setFilter] = useState(initialFilter && LEAD_STATUSES.some((s) => s.value === initialFilter) ? initialFilter : "all");
    const [openId, setOpenId] = useState<string | null>(null);
    const [sort, setSort] = useState<"score" | "recent">("score");
    const { data, isLoading, isError } = useQuery({
        queryKey: ["leads-overview"],
        queryFn: () => apiService.request("/leads/admin") as Promise<Overview>,
        retry: false,
    });
    const ads = useQuery({
        queryKey: ["leads-ads"],
        queryFn: () => apiService.request("/leads/ads") as Promise<AdsStatus>,
        retry: false,
    });
    const downloadAudience = async (interest?: string) => {
        try {
            const csv = await apiService.request(`/leads/ads/customer-match.csv${interest ? `?interest=${interest}` : ""}`) as string;
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
            const a = Object.assign(document.createElement("a"), { href: url, download: `customer-match-${interest ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv` });
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not build the audience file");
        }
    };
    const reorders = useQuery({
        queryKey: ["leads-reorders"],
        queryFn: () => apiService.request("/leads/reorders") as Promise<{ customers: Reorder[]; buyers: number; repeatBuyers: number }>,
        retry: false,
    });

    const shown = useMemo(
        () => {
            const list = (data?.leads ?? []).filter((l) => filter === "all" || l.status === filter);
            // Unscored (closed, or not yet scored) last; the server already orders by activity.
            return sort === "score" ? [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : list;
        },
        [data, filter, sort],
    );

    if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    if (isError || !data) return <Empty title="Couldn't load leads." body="Try Refresh. If it keeps failing, check that migration 015_leads.sql has been applied." />;

    const { totals, storage } = data;
    const exportCsv = () => downloadCsv(`leads-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Name", "Phone (with country code)", "Email", "Interest", "Product", "Status", "Score", "Source", "Medium", "Campaign", "Landing page", "Message", "Created"],
        shown.map((l) => [l.name ?? "", l.phone ?? "", l.email ?? "", l.interest, l.product_name ?? "", l.status, l.score ?? "",
            l.source ?? "", l.medium ?? "", l.campaign ?? "", l.landing_path ?? "", l.message ?? "", l.created_at]));

    return (
        <>
            <PageHeader
                title="Leads"
                description="People who asked to be contacted, and how visitors who allowed analytics found the shop. Last 30 days."
                actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={shown.length === 0}><Download className="mr-2 h-4 w-4" />Export CSV</Button>}
            />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Kpi label="Visitors" value={String(totals.visitors_30d)} change={delta(totals.visitors_30d, totals.visitors_prev)} hint="allowed analytics" />
                <Kpi label="Leads" value={String(totals.leads_30d)} change={delta(totals.leads_30d, totals.leads_prev)} />
                <Kpi label="Visitor → lead" value={pct(totals.converted_30d, totals.visitors_30d)} change={null} hint="tracked visitors only" />
                <Kpi label="Waiting for contact" value={String(totals.leads_new)} change={null} hint="status New" />
                <Kpi label="Database used" value={mb(storage.bytes)} change={null}
                    hint={`of ${mb(storage.limitBytes)} free tier${storage.bytes >= storage.alertBytes ? " · near the limit" : ""}`} />
            </div>

            <Panel className="mt-6" title="Where leads come from" description="First visit of each tracked visitor. A channel with visitors but no leads is spend or effort to question.">
                {data.channels.length === 0 ? <Empty title="No tracked visits yet." body="Visits appear here once people allow analytics." /> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-xs text-muted-foreground">
                                <tr><th className="px-5 py-2 font-medium">Source / medium</th><th className="px-5 py-2 text-right font-medium">Visitors</th>
                                    <th className="px-5 py-2 text-right font-medium">Leads</th><th className="px-5 py-2 text-right font-medium">Conversion</th></tr>
                            </thead>
                            <tbody className="divide-y">
                                {data.channels.map((c) => (
                                    <tr key={`${c.source}/${c.medium}`}>
                                        <td className="px-5 py-2.5">{c.source} <span className="text-muted-foreground">/ {c.medium}</span></td>
                                        <td className="px-5 py-2.5 text-right tabular-nums">{c.visitors}</td>
                                        <td className="px-5 py-2.5 text-right tabular-nums">{c.leads}</td>
                                        <td className="px-5 py-2.5 text-right tabular-nums">{pct(c.leads, c.visitors)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Panel title="Landing pages" description="Where tracked visitors first arrived.">
                    {data.landings.length === 0 ? <Empty title="Nothing yet." /> : (
                        <ul className="divide-y text-sm">
                            {data.landings.map((l) => (
                                <li key={l.path} className="flex items-center justify-between gap-4 px-5 py-2.5">
                                    <span className="truncate font-mono text-xs">{l.path}</span>
                                    <span className="shrink-0 tabular-nums text-muted-foreground">{l.visitors} visitors · {l.leads} leads</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
                <Panel title="Most viewed products" description="Interest that has not turned into a sale is a follow-up list.">
                    {data.products.length === 0 ? <Empty title="Nothing yet." /> : (
                        <ul className="divide-y text-sm">
                            {data.products.map((p) => (
                                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-2.5">
                                    <span className="truncate">{p.name}</span>
                                    <span className="shrink-0 tabular-nums text-muted-foreground">{p.views} views · {p.carts} carts · {p.leads} leads</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Panel title="Tools" description="Advisor and calculator runs, and how many were sent to WhatsApp (each one is a lead with a verified number).">
                    {data.tools.length === 0 ? <Empty title="No runs yet." /> : (
                        <ul className="divide-y text-sm">
                            {data.tools.map((t) => (
                                <li key={t.tool} className="flex items-center justify-between gap-4 px-5 py-2.5">
                                    <span>{TOOL_LABEL[t.tool] ?? t.tool}</span>
                                    <span className="tabular-nums text-muted-foreground">{t.runs} runs · {t.sent_to_whatsapp} to WhatsApp</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
                <Panel title="Waiting for stock or a lower price" description="Open alerts: people who will buy when this changes.">
                    {data.waiting.length === 0 ? <Empty title="No open alerts." /> : (
                        <ul className="divide-y text-sm">
                            {data.waiting.map((w) => (
                                <li key={`${w.id}/${w.kind}`} className="flex items-center justify-between gap-4 px-5 py-2.5">
                                    <span className="truncate">{w.name}</span>
                                    <span className="shrink-0 tabular-nums text-muted-foreground">{w.people} {w.kind === "back_in_stock" ? "want it back" : "want a lower price"}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
            </div>

            <Panel className="mt-6" title="Google Ads" description="Only people who opted in: ad clicks that became enquiries or orders go back to Google, and opted-in leads can be uploaded as a hashed audience.">
                {ads.isError || !ads.data ? <Empty title={ads.isError ? "Couldn't load Google Ads status." : "Loading…"} body={ads.isError ? "Check that migration 019_ads.sql has been applied." : undefined} /> : (
                    <div className="grid gap-6 px-5 py-4 text-sm md:grid-cols-2">
                        <div className="space-y-1.5">
                            <h3 className="flex items-center gap-2 font-medium"><Megaphone className="h-4 w-4" />Offline conversions</h3>
                            {!ads.data.feedEnabled ? (
                                <p className="text-muted-foreground">Off. Set <code className="font-mono text-xs">AdsFeedSecret</code> and deploy; see docs/google-ads.md.</p>
                            ) : (
                                <>
                                    <p className="font-mono text-xs break-all">{API_URL}/ads/conversions.csv</p>
                                    <p className="text-muted-foreground">
                                        {ads.data.lastFetch ? `Google last fetched it ${relativeTime(ads.data.lastFetch.fetched_at)} (${ads.data.lastFetch.conversions} conversions).` : "Not fetched yet: set up the scheduled import in Google Ads."}
                                    </p>
                                </>
                            )}
                            <p className="text-muted-foreground">
                                Last {ads.data.feedDays} days: {ads.data.feed.leads} × “{ads.data.leadConversion}”, {ads.data.feed.purchases} × “{ads.data.purchaseConversion}” worth {formatINR(ads.data.feed.value)}.
                            </p>
                            <p className="text-muted-foreground">Last 30 days: {ads.data.ad_consented} of {ads.data.ad_visitors} tracked visitors from ads allowed measurement.</p>
                        </div>
                        <div className="space-y-1.5">
                            <h3 className="font-medium">Customer Match audience</h3>
                            <p className="text-muted-foreground">
                                {ads.data.match_consented} leads opted in; {ads.data.matchRows} have a WhatsApp-verified number or confirmed email and can be uploaded.
                                Upload as a full replacement each time, so people who withdrew drop out.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" onClick={() => downloadAudience()} disabled={ads.data.matchRows === 0}><Download className="mr-1.5 h-4 w-4" />All</Button>
                                {(["printer", "filament", "resin"] as const).map((i) => (
                                    <Button key={i} size="sm" variant="outline" className="capitalize" onClick={() => downloadAudience(i)} disabled={ads.data!.matchRows === 0}><Download className="mr-1.5 h-4 w-4" />{i}</Button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </Panel>

            <Panel className="mt-6" title="Filament running low" description="Customers whose filament is likely running out, from their orders. A call list: nothing is sent to them.">
                {reorders.isError ? <Empty title="Couldn't load predictions." /> : !reorders.data || reorders.data.customers.length === 0 ? (
                    <Empty title="Nobody due right now." body={reorders.data ? `${reorders.data.buyers} filament buyers in the last year; customers appear here from 3 weeks before their spool is likely to run out.` : undefined} />
                ) : (
                    <ul className="divide-y text-sm">
                        {reorders.data.customers.map((c) => (
                            <li key={c.user_id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 font-medium">
                                        {c.name || c.email}
                                        <StatusBadge label={runsOut(c.daysLeft)} tone={c.daysLeft <= 0 ? "red" : c.daysLeft <= 7 ? "amber" : "neutral"} />
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {c.materials.join(", ") || "Filament"} · last bought {c.lastKg} kg{c.assumedKg ? " (assumed 1 kg spools)" : ""} {formatDate(c.lastOrderAt)} · ~{c.kgPerMonth} kg a month, {BASIS_LABEL[c.basis]}
                                    </div>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                    {c.phone && <Button asChild size="sm" variant="outline"><a href={`https://wa.me/${waNumber(c.phone)}`} target="_blank" rel="noopener noreferrer"><FaWhatsapp className="mr-1.5" />WhatsApp</a></Button>}
                                    {c.email && <Button asChild size="sm" variant="outline"><a href={`mailto:${c.email}`}><Mail className="mr-1.5 h-4 w-4" />Email</a></Button>}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Panel>

            <Panel className="mt-6" title="Leads" description="Scores update hourly from what each lead did; open a lead to see why." action={
                <div className="flex flex-col items-end gap-2">
                    <FilterPills value={filter} onChange={setFilter} options={[
                        { value: "all", label: "All", count: data.leads.length },
                        ...LEAD_STATUSES.map((s) => ({ ...s, count: data.leads.filter((l) => l.status === s.value).length })),
                    ]} />
                    <FilterPills value={sort} onChange={setSort} options={[{ value: "score", label: "Hottest first" }, { value: "recent", label: "Latest activity" }]} />
                </div>
            }>
                {shown.length === 0 ? <Empty title="No leads here." body="Enquiries from printer, filament and resin pages appear here." /> : (
                    <ul className="divide-y">
                        {shown.map((l) => {
                            const st = statusMeta(LEAD_STATUSES, l.status);
                            return (
                                <li key={l.id}>
                                    <button type="button" onClick={() => setOpenId(l.id)} className="flex w-full flex-col gap-1 px-5 py-3 text-left hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 font-medium">
                                                {contact(l)} <StatusBadge label={st.label} tone={st.tone} />
                                                {scoreMeta(l.score) && <StatusBadge {...scoreMeta(l.score)!} />}
                                                <span className="text-xs font-normal capitalize text-muted-foreground">{l.interest}{l.product_name ? ` · ${l.product_name}` : ""}</span>
                                            </div>
                                            <div className="truncate text-sm text-muted-foreground">{l.message || channel(l)}</div>
                                        </div>
                                        <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
                                            <div>{channel(l)}</div>
                                            <div>{l.product_views} product views · {relativeTime(l.last_activity_at)}</div>
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Panel>

            <LeadDialog id={openId} onClose={() => setOpenId(null)} />
        </>
    );
}

function LeadDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
    const qc = useQueryClient();
    const [notes, setNotes] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);
    const { data, isLoading } = useQuery({
        queryKey: ["lead", id],
        queryFn: () => apiService.request(`/leads/admin/${id}`) as Promise<Detail>,
        enabled: !!id,
        retry: false,
    });

    const close = () => { setNotes(null); setConfirmDelete(false); onClose(); };

    const save = async (patch: { status?: string; admin_notes?: string; withdraw_ads?: boolean }) => {
        setBusy(true);
        try {
            await apiService.request(`/leads/admin/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
            await Promise.all([qc.invalidateQueries({ queryKey: ["lead", id] }), qc.invalidateQueries({ queryKey: ["leads-overview"] })]);
            toast.success("Saved");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save");
        } finally {
            setBusy(false);
        }
    };

    const erase = async () => {
        setBusy(true);
        try {
            await apiService.request(`/leads/admin/${id}`, { method: "DELETE" });
            await qc.invalidateQueries({ queryKey: ["leads-overview"] });
            toast.success("Lead and its visit history deleted");
            close();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not delete");
        } finally {
            setBusy(false);
        }
    };

    const lead = data?.lead;
    return (
        <Dialog open={!!id} onOpenChange={(o) => { if (!o) close(); }}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader><DialogTitle>{lead ? contact(lead) : "Lead"}</DialogTitle></DialogHeader>
                {isLoading || !data || !lead ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
                    <div className="space-y-5 text-sm">
                        <div className="flex flex-wrap gap-2">
                            {lead.phone && (
                                <Button asChild size="sm"><a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noopener noreferrer"><FaWhatsapp className="mr-2" />WhatsApp +{lead.phone}</a></Button>
                            )}
                            {lead.email && (
                                <Button asChild size="sm" variant="outline"><a href={`mailto:${lead.email}`}><Mail className="mr-2 h-4 w-4" />{lead.email}</a></Button>
                            )}
                            <Select value={lead.status} onValueChange={(v) => save({ status: v })} disabled={busy}>
                                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                                <SelectContent>{LEAD_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>

                        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5">
                            <dt className="text-muted-foreground">Score</dt>
                            <dd>
                                {lead.score === null ? "Not scored yet (scores update hourly, open leads only)" : (
                                    <>
                                        <StatusBadge {...scoreMeta(lead.score)!} />
                                        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                                            {(lead.score_reasons ?? []).map((r) => (
                                                <li key={r.label}><span className={`inline-block w-9 tabular-nums ${r.points < 0 ? "text-rose-300" : ""}`}>{r.points > 0 ? `+${r.points}` : r.points}</span>{r.label}</li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </dd>
                            <dt className="text-muted-foreground">Interest</dt><dd className="capitalize">{lead.interest}{lead.product_name ? ` · ${lead.product_name}` : ""}</dd>
                            <dt className="text-muted-foreground">Message</dt><dd className="whitespace-pre-wrap">{lead.message || "–"}</dd>
                            <dt className="text-muted-foreground">First came from</dt><dd>{channel(lead)}{lead.campaign ? ` · campaign ${lead.campaign}` : ""}{lead.gclid ? " · Google Ads click" : ""}</dd>
                            <dt className="text-muted-foreground">Landed on</dt><dd className="font-mono text-xs">{lead.landing_path || "–"}</dd>
                            <dt className="text-muted-foreground">Enquiries</dt><dd>{lead.submissions} · first {formatDate(lead.created_at)}</dd>
                            <dt className="text-muted-foreground">Consent</dt><dd className="text-xs text-muted-foreground">{formatDate(lead.consented_at)}: “{lead.consent_text}”</dd>
                            <dt className="text-muted-foreground">Google ads</dt>
                            <dd className="text-xs text-muted-foreground">
                                {lead.ads_consented_at ? (
                                    <>
                                        {formatDate(lead.ads_consented_at)}: “{lead.ads_consent_text}”{" "}
                                        <Button size="sm" variant="link" className="h-auto p-0 text-xs text-rose-300" disabled={busy} onClick={() => save({ withdraw_ads: true })}>Withdraw on request</Button>
                                    </>
                                ) : "Not opted in"}
                            </dd>
                        </dl>

                        {data.orders.length > 0 && (
                            <div>
                                <h3 className="mb-1.5 font-medium">Orders</h3>
                                <ul className="space-y-1">
                                    {data.orders.map((o) => <li key={o.id} className="text-muted-foreground">{formatDate(o.created_at)} · {formatINR(Number(o.total_amount))} · {o.status}</li>)}
                                </ul>
                            </div>
                        )}

                        <div>
                            <h3 className="mb-1.5 font-medium">Journey</h3>
                            {data.events.length === 0 ? <p className="text-muted-foreground">No tracked visits (analytics not allowed on their browser).</p> : (
                                <ol className="max-h-64 space-y-1 overflow-y-auto border-l pl-4">
                                    {data.events.map((e, i) => (
                                        <li key={i}>
                                            <span className="text-xs tabular-nums text-muted-foreground">{formatDate(e.created_at)}</span>{" "}
                                            {EVENT_LABEL[e.name] ?? e.name}{" "}
                                            <span className="text-muted-foreground">{e.product_name ?? e.path ?? ""}</span>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>

                        <div>
                            <h3 className="mb-1.5 font-medium">Notes</h3>
                            <Textarea rows={3} value={notes ?? lead.admin_notes ?? ""} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
                            <Button size="sm" className="mt-2" disabled={busy || notes === null} onClick={() => save({ admin_notes: notes ?? "" })}>Save notes</Button>
                        </div>

                        <div className="border-t pt-4">
                            {confirmDelete ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span>Delete this lead and its visit history? This cannot be undone.</span>
                                    <Button size="sm" variant="destructive" onClick={erase} disabled={busy}>Delete</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
                                </div>
                            ) : (
                                <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => setConfirmDelete(true)}>
                                    <Trash2 className="mr-2 h-4 w-4" />Delete on request
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
