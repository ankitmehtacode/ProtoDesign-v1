import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Mail, Trash2 } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiService } from "@/services/api.service";
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
    lead: Lead & { gclid: string | null; referrer_host: string | null; term: string | null; consent_text: string; consented_at: string };
    events: { name: string; path: string | null; created_at: string; product_id: string | null; product_name: string | null }[];
    orders: { id: string; status: string; total_amount: string; created_at: string }[];
}

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
    const { data, isLoading, isError } = useQuery({
        queryKey: ["leads-overview"],
        queryFn: () => apiService.request("/leads/admin") as Promise<Overview>,
        retry: false,
    });

    const shown = useMemo(
        () => (data?.leads ?? []).filter((l) => filter === "all" || l.status === filter),
        [data, filter],
    );

    if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    if (isError || !data) return <Empty title="Couldn't load leads." body="Try Refresh. If it keeps failing, check that migration 015_leads.sql has been applied." />;

    const { totals, storage } = data;
    const exportCsv = () => downloadCsv(`leads-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Name", "Phone (with country code)", "Email", "Interest", "Product", "Status", "Source", "Medium", "Campaign", "Landing page", "Message", "Created"],
        shown.map((l) => [l.name ?? "", l.phone ?? "", l.email ?? "", l.interest, l.product_name ?? "", l.status,
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

            <Panel className="mt-6" title="Leads" action={
                <FilterPills value={filter} onChange={setFilter} options={[
                    { value: "all", label: "All", count: data.leads.length },
                    ...LEAD_STATUSES.map((s) => ({ ...s, count: data.leads.filter((l) => l.status === s.value).length })),
                ]} />
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

    const save = async (patch: { status?: string; admin_notes?: string }) => {
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
                            <dt className="text-muted-foreground">Interest</dt><dd className="capitalize">{lead.interest}{lead.product_name ? ` · ${lead.product_name}` : ""}</dd>
                            <dt className="text-muted-foreground">Message</dt><dd className="whitespace-pre-wrap">{lead.message || "–"}</dd>
                            <dt className="text-muted-foreground">First came from</dt><dd>{channel(lead)}{lead.campaign ? ` · campaign ${lead.campaign}` : ""}{lead.gclid ? " · Google Ads click" : ""}</dd>
                            <dt className="text-muted-foreground">Landed on</dt><dd className="font-mono text-xs">{lead.landing_path || "–"}</dd>
                            <dt className="text-muted-foreground">Enquiries</dt><dd>{lead.submissions} · first {formatDate(lead.created_at)}</dd>
                            <dt className="text-muted-foreground">Consent</dt><dd className="text-xs text-muted-foreground">{formatDate(lead.consented_at)}: “{lead.consent_text}”</dd>
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
