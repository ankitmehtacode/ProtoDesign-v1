import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_DOT, type Tone } from "./model";

/* Small building blocks shared by every admin section. */

const TONES: Record<Tone, string> = {
    neutral: "bg-muted text-foreground/70 ring-foreground/10",
    amber: "bg-amber-500/10 text-amber-300 ring-amber-600/20",
    blue: "bg-sky-500/10 text-sky-300 ring-sky-600/20",
    violet: "bg-violet-500/10 text-violet-300 ring-violet-600/20",
    green: "bg-emerald-500/10 text-emerald-300 ring-emerald-600/20",
    red: "bg-rose-500/10 text-rose-300 ring-rose-600/20",
};

export const StatusBadge = ({ label, tone }: { label: string; tone: Tone }) => (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone])}>
        <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
        {label}
    </span>
);

/** A metric with its change against the previous period. `invert` for metrics where down is good. */
export function Kpi({
    label, value, change, hint, invert = false, icon,
}: { label: string; value: string; change: number | null; hint?: string; invert?: boolean; icon?: ReactNode }) {
    const up = change !== null && change > 0.0005;
    const down = change !== null && change < -0.0005;
    const good = invert ? down : up;
    const bad = invert ? up : down;
    return (
        <div className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_hsl(160_35%_11%/0.04)]">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{label}</span>
                {icon}
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums tracking-tight">{value}</p>
            <div className="mt-1 flex items-center gap-1.5 text-xs">
                {change === null ? (
                    // Nothing to compare with: just the context, no fake 0%.
                    !hint && <span className="text-muted-foreground">No earlier period to compare</span>
                ) : (
                    <span className={cn("inline-flex items-center gap-0.5 font-medium", good && "text-emerald-300", bad && "text-rose-300", !good && !bad && "text-muted-foreground")}>
                        {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : down ? <ArrowDownRight className="h-3.5 w-3.5" /> : <Minus className="h-3 w-3" />}
                        {Math.abs(change * 100).toFixed(change !== 0 && Math.abs(change) < 0.1 ? 1 : 0)}%
                    </span>
                )}
                {hint && <span className="text-muted-foreground">{hint}</span>}
            </div>
        </div>
    );
}

export const Panel = ({ title, description, action, children, className }: {
    title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string;
}) => (
    <section className={cn("rounded-xl border bg-card shadow-[0_1px_2px_hsl(160_35%_11%/0.04)]", className)}>
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
                <h2 className="text-sm font-semibold">{title}</h2>
                {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            </div>
            {action}
        </header>
        {children}
    </section>
);

export const PageHeader = ({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) => (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
            <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
);

/** Segmented filter with counts, e.g. order status tabs. */
export function FilterPills<T extends string>({ value, onChange, options }: {
    value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number; tone?: Tone }[];
}) {
    return (
        <div role="tablist" className="flex flex-wrap gap-1.5">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors",
                        value === o.value ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground/70 hover:text-foreground",
                    )}
                >
                    {o.tone && <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[o.tone])} />}
                    {o.label}
                    {o.count !== undefined && (
                        <span className={cn("tabular-nums", value === o.value ? "text-background/70" : "text-muted-foreground")}>{o.count}</span>
                    )}
                </button>
            ))}
        </div>
    );
}

export const Empty = ({ title, body }: { title: string; body?: string }) => (
    <div className="px-6 py-16 text-center">
        <p className="font-medium">{title}</p>
        {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
    </div>
);
