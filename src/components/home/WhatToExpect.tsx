import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { FACTS } from "@/seo/faq.js";
import { formatINR } from "@/lib/currency";
import { INFILLS, MATERIALS, MAX_MODEL_MB, PRINTER_QUALITIES, SETUP_FEE_INR, colorHex } from "@/lib/quote";
import { SECTION_TITLE } from "./cta";

/*
 * The answers a buyer needs before they upload, set as a datasheet: numbered rows,
 * small tracked labels, light body text with the figures that decide a purchase lit
 * up. Beside it, the three numbers people ask about most, big. Every value comes from
 * the quote options (src/lib/quote.ts) or the FAQ facts (src/seo/faq.js), so this
 * cannot drift from the quote page or the policies.
 */
const layers = PRINTER_QUALITIES.map((q) => q.layerMm);

/** A figure that decides the purchase: brighter and tabular, so the eye finds it first. */
const Fig = ({ children }: { children: ReactNode }) => (
    <span className="whitespace-nowrap font-normal text-foreground tabular-nums">{children}</span>
);

const ROWS: { term: string; detail: ReactNode }[] = [
    {
        term: "Files",
        detail: <><Fig>STL</Fig> or <Fig>OBJ</Fig>, up to <Fig>{MAX_MODEL_MB} MB</Fig>, one model per request.</>,
    },
    {
        term: "Materials",
        detail: (
            <ul className="space-y-3">
                {MATERIALS.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <span className="w-12 font-normal text-foreground">{m.name}</span>
                        <span className="flex -space-x-1">
                            {m.colors.map((c) => (
                                <span
                                    key={c}
                                    title={c}
                                    className="h-5 w-5 rounded-full shadow-[0_0_0_2px_hsl(var(--background))] ring-1 ring-inset ring-foreground/20"
                                    style={{ backgroundColor: colorHex(c) }}
                                />
                            ))}
                        </span>
                        <span className="text-sm text-foreground/55">{m.colors.join(" · ")}</span>
                    </li>
                ))}
            </ul>
        ),
    },
    {
        term: "Detail",
        detail: <><Fig>{Math.min(...layers)}–{Math.max(...layers)} mm</Fig> layers, <Fig>{INFILLS[0]}–{INFILLS[INFILLS.length - 1]}%</Fig> infill.</>,
    },
    {
        term: "Price",
        detail: <>Worked out from your model's volume, layer height and infill, plus <Fig>{formatINR(SETUP_FEE_INR)}</Fig> setup. You see it live while you choose.</>,
    },
    {
        term: "Paying",
        detail: <>Send the job and we check your file first, then email you a payment link.</>,
    },
    {
        term: "Delivery",
        detail: (
            <>
                After printing: <Fig>{FACTS.deliveryMetroDays} working days</Fig> to metro cities, <Fig>{FACTS.deliveryRestDays}</Fig> to the rest of India,{" "}
                <Fig>{FACTS.deliveryRemoteDays}</Fig> to remote areas. We confirm print time when we send the payment link.
            </>
        ),
    },
    {
        term: "Shipping",
        detail: <><Fig>{formatINR(FACTS.shippingOnlineInr)}</Fig> per order paid online. <Fig>Free</Fig> on any order with a 3D printer.</>,
    },
    {
        term: "If it's wrong",
        detail: <>Arrived broken, or different from your file? Tell us within <Fig>{FACTS.returnWindowDays} days</Fig> with photos and we replace or refund it.</>,
    },
];

/** The three answers people want first, as headline figures. */
const GLANCE = [
    { value: formatINR(SETUP_FEE_INR), label: "Setup, then priced by your model" },
    { value: `${FACTS.deliveryMetroDays}`, unit: "days", label: "To metro cities after printing" },
    { value: `${FACTS.returnWindowDays}`, unit: "days", label: "Replace or refund window" },
];

const LABEL = "text-[10px] font-normal uppercase tracking-[0.2em] text-foreground/55";

export const WhatToExpect = () => (
    <section aria-labelledby="expect-heading" className="relative isolate overflow-hidden bg-background">
        {/* A faint mint wash behind the heading: the same light the hero climbs through */}
        <div aria-hidden className="absolute -left-40 top-10 -z-10 h-[36rem] w-[36rem] rounded-full [background:radial-gradient(closest-side,hsl(152_55%_45%/0.08),transparent)]" />

        <div className="container mx-auto grid gap-14 px-4 py-24 md:py-32 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-4">
                <div className="lg:sticky lg:top-32">
                    <p className={LABEL}>Before you pay</p>
                    <h2 id="expect-heading" className={`${SECTION_TITLE} mt-4`}>
                        No fine print. Just print.
                    </h2>
                    <p className="mt-6 max-w-sm font-light leading-[1.7] text-foreground/70">
                        Everything you'd ask before paying, answered. No account needed to see a price.
                    </p>

                    <dl className="mt-12 grid max-w-sm grid-cols-3 divide-x divide-foreground/10 border-t border-foreground/10 pt-6 [&>div]:px-4 [&>div:first-child]:pl-0">
                        {GLANCE.map((g) => (
                            // Term first for the markup, figure first for the eye.
                            <div key={g.label} className="flex flex-col-reverse justify-end">
                                <dt className="mt-3 text-xs font-light leading-snug text-foreground/55">{g.label}</dt>
                                <dd className="text-3xl font-extralight leading-none tracking-[-0.04em] tabular-nums text-foreground">
                                    {g.value}
                                    {g.unit && <span className="ml-1 text-sm font-light tracking-normal text-foreground/55">{g.unit}</span>}
                                </dd>
                            </div>
                        ))}
                    </dl>

                    <Link to="/custom#faq" className="group mt-7 inline-flex items-center gap-1.5 py-2.5 font-medium underline-offset-4 hover:underline">
                        More questions
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                </div>
            </div>

            <dl className="border-t border-foreground/10 lg:col-span-8">
                {ROWS.map(({ term, detail }, i) => (
                    <div
                        key={term}
                        className="group relative grid gap-3 border-b border-foreground/10 py-7 sm:grid-cols-[2.5rem_9rem_1fr] sm:gap-6 md:py-8"
                    >
                        {/* A mint rule draws across the row you're reading */}
                        <span aria-hidden className="absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-primary transition-transform duration-500 ease-out group-hover:scale-x-100" />
                        <span aria-hidden className="hidden pt-0.5 text-[11px] font-light tabular-nums text-foreground/35 transition-colors group-hover:text-primary sm:block">
                            {String(i + 1).padStart(2, "0")}
                        </span>
                        <dt className={`${LABEL} pt-1 transition-colors group-hover:text-foreground`}>{term}</dt>
                        <dd className="max-w-[58ch] text-base font-light leading-[1.7] text-foreground/65 md:text-[17px]">{detail}</dd>
                    </div>
                ))}
            </dl>
        </div>
    </section>
);
