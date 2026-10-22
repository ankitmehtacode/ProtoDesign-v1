import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiService } from "@/services/api.service";
import { Empty, FilterPills, Kpi, PageHeader, Panel, StatusBadge } from "./ui";
import { delta, downloadCsv, relativeTime } from "./model";

/*
 * Search demand: what people search on Google before they find the shop, from
 * Search Console (aggregate counts; Google never says who searched), joined to
 * the tracked visitors and leads those searches brought. Data:
 * GET /api/leads/search-demand (backend/src/services/search-console.service.js).
 */

interface QueryRow {
    query: string; clicks: number; impressions: number; position: number; ctr: number;
    prev_clicks: number; prev_impressions: number; page: string | null; topic: string; buying: boolean;
}
interface Opportunity extends QueryRow { kind: "close_to_top" | "low_ctr"; extra_clicks: number }
interface Totals { clicks: number; impressions: number; position: number | null }
interface Sync { status: "running" | "ok" | "partial" | "failed"; detail: string | null; rows_stored: number; started_at: string; finished_at: string | null }

interface Demand {
    configured: boolean; siteUrl: string | null; days: number; empty: boolean;
    dataFrom: string | null; dataThrough: string | null; lastSync: Sync | null; lastSuccessAt: string | null;
    period?: { from: string; to: string; previousFrom: string; previousComplete: boolean };
    totals?: { current: Totals; previous: Totals };
    organic?: { visitors: number; leads: number };
    topics?: { topic: string; clicks: number; impressions: number; prev_impressions: number; buying_impressions: number; queries: number }[];
    opportunities?: Opportunity[];
    rising?: QueryRow[];
    queries?: QueryRow[];
    pages?: { page: string; clicks: number; impressions: number; position: number; top_query: string | null; visitors: number; leads: number }[];
}

const PERIODS = [{ value: "7", label: "7 days" }, { value: "28", label: "28 days" }, { value: "56", label: "56 days" }] as const;
type Period = (typeof PERIODS)[number]["value"];

const TOPIC_LABEL: Record<string, string> = {
    printer: "Printers", filament: "Filament", resin: "Resin", service: "Printing service", brand: "ProtoDesign by name", other: "Other",
};
const SYNC_TONE = { running: "blue", ok: "green", partial: "amber", failed: "red" } as const;

const num = (n: number) => n.toLocaleString("en-IN");
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "–");
const pos = (p: number | null | undefined) => (p == null ? "–" : p.toFixed(1));
const change = (now: number, before: number) => {
    const d = delta(now, before);
    return d === null ? (now > 0 ? "new" : "–") : `${d > 0 ? "+" : ""}${Math.round(d * 100)}%`;
};

const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => (
    <th className={`px-5 py-2 font-medium ${right ? "text-right" : ""}`}>{children}</th>
);
const Td = ({ children, right, mono }: { children: ReactNode; right?: boolean; mono?: boolean }) => (
    <td className={`px-5 py-2.5 ${right ? "text-right tabular-nums" : ""} ${mono ? "font-mono text-xs" : ""}`}>{children}</td>
);

