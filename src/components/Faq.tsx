import { FAQ } from "@/seo/faq.js";

type FaqProps = {
    items?: { q: string; a: string }[];
    heading?: string;
};

/**
 * Frequently asked questions, shown on /custom (and, with printer price
 * questions, on /printers) and prerendered from the same data
 * (scripts/prerender.mjs), so crawlers read exactly what visitors see.
 * Native <details> keeps every answer in the HTML without JavaScript.
 */
export function Faq({ items = FAQ, heading = "Questions about 3D printing with ProtoDesign" }: FaqProps) {
    if (!items.length) return null;
    return (
        <section id="faq" aria-labelledby="faq-heading" className="mx-auto mt-16 max-w-3xl">
            <h2 id="faq-heading" className="mb-6 text-2xl font-bold">{heading}</h2>
            <div className="divide-y rounded-lg border bg-card">
                {items.map(({ q, a }) => (
                    <details key={q} className="group px-5 py-4">
                        <summary className="cursor-pointer list-none font-medium marker:hidden">
                            <span className="flex items-center justify-between gap-4">
                                {q}
                                <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                            </span>
                        </summary>
                        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a}</p>
                    </details>
                ))}
            </div>
        </section>
    );
}
