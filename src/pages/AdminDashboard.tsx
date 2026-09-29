import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiService } from "@/services/api.service";
import { WhatsAppPanel } from "@/components/admin/WhatsAppPanel";
import { AdminShell } from "@/components/admin/AdminShell";
import { Overview } from "@/components/admin/Overview";
import { OrdersSection } from "@/components/admin/OrdersSection";
import { QuotesSection } from "@/components/admin/QuotesSection";
import { ProductsSection } from "@/components/admin/ProductsSection";
import { PageHeader } from "@/components/admin/ui";
import { AdminOrder, AdminProduct, AdminQuote, AdminSection, SECTIONS, TO_FULFIL, stockState } from "@/components/admin/model";

/*
 * Admin: checks the signed-in user is an admin, loads orders, quotes and the
 * whole catalogue (archived included) once, and hands them to one section at a
 * time. The section and any filter live in the URL (?tab=orders&filter=processing)
 * so a view survives a reload and can be linked. Numbers are computed in
 * components/admin/model.ts.
 */
const unwrap = <T,>(res: unknown): T => ((res as { data?: T })?.data ?? res) as T;

export default function AdminDashboard() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const tab = params.get("tab");
    const section: AdminSection = SECTIONS.some((s) => s.key === tab) ? (tab as AdminSection) : "overview";
    const filter = params.get("filter") ?? undefined;

    const [allowed, setAllowed] = useState(false);
    const [checking, setChecking] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadedAt, setLoadedAt] = useState<string | null>(null);
    const [orders, setOrders] = useState<AdminOrder[]>([]);
    const [quotes, setQuotes] = useState<AdminQuote[]>([]);
    const [products, setProducts] = useState<AdminProduct[]>([]);

    const load = useCallback(async () => {
        setRefreshing(true);
        try {
            const [o, q, p] = await Promise.all([
                apiService.getAdminOrders(),
                apiService.request("/quotes/admin/all"),
                apiService.request("/products?show_archived=true"),
            ]);
            setOrders(unwrap<AdminOrder[]>(o) ?? []);
            const qs = unwrap<AdminQuote[]>(q);
            setQuotes(Array.isArray(qs) ? qs : []);
            setProducts(unwrap<AdminProduct[]>(p) ?? []);
            setLoadedAt(new Date().toISOString());
        } catch (e) {
            console.error("Admin data load failed", e);
            toast.error("Couldn't load dashboard data. Try Refresh.");
        } finally {
            setRefreshing(false);
        }
    }, []);

    // Admins only: anyone else is sent away before any data loads.
    useEffect(() => {
        (async () => {
            try {
                if (!apiService.isAuthenticated()) { navigate("/auth"); return; }
                const me = await apiService.getCurrentUser();
                if ((me.role || me.user?.role) !== "admin") {
                    toast.error("That page is for admins only.");
                    navigate("/");
                    return;
                }
                setAllowed(true);
                await load();
            } catch (e) {
                console.error("Admin check failed", e);
                navigate("/auth");
            } finally {
                setChecking(false);
            }
        })();
    }, [navigate, load]);

    const go = (next: AdminSection, nextFilter?: string) => {
        const p = new URLSearchParams({ tab: next });
        if (nextFilter) p.set("filter", nextFilter);
        setParams(p);
        window.scrollTo({ top: 0 });
    };

    if (checking) return <div className="flex min-h-screen items-center justify-center pt-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    if (!allowed) return null;

    const badges = {
        orders: orders.filter((o) => TO_FULFIL.has(o.status)).length,
        quotes: quotes.filter((q) => q.status === "pending").length,
        products: products.filter((p) => ["out", "low"].includes(stockState(p))).length,
    };

    return (
        <AdminShell section={section} onSection={(s) => go(s)} badges={badges} loadedAt={loadedAt} refreshing={refreshing} onRefresh={load}>
            {section === "overview" && <Overview orders={orders} quotes={quotes} products={products} go={go} />}
            {section === "orders" && (
                <OrdersSection
                    key={filter}
                    orders={orders}
                    initialFilter={filter}
                    onChanged={(id, status) => setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)))}
                />
            )}
            {section === "quotes" && (
                <QuotesSection
                    key={filter}
                    quotes={quotes}
                    initialFilter={filter}
                    onChanged={(id, status) => setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, status } : q)))}
                />
            )}
            {section === "products" && <ProductsSection key={filter} products={products} initialFilter={filter} onChanged={load} />}
            {section === "whatsapp" && (
                <>
                    <PageHeader title="WhatsApp" description="Order and quote updates sent to customers on WhatsApp." />
                    <WhatsAppPanel />
                </>
            )}
        </AdminShell>
    );
}
