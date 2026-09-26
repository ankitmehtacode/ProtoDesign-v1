import { FAQ } from "@/seo/faq.js";

/**
 * Frequently asked questions, shown on /custom and prerendered from this same
 * component (scripts/prerender.mjs), so crawlers read exactly what visitors see.
 * Native <details> keeps every answer in the HTML without JavaScript.
 */
export function Faq() {
    return (
        <section id="faq" aria-labelledby="faq-heading" className="mx-auto mt-16 max-w-3xl">
            <h2 id="faq-heading" className="mb-6 text-2xl font-bold">Questions about 3D printing with ProtoDesign</h2>
            <div className="divide-y rounded-lg border bg-card">
                {FAQ.map(({ q, a }) => (
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
