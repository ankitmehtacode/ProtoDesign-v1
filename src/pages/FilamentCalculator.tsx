import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Choice, SendToWhatsApp } from "@/components/tools/parts";
import { LeadCapture } from "@/components/LeadCapture";
import { apiService } from "@/services/api.service";
import { formatINR } from "@/lib/currency";
import { flushAndWait, visitorId } from "@/lib/analytics";
import { PAGES } from "@/seo/site.js";

/*
 * Filament calculator: monthly use, spool life and cost at the shop's own
 * prices. Computed on the server (backend/src/services/tools.service.js).
 */

const MATERIALS = ["PLA", "PETG", "ABS", "Carbon Fiber", "Nylon Fiber"] as const;
type Material = (typeof MATERIALS)[number];

interface Estimate {
    result: {
        material: string; headline: string; grams_per_month: number; spools_per_month: number; days_per_spool: number | null;
        cost_per_month: number | null; bulk: boolean;
        pick: { id: string; name: string; slug: string | null; price: number; spool_kg: number; assumed_kg: boolean } | null;
    };
    whatsappUrl: string | null;
}

const page = PAGES["/filament-calculator"];

export default function FilamentCalculator() {
    const [material, setMaterial] = useState<Material | null>(null);
    const [printsPerWeek, setPrintsPerWeek] = useState("5");
    const [gramsPerPrint, setGramsPerPrint] = useState("100");
    const [loading, setLoading] = useState(false);
    const [estimate, setEstimate] = useState<Estimate | null>(null);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!material) { toast.error("Please choose a material."); return; }
        setLoading(true);
        try {
            await flushAndWait(); // so the server knows this visitor and links the result to them
            const res = await apiService.request("/tools/filament-estimator", {
                method: "POST",
                skipAuth: true,
                body: JSON.stringify({
                    inputs: { material, printsPerWeek: Number(printsPerWeek), gramsPerPrint: Number(gramsPerPrint) },
                    visitorId: visitorId() ?? undefined,
                }),
            });
            setEstimate(res as Estimate);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not calculate. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const r = estimate?.result;
    return (
        <main className="container mx-auto max-w-3xl px-4 pb-20 pt-28">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Filament calculator</p>
            <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">{page.h1}</h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">{page.intro}</p>

            <form onSubmit={submit} className="mt-10 space-y-6 rounded-2xl border bg-card p-6 md:p-8">
                <Choice<Material> label="Material" name="material" value={material} onChange={setMaterial}
                    options={MATERIALS.map((m) => ({ value: m, label: m }))} />
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                        <Label htmlFor="ppw">Prints a week</Label>
                        <Input id="ppw" type="number" inputMode="numeric" min={1} max={500} required value={printsPerWeek} onChange={(e) => setPrintsPerWeek(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="gpp">Grams per print</Label>
                        <Input id="gpp" type="number" inputMode="numeric" min={1} max={5000} required value={gramsPerPrint} onChange={(e) => setGramsPerPrint(e.target.value)} />
                        <p className="text-xs text-muted-foreground">Your slicer shows this for each print.</p>
                    </div>
                </div>
                <Button type="submit" size="lg" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Calculate
                </Button>
            </form>

            {r && estimate && (
                <section className="mt-12 space-y-6" aria-live="polite">
                    <h2 className="font-display text-2xl font-bold">{r.headline}</h2>
                    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {[
                            ["A month", `${(r.grams_per_month / 1000).toFixed(1)} kg`],
                            ["Spools a month", r.pick ? String(r.spools_per_month) : "–"],
                            ["A spool lasts", r.days_per_spool ? `${r.days_per_spool} days` : "–"],
                            ["Cost a month", r.cost_per_month !== null ? formatINR(r.cost_per_month) : "–"],
                        ].map(([label, value]) => (
                            <div key={label} className="rounded-xl border bg-card p-4">
                                <dt className="text-xs text-muted-foreground">{label}</dt>
                                <dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd>
                            </div>
                        ))}
                    </dl>
                    {r.pick ? (
                        <p className="text-sm text-muted-foreground">
                            Priced at {formatINR(r.pick.price)} for a {r.pick.spool_kg} kg spool of{" "}
                            <Link to={`/product/${r.pick.slug || r.pick.id}`} className="underline">{r.pick.name}</Link>
                            {r.pick.assumed_kg ? " (its weight is not listed, so we assumed 1 kg)" : ""}.
                        </p>
                    ) : (
                        <p className="text-sm text-muted-foreground">We have no {r.material} in stock right now, so there is no price to show.</p>
                    )}
                    <SendToWhatsApp url={estimate.whatsappUrl} what="estimate" />
                    {r.bulk && <LeadCapture interest="filament" form="filament_calculator_bulk" productId={r.pick?.id} productName={r.pick?.name} />}
                </section>
            )}
        </main>
    );
}