export function SearchDemandSection() {
    const queryClient = useQueryClient();
    const [period, setPeriod] = useState<Period>("28");
    const [syncing, setSyncing] = useState(false);
    const { data, isLoading, isError } = useQuery({
        queryKey: ["search-demand", period],
        queryFn: () => apiService.request(`/leads/search-demand?days=${period}`) as Promise<Demand>,
        retry: false,
    });

    const syncNow = async () => {
        setSyncing(true);
        try {
            const r = await apiService.request("/leads/search-demand/sync", { method: "POST" });
            if (r.status === "partial") toast.message(`Copied ${num(r.rowsStored)} rows so far. Press again to continue.`);
            else toast.success(r.rowsStored ? `Copied ${num(r.rowsStored)} rows from Search Console.` : "Up to date: Google has no newer final days yet.");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Sync failed.");
        } finally {
            setSyncing(false);
            void queryClient.invalidateQueries({ queryKey: ["search-demand"] });
        }
    };

    if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    if (isError || !data) return <Empty title="Couldn't load search demand." body="Try Refresh. If it keeps failing, check that migration 017_search_console.sql has been applied." />;

    const header = (
        <PageHeader
            title="Search demand"
            description="What people search on Google before they find the shop, and which searches become leads. From Search Console: counts only, Google never says who searched."
            actions={<>
                <FilterPills value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ ...p }))} />
                <Button variant="outline" size="sm" onClick={syncNow} disabled={syncing || !data.configured}>
                    {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sync now
                </Button>
            </>}
        />
    );

    const syncLine = data.lastSync && (
        <p className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge label={`Last sync ${data.lastSync.status}`} tone={SYNC_TONE[data.lastSync.status]} />
            <span>{relativeTime(data.lastSync.started_at)}</span>
            {data.lastSync.detail && <span className={data.lastSync.status === "failed" ? "text-rose-300" : ""}>{data.lastSync.detail}</span>}
            {data.dataThrough && <span>· Data through {data.dataThrough} (Search Console runs 2–3 days behind)</span>}
        </p>
    );

    if (!data.configured) {
        return (
            <>
                {header}
                <Panel title="Connect Search Console" description="One-time setup, about 15 minutes. Full steps: docs/search-demand.md.">
                    <ol className="list-decimal space-y-2 px-10 py-5 text-sm">
                        <li>In Google Cloud, enable the <b>Search Console</b>, <b>Security Token Service</b> and <b>IAM Service Account Credentials</b> APIs, and create a service account with no roles.</li>
                        <li>In Search Console → Settings → Users and permissions, add the service account's email as a <b>Restricted</b> user.</li>
                        <li>Let this function sign in as it without a key (workload identity federation), and store the resulting config in AWS SSM as a SecureString named <code className="font-mono text-xs">/protodesign/search-console-key</code>.</li>
                        <li>Set <code className="font-mono text-xs">SearchConsoleSiteUrl</code> (e.g. <code className="font-mono text-xs">sc-domain:yourshop.in</code>) in the deploy parameters and run <code className="font-mono text-xs">sam deploy</code>.</li>
                        <li>Come back here and press <b>Sync now</b>.</li>
                    </ol>
                </Panel>
            </>
        );
    }

    if (data.empty || !data.totals || !data.period) {
        return (
            <>
                {header}
                {syncLine}
                <Empty title="No Search Console data yet." body={`Connected to ${data.siteUrl}. Press Sync now to copy the last 118 days.`} />
            </>
        );
    }

    const { current, previous } = data.totals;
    // Before enough history is stored, the period before is part-empty: no comparison.
    const compare = data.period.previousComplete;
    const vs = (now: number, before: number) => (compare ? delta(now, before) : null);
    const noHistory = compare ? undefined : `no full ${data.days} days before yet`;
    const organic = data.organic ?? { visitors: 0, leads: 0 };
    const queries = data.queries ?? [];
    const exportCsv = () => downloadCsv(`search-queries-${data.period!.from}-to-${data.period!.to}.csv`,
        ["Query", "Topic", "Buying intent", "Clicks", "Impressions", "CTR", "Position", "Impressions before", "Page"],
        queries.map((q) => [q.query, q.topic, q.buying ? "yes" : "no", q.clicks, q.impressions, (q.ctr * 100).toFixed(2),
            q.position.toFixed(1), q.prev_impressions, q.page ?? ""]));

    return (
        <>
            {header}
            {syncLine}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Kpi label="Impressions" value={num(current.impressions)} change={vs(current.impressions, previous.impressions)} hint={noHistory ?? "times the shop showed in results"} />
                <Kpi label="Clicks" value={num(current.clicks)} change={vs(current.clicks, previous.clicks)} hint={noHistory} />
                <Kpi label="Click-through" value={pct(current.clicks, current.impressions)} change={null} hint={compare ? `was ${pct(previous.clicks, previous.impressions)}` : undefined} />
                <Kpi label="Average position" value={pos(current.position)} change={previous.position && current.position ? vs(current.position, previous.position) : null} invert hint="lower is better" />
                <Kpi label="Search → lead" value={`${organic.leads} of ${organic.visitors}`} change={null} hint="tracked Google visitors who became leads" />
            </div>

            <Panel className="mt-6" title="Demand by topic" description={`What people looked for, ${data.period.from} to ${data.period.to}, ${compare ? `against the ${data.days} days before` : `(the ${data.days} days before are not fully stored yet, so no change is shown)`}. Buying intent: searches with words like price, buy, best, near me.`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-left text-xs text-muted-foreground">
                            <tr><Th>Topic</Th><Th right>Impressions</Th><Th right>Change</Th><Th right>Clicks</Th><Th right>Click-through</Th><Th right>Buying intent</Th><Th right>Searches</Th></tr>
                        </thead>
                        <tbody className="divide-y">
                            {(data.topics ?? []).map((t) => (
                                <tr key={t.topic}>
                                    <Td>{TOPIC_LABEL[t.topic] ?? t.topic}</Td>
                                    <Td right>{num(t.impressions)}</Td>
                                    <Td right>{compare ? change(t.impressions, t.prev_impressions) : "–"}</Td>
                                    <Td right>{num(t.clicks)}</Td>
                                    <Td right>{pct(t.clicks, t.impressions)}</Td>
                                    <Td right>{pct(t.buying_impressions, t.impressions)}</Td>
                                    <Td right>{t.queries}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Panel>

            <Panel className="mt-6" title="Opportunities" description="Where better pages or titles would bring more customers without ad spend. Extra clicks are a rough estimate from a typical top-three click-through of 10%.">
                {(data.opportunities ?? []).length === 0 ? <Empty title="None this period." body="Searches with at least 20 impressions that rank 4–20, or rank top three but are rarely clicked, appear here." /> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-xs text-muted-foreground">
                                <tr><Th>Search</Th><Th>What to do</Th><Th right>Position</Th><Th right>Impressions</Th><Th right>Click-through</Th><Th right>Extra clicks</Th></tr>
                            </thead>
                            <tbody className="divide-y">
                                {data.opportunities!.map((o) => (
                                    <tr key={o.query}>
                                        <Td>{o.query}{o.buying && <span className="ml-2 text-xs text-emerald-300">buying</span>}</Td>
                                        <Td>
                                            <span className="text-muted-foreground">
                                                {o.kind === "close_to_top" ? "Close to the top: strengthen " : "Seen but skipped: rewrite the title and description of "}
                                            </span>
                                            <span className="font-mono text-xs">{o.page ?? "–"}</span>
                                        </Td>
                                        <Td right>{pos(o.position)}</Td>
                                        <Td right>{num(o.impressions)}</Td>
                                        <Td right>{pct(o.clicks, o.impressions)}</Td>
                                        <Td right>~{num(o.extra_clicks)}</Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Panel title="Rising searches" description="At least doubled against the period before: demand to stock and write for early.">
                    {(data.rising ?? []).length === 0 ? <Empty title={compare ? "Nothing rising this period." : "Not enough history yet."} body={compare ? undefined : `Rising searches need the full ${data.days} days before this period.`} /> : (
                        <ul className="divide-y text-sm">
                            {data.rising!.map((q) => (
                                <li key={q.query} className="flex items-center justify-between gap-4 px-5 py-2.5">
                                    <span className="truncate">{q.query}</span>
                                    <span className="shrink-0 tabular-nums text-muted-foreground">{num(q.prev_impressions)} → {num(q.impressions)} · {change(q.impressions, q.prev_impressions)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
                <Panel title="Landing pages" description="Search traffic per page beside the tracked visitors (only those who allowed analytics) and leads it brought.">
                    {(data.pages ?? []).length === 0 ? <Empty title="Nothing yet." /> : (
                        <ul className="divide-y text-sm">
                            {data.pages!.map((p) => (
                                <li key={p.page} className="px-5 py-2.5">
                                    <div className="flex items-center justify-between gap-4">
                                        <span className="truncate font-mono text-xs">{p.page}</span>
                                        <span className="shrink-0 tabular-nums text-muted-foreground">{num(p.clicks)} clicks · {p.visitors} visitors · {p.leads} leads</span>
                                    </div>
                                    {p.top_query && <div className="truncate text-xs text-muted-foreground">Top search: {p.top_query} · position {pos(p.position)}</div>}
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>
            </div>

            <Panel className="mt-6" title="Top searches" description="By clicks, then impressions. Up to 200; the CSV has the same rows."
                action={<Button variant="outline" size="sm" onClick={exportCsv} disabled={queries.length === 0}><Download className="mr-2 h-4 w-4" />Export CSV</Button>}>
                {queries.length === 0 ? <Empty title="No searches this period." /> : (
                    <div className="max-h-[32rem] overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                                <tr><Th>Search</Th><Th>Topic</Th><Th right>Clicks</Th><Th right>Impressions</Th><Th right>Click-through</Th><Th right>Position</Th><Th>Page</Th></tr>
                            </thead>
                            <tbody className="divide-y">
                                {queries.map((q) => (
                                    <tr key={q.query}>
                                        <Td>{q.query}</Td>
                                        <Td><span className="text-muted-foreground">{TOPIC_LABEL[q.topic] ?? q.topic}</span></Td>
                                        <Td right>{num(q.clicks)}</Td>
                                        <Td right>{num(q.impressions)}</Td>
                                        <Td right>{pct(q.clicks, q.impressions)}</Td>
                                        <Td right>{pos(q.position)}</Td>
                                        <Td mono>{q.page ?? "–"}</Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
        </>
    );
}
