import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Choice, SendToWhatsApp } from "@/components/tools/parts";
import { LeadCapture } from "@/components/LeadCapture";
import { apiService } from "@/services/api.service";
import { formatINR } from "@/lib/currency";
import { flushAndWait, visitorId } from "@/lib/analytics";
import { PAGES } from "@/seo/site.js";

/*
 * Printer advisor: three questions, three printers from what is in stock.
 * The ranking runs on the server (backend/src/services/tools.service.js), so
 * the result shown here is exactly what the WhatsApp bot will send.
 */

type Budget = "under_30k" | "30k_60k" | "60k_100k" | "over_100k";
type Use = "first_printer" | "functional" | "detail" | "large" | "multicolour";
type Material = "pla" | "petg_abs" | "engineering";

interface Pick { id: string; name: string; slug: string | null; price: number; image_url: string | null; reasons: string[] }
interface Advice { result: { headline: string; note: string | null; picks: Pick[] }; whatsappUrl: string | null }

const page = PAGES["/printer-advisor"];

export default function PrinterAdvisor() {
    const [budget, setBudget] = useState<Budget | null>(null);
    const [use, setUse] = useState<Use | null>(null);
    const [material, setMaterial] = useState<Material | null>(null);
    const [loading, setLoading] = useState(false);
    const [advice, setAdvice] = useState<Advice | null>(null);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!budget || !use || !material) { toast.error("Please answer all three questions."); return; }
        setLoading(true);
        try {
            await flushAndWait(); // so the server knows this visitor and links the result to them
            const res = await apiService.request("/tools/printer-advisor", {
                method: "POST",
                skipAuth: true,
                body: JSON.stringify({ inputs: { budget, use, material }, visitorId: visitorId() ?? undefined }),
            });
            setAdvice(res as Advice);
            requestAnimationFrame(() => document.getElementById("advice")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not get advice. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="container mx-auto max-w-4xl px-4 pb-20 pt-28">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Printer advisor</p>
            <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">{page.h1}</h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">{page.intro}</p>

            <form onSubmit={submit} className="mt-10 space-y-8 rounded-2xl border bg-card p-6 md:p-8">
                <Choice<Budget> label="1. What is your budget?" name="budget" value={budget} onChange={setBudget} options={[
                    { value: "under_30k", label: "Under ₹30,000" },
                    { value: "30k_60k", label: "₹30,000 – ₹60,000" },
                    { value: "60k_100k", label: "₹60,000 – ₹1,00,000" },
                    { value: "over_100k", label: "Over ₹1,00,000" },
                ]} />
                <Choice<Use> label="2. What will you print most?" name="use" value={use} onChange={setUse} options={[
                    { value: "first_printer", label: "Learning: my first printer" },
                    { value: "functional", label: "Functional parts and prototypes" },
                    { value: "detail", label: "Miniatures and fine detail" },
                    { value: "large", label: "Large parts and cosplay" },
                    { value: "multicolour", label: "Multi-colour prints" },
                ]} />
                <Choice<Material> label="3. Which materials?" name="material" value={material} onChange={setMaterial} options={[
                    { value: "pla", label: "PLA only" },
                    { value: "petg_abs", label: "PETG and ABS too" },
                    { value: "engineering", label: "Carbon fibre and nylon" },
                ]} />
                <Button type="submit" size="lg" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Show my printers
                </Button>
            </form>

            {advice && (
                <section id="advice" className="mt-12 scroll-mt-28 space-y-6" aria-live="polite">
                    <h2 className="font-display text-2xl font-bold">{advice.result.headline}</h2>
                    {advice.result.note && <p className="text-muted-foreground">{advice.result.note}</p>}
                    <ol className="grid gap-4 md:grid-cols-3">
                        {advice.result.picks.map((p, i) => (
                            <li key={p.id} className="flex flex-col rounded-xl border bg-card p-5">
                                <span className="text-xs font-semibold text-primary">#{i + 1}</span>
                                {p.image_url && <img src={p.image_url} alt="" loading="lazy" className="mt-2 aspect-square w-full rounded-lg bg-muted object-contain" />}
                                <h3 className="mt-3 font-semibold">{p.name}</h3>
                                <p className="text-lg font-bold">{formatINR(p.price)}</p>
                                <ul className="mt-3 flex-1 space-y-1.5 text-sm text-muted-foreground">
                                    {p.reasons.map((r) => <li key={r} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-300" />{r}</li>)}
                                </ul>
                                <Button asChild variant="outline" className="mt-4"><Link to={`/product/${p.slug || p.id}`}>View printer</Link></Button>
                            </li>
                        ))}
                    </ol>
                    <SendToWhatsApp url={advice.whatsappUrl} what="printer picks" />
                    <LeadCapture interest="printer" form="printer_advisor_page" productId={advice.result.picks[0]?.id} productName={advice.result.picks[0]?.name} />
                </section>
            )}
        </main>
    );
}
