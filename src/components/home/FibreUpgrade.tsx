import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { gsap, refreshInPageOrder } from "@/lib/gsap";
import { formatINR } from "@/lib/currency";
import { FIBRES, productHref, productsFor, useCatalogue } from "./materials";
import { PRIMARY_CTA, SECTION_TITLE } from "./cta";
import weave from "@/assets/home/carbon-weave.webp";
import GhostFibers from "@/components/reactbits/GhostFibers";

/*
 * The upgrade on top of the ladder: short carbon or glass fibre mixed into a
 * base polymer. The weave photo slides against the copy as you scroll; each
 * fibre gets its gain, what it's best for, and a Buy button once listed. The
 * hardened-nozzle note is the honest catch, and a reason to shop accessories.
 * Behind it all, fibres drift in the dark (React Bits GhostFibers).
 */
export const FibreUpgrade = () => {
    const ref = useRef<HTMLElement>(null);
    const { data: catalogue } = useCatalogue();

    useLayoutEffect(() => {
        const section = ref.current;
        if (!section) return;
        const mm = gsap.matchMedia();
        mm.add("(prefers-reduced-motion: no-preference)", () => {
            gsap.fromTo(section.querySelector("[data-weave]"), { yPercent: -8, scale: 1.12 }, {
                yPercent: 8, scale: 1.12, ease: "none",
                scrollTrigger: { trigger: section, start: "top bottom", end: "bottom top", scrub: true },
            });
        });
        refreshInPageOrder();
        return () => mm.revert();
    }, []);

    return (
        <section ref={ref} aria-labelledby="fibre-heading" className="relative isolate overflow-hidden bg-background">
            <div aria-hidden className="absolute inset-0 -z-10 opacity-60 [mask-image:radial-gradient(ellipse_80%_70%_at_60%_50%,black,transparent)]">
                <GhostFibers lineColor="#9fe8c8" glowColor="#2bd18a" brightness={0.8} dpr={1} />
            </div>
            <div className="container mx-auto grid items-center gap-10 px-4 py-20 md:py-28 lg:grid-cols-2 lg:gap-16">
                <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] lg:aspect-[5/6]">
                    <img
                        data-weave
                        src={weave}
                        alt="Close-up of carbon fibre weave"
                        width={1600}
                        height={1000}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover will-change-transform"
                    />
                    <div className="absolute inset-0 [background:linear-gradient(to_top,hsl(var(--background)/0.8),transparent_55%)]" />
                    <p className="absolute bottom-6 left-6 right-6 font-display text-3xl font-extrabold leading-tight text-white md:text-4xl">
                        Same polymer.<br />Fibre inside.
                    </p>
                </div>

                <div>
                    <h2 id="fibre-heading" className={SECTION_TITLE}>
                        Add fibre. Lose the flex.
                    </h2>
                    <p className="mt-4 max-w-xl text-pretty text-foreground/70 md:text-lg">
                        Short carbon or glass fibres mixed into ABS, PETG, nylon or PPA make parts far stiffer and more dimensionally stable, and can cut weight.
                    </p>

                    <div className="mt-8 grid gap-4 sm:grid-cols-2">
                        {FIBRES.map((f) => {
                            const listed = productsFor(catalogue, f.match);
                            const cheapest = listed[0];
                            return (
                                <article key={f.key} className="flex flex-col rounded-3xl border border-foreground/10 bg-card p-6">
                                    <h3 className="font-display text-2xl font-bold">{f.name}</h3>
                                    <p className="mt-2 text-foreground/75">{f.gain}</p>
                                    <p className="mt-3 text-sm text-foreground/55">Best for: {f.bestFor}</p>
                                    <div className="mt-auto pt-6">
                                        {cheapest ? (
                                            <Link to={productHref(cheapest)} className={`${PRIMARY_CTA} w-full`}>
                                                {listed.length > 1 ? "From " : "Buy · "}{formatINR(Number(cheapest.price))}
                                                <ArrowRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-1" />
                                            </Link>
                                        ) : (
                                            <Link to="/contact" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-foreground/25 px-5 font-semibold transition-colors hover:border-foreground">
                                                Ask for {f.name.toLowerCase()}
                                                <ArrowRight className="h-4 w-4" />
                                            </Link>
                                        )}
                                    </div>
                                </article>
                            );
                        })}
                    </div>

                    <p className="mt-6 flex flex-wrap items-center gap-x-2 text-sm text-foreground/60">
                        Fibre wears through brass: print it with a hardened steel nozzle.
                        <Link to="/accessories" className="-my-3 inline-block py-3 font-semibold text-foreground underline-offset-4 hover:underline">
                            Shop nozzles and accessories
                        </Link>
                    </p>
                </div>
            </div>
        </section>
    );
};
