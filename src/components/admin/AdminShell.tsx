import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminSection, SECTIONS, relativeTime } from "./model";

/**
 * Sidebar layout: sections on the left with the count that needs attention in
 * each, a refresh with the time of the last load, and the section itself on
 * the right. On small screens the sections become a scrolling tab bar.
 */
export function AdminShell({ section, onSection, badges, loadedAt, refreshing, onRefresh, children }: {
    section: AdminSection;
    onSection: (s: AdminSection) => void;
    badges: Partial<Record<AdminSection, number>>;
    loadedAt: string | null;
    refreshing: boolean;
    onRefresh: () => void;
    children: ReactNode;
}) {
    const nav = (compact: boolean) => SECTIONS.map(({ key, label, icon: Icon }) => {
        const active = key === section;
        const badge = badges[key];
        return (
            <button
                key={key}
                type="button"
                onClick={() => onSection(key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                    "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                    compact ? "shrink-0 px-3 py-2" : "w-full px-3 py-2",
                    active ? "bg-foreground text-background" : "text-foreground/70 hover:bg-muted hover:text-foreground",
                )}
            >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={compact ? "" : "flex-1 text-left"}>{label}</span>
                {!!badge && (
                    <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-background/20" : "bg-amber-500/15 text-amber-300")}>{badge}</span>
                )}
            </button>
        );
    });

    return (
        <div className="min-h-screen bg-muted/30 pt-20">
            <div className="mx-auto flex max-w-[96rem]">
                <aside className="sticky top-20 hidden h-[calc(100vh-5rem)] w-60 shrink-0 flex-col border-r bg-card px-3 py-5 lg:flex">
                    <p className="px-3 pb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Admin</p>
                    <nav className="space-y-1">{nav(false)}</nav>
                    <div className="mt-auto space-y-2 px-3 text-xs text-muted-foreground">
                        <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex items-center gap-2 font-medium text-foreground/80 hover:text-foreground disabled:opacity-50">
                            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                            {refreshing ? "Refreshing…" : "Refresh data"}
                        </button>
                        {loadedAt && <p>Updated {relativeTime(loadedAt)}</p>}
                    </div>
                </aside>

                <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
                    <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto border-b px-4 pb-3 lg:hidden">
                        {nav(true)}
                        <button type="button" onClick={onRefresh} className="ml-auto shrink-0 rounded-lg px-3 py-2 text-foreground/70" aria-label="Refresh data">
                            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                        </button>
                    </div>
                    {children}
                </main>
            </div>
        </div>
    );
}
