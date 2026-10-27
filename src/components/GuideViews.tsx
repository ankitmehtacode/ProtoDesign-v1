/**
 * The guide pages' content: printer comparisons and custom-printing use cases
 * (data in src/seo/guides.js). Pure, with no head tags or data loading, so
 * src/seo/ssr.tsx renders the same markup for scripts/prerender.mjs that
 * visitors see; src/pages/Guides.tsx loads the catalogue and sets the head.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Faq } from "@/components/Faq";
import { formatINR } from "@/lib/currency";
import { SETUP_FEE_INR, quotePrice } from "@/lib/quote";
import { productImageUrls, sizedImage, type Product } from "@/components/shop/product";
import { FACTS } from "@/seo/faq.js";
import { comparableSpecs, festivalRegularPrice, saleLastDay } from "@/seo/site.js";
import { COMPARE_HUB, USE_CASES, USE_CASE_HUB, casePath, type ResolvedComparison, type UseCase } from "@/seo/guides.js";

export type Resolved = ResolvedComparison<Product>;

const Shell = ({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) => (
    <main className="container mx-auto max-w-4xl px-4 pb-20 pt-28">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">{intro}</p>
        {children}
    </main>
);

const LinkCard = ({ to, title, body }: { to: string; title: string; body: string }) => (
    <Link to={to} className="flex items-center justify-between gap-4 rounded-xl border bg-card p-5 hover:border-foreground/40">
        <span><span className="font-semibold">{title}</span>
            <span className="block text-sm text-muted-foreground">{body}</span></span>
        <ArrowRight className="h-5 w-5 shrink-0" />
    </Link>
);

const stockText = (p: Product) => (p.stock > 0 ? "In stock" : "Sold out");

function PriceLine({ p }: { p: Product }) {
    const regular = festivalRegularPrice({ id: p.id, name: p.name, price: p.price, list_price: p.list_price, stock: p.stock, festival: p.festival });
    return (
        <p className="mt-1">
            <span className="text-lg font-bold">{formatINR(Number(p.price))}</span>
            {regular && p.festival && (
                <span className="ml-2 text-sm text-muted-foreground">
                    <s>{formatINR(regular)}</s> {p.festival.name} until {saleLastDay(p.festival.ends_at)}
                </span>
            )}
        </p>
    );
}

// --- Comparisons -------------------------------------------------------------

export function ComparisonView({ r, others }: { r: Resolved; others: Resolved[] }) {
    const { cmp, a, b } = r;
    const specs = [comparableSpecs(a.specifications), comparableSpecs(b.specifications)].map((s) => new Map(s));
    // Only specs both listings record: "Not listed" beside a value reads as "has no Wi-Fi".
    const rows = [...specs[0].keys()].filter((k) => specs[1].has(k));
    const gap = Math.abs(Number(a.price) - Number(b.price));
    const cheaper = Number(a.price) < Number(b.price) ? cmp.a.name : cmp.b.name;
    return (
        <Shell eyebrow="Compare 3D printers" title={`${cmp.a.name} vs ${cmp.b.name}`} intro={cmp.intro}>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
                {([[a, cmp.a.name], [b, cmp.b.name]] as const).map(([p, name]) => {
                    const image = productImageUrls(p)[0];
                    return (
                        <div key={p.id} className="flex flex-col rounded-xl border bg-card p-5">
                            {image && <img src={sizedImage(image, 640)} alt={name} width={640} height={640} className="aspect-square w-full rounded-lg bg-muted object-contain" />}
                            <h2 className="mt-3 font-semibold">{name}</h2>
                            <PriceLine p={p} />
                            <p className="text-sm text-muted-foreground">GST included · Free shipping · {stockText(p)}</p>
                            <Button asChild variant="outline" className="mt-4"><Link to={`/product/${p.slug || p.id}`}>View {name}</Link></Button>
                        </div>
                    );
                })}
            </div>
            {gap > 0 && <p className="mt-4 text-sm text-muted-foreground">The {cheaper} costs {formatINR(gap)} less.</p>}

            {rows.length > 0 && (
                <section className="mt-12">
                    <h2 className="font-display text-2xl font-bold">Specifications</h2>
                    <div className="mt-4 overflow-x-auto rounded-xl border">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted/50">
                                <tr><th className="p-3 font-medium" scope="col">Spec</th><th className="p-3 font-medium" scope="col">{cmp.a.name}</th><th className="p-3 font-medium" scope="col">{cmp.b.name}</th></tr>
                            </thead>
                            <tbody className="divide-y">
                                {rows.map((row) => (
                                    <tr key={row}>
                                        <th className="p-3 font-medium" scope="row">{row}</th>
                                        <td className="p-3 text-muted-foreground">{specs[0].get(row)}</td>
                                        <td className="p-3 text-muted-foreground">{specs[1].get(row)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            <section className="mt-12">
                <h2 className="font-display text-2xl font-bold">Which should you buy?</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border bg-card p-5"><h3 className="font-semibold">Choose the {cmp.a.name} if</h3><p className="mt-2 text-sm text-muted-foreground">{cmp.chooseA}</p></div>
                    <div className="rounded-xl border bg-card p-5"><h3 className="font-semibold">Choose the {cmp.b.name} if</h3><p className="mt-2 text-sm text-muted-foreground">{cmp.chooseB}</p></div>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                    Both prices include 18% GST, and every printer ships free across India. In-stock printers are dispatched within {FACTS.dispatchDays} business days.
                </p>
            </section>

            <div className="mt-12 space-y-4">
                <LinkCard to="/printer-advisor" title="Still not sure?" body="Answer three questions and get the best three printers in stock." />
                {others.length > 0 && (
                    <section>
                        <h2 className="font-display text-xl font-bold">More comparisons</h2>
                        <ul className="mt-3 space-y-1 text-sm">
                            {others.map((o) => <li key={o.path}><Link className="hover:text-primary" to={o.path}>{o.cmp.a.name} vs {o.cmp.b.name}</Link></li>)}
                        </ul>
                    </section>
                )}
            </div>
        </Shell>
    );
}

export function CompareHubView({ items }: { items: Resolved[] }) {
    return (
        <Shell eyebrow="Compare 3D printers" title={COMPARE_HUB.h1} intro={COMPARE_HUB.intro}>
            <div className="mt-10 space-y-4">
                {items.map(({ cmp, a, b, path }) => (
                    <LinkCard key={path} to={path} title={`${cmp.a.name} vs ${cmp.b.name}`}
                        body={`${formatINR(Number(a.price))} vs ${formatINR(Number(b.price))}, GST included`} />
                ))}
                <LinkCard to="/printers" title="All 3D printers" body="Every printer we sell, with prices in rupees." />
            </div>
        </Shell>
    );
}

// --- Use cases ---------------------------------------------------------------

export function UseCaseView({ u }: { u: UseCase }) {
    const example = quotePrice(u.example.cm3);
    return (
        <Shell eyebrow="Custom 3D printing" title={u.h1} intro={u.intro}>
            <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button asChild size="lg"><Link to="/custom">Get an instant quote</Link></Button>
                <p className="text-sm text-muted-foreground">
                    Example: {u.example.label} costs about {formatINR(example)} at the quote page's default settings, including the {formatINR(SETUP_FEE_INR)} setup fee.
                </p>
            </div>

            {u.sections.map((s) => (
                <section key={s.heading} className="mt-12">
                    <h2 className="font-display text-2xl font-bold">{s.heading}</h2>
                    <ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground">
                        {s.body.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                </section>
            ))}

            <section className="mt-12">
                <h2 className="font-display text-2xl font-bold">Which material?</h2>
                <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                    {u.materials.map((m) => (
                        <div key={m.material} className="rounded-xl border bg-card p-5">
                            <dt className="font-semibold">{m.material}</dt>
                            <dd className="mt-2 text-sm text-muted-foreground">{m.use}</dd>
                        </div>
                    ))}
                </dl>
            </section>

            <Faq items={u.faq} heading={`${u.name}: common questions`} />

            <div className="mt-12 space-y-4">
                <LinkCard to="/custom" title="Upload your file" body="STL or OBJ up to 200 MB. See the price before you send the job." />
                <section>
                    <h2 className="font-display text-xl font-bold">Other things we print</h2>
                    <ul className="mt-3 space-y-1 text-sm">
                        {USE_CASES.filter((o) => o !== u).map((o) => <li key={o.slug}><Link className="hover:text-primary" to={casePath(o)}>{o.h1}</Link></li>)}
                    </ul>
                </section>
            </div>
        </Shell>
    );
}

export function UseCaseHubView() {
    return (
        <Shell eyebrow="Custom 3D printing" title={USE_CASE_HUB.h1} intro={USE_CASE_HUB.intro}>
            <div className="mt-10 space-y-4">
                {USE_CASES.map((u) => <LinkCard key={u.slug} to={casePath(u)} title={u.h1} body={u.description} />)}
                <LinkCard to="/custom" title="Get an instant quote" body="Upload an STL or OBJ and see the price." />
            </div>
        </Shell>
    );
}

