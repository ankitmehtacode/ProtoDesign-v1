import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { gsap, refreshInPageOrder, ScrollTrigger } from "@/lib/gsap";
import { formatINR } from "@/lib/currency";
import { LADDER, productHref, productsFor, useCatalogue } from "./materials";
import { PRIMARY_CTA, SECTION_TITLE } from "./cta";
import MoltenMetal from "@/components/reactbits/MoltenMetal";
import { heat, meter } from "./heat";
import { HeatMeter } from "./HeatMeter";

/*
 * "How hot does your part get?" answered as an oven test, the way engineers
 * compare these materials. Each material is a printed test bar clamped to a
 * fixture at its heat limit (PLA at the bottom, PEEK at the top). Scrolling
 * heats the oven one material at a time (it snaps to each): a glowing heat front
 * rises, and every bar it passes starts to sag, more the further past its limit,
 * softening from neutral to ember. The bar you're on stands straight and lit;
 * the ones above are still cool. Labels on the rig jump straight to a material.
 * The card shows what the material survives, what it replaces, what a printer
 * needs, and its price; behind it, molten metal (React Bits MoltenMetal) heats
 * up with the oven. The temperature is stated once, on the card.
 * Static (no JS, reduced motion): the cards as a plain list.
 */
const MAX_C = 260;

// Two materials at the same limit (ABS, ASA) get their bars nudged apart.
const LABEL_C = LADDER.map((r, i) => (i && LADDER[i - 1].temp === r.temp ? r.temp + 14 : r.temp));

// Rig geometry, in a 200 x 1000 viewBox stretched over the column
// (strokes don't scale, so lines stay hairline at any size). The scale's spine
// runs at SPINE; each test bar is clamped there and reaches out to x1.
const SPINE = 34;
const RIG = { x0: SPINE + 6, x1: 196, maxSag: 70, sagPerDegree: 1.2 };
const yOf = (c: number) => 1000 * (1 - c / MAX_C);
/** Pyrometer ticks: every 10 °C, the round fifties marked long and numbered. */
const TICKS = Array.from({ length: MAX_C / 10 + 1 }, (_, i) => i * 10);
const barY = (i: number) => 1000 * (1 - LABEL_C[i] / MAX_C);
/** A bar clamped at x0, drooping by `sag` at its free end. */
const barPath = (y: number, sag: number) =>
    `M ${RIG.x0} ${y} C ${RIG.x0 + 70} ${y}, ${RIG.x1 - 60} ${y + sag * 0.8}, ${RIG.x1} ${y + sag}`;

export const HeatLadder = () => {
    const sectionRef = useRef<HTMLElement>(null);
    const { data: catalogue } = useCatalogue();

    useLayoutEffect(() => {
        const section = sectionRef.current;
        if (!section) return;
        const q = gsap.utils.selector(section);
        const mm = gsap.matchMedia();

        mm.add({ motion: "(prefers-reduced-motion: no-preference)", phone: "(max-width: 767px)" }, (ctx) => {
            const { motion, phone } = ctx.conditions as { motion: boolean; phone: boolean };
            if (!motion) return;
            section.dataset.motion = "on";

            const cards = q<HTMLElement>("[data-card]");
            const marks = q<HTMLElement>("[data-mark]");
            const bars = q<SVGPathElement>("[data-bar]");
            // One meter per card, in rung order. By its own marker: a bare "svg" also matched the
            // cards' icons, so meters[i] drifted off rung i and only PLA's ever charged.
            const meters = cards.map((card) => {
                const el = card.querySelector("[data-meter]");
                return el ? meter(el) : undefined;
            });
            const front = q<SVGRectElement>("[data-front]")[0];
            const frontLine = q<SVGLineElement>("[data-front-line]")[0];
            const stops = q<SVGStopElement>("[data-front-stop]");
            const glow = q<HTMLElement>("[data-glow]")[0];
            const readout = q<HTMLElement>("[data-readout]")[0];
            const readoutValue = q<HTMLElement>("[data-readout-value]")[0];
            const oven = { t: LADDER[0].temp };
            let active = 0;

            // Molten metal: a faint warmth at PLA, fully molten at PEEK.
            const melt = (t: number) => 0.08 + 0.82 * Math.min(1, t / 250);

            /** Draw the rig for the oven's current temperature. */
            const render = () => {
                const { t } = oven;
                const fy = 1000 * (1 - t / MAX_C);
                front.setAttribute("y", String(fy));
                front.setAttribute("height", String(1000 - fy));
                frontLine.setAttribute("y1", String(fy));
                frontLine.setAttribute("y2", String(fy));
                frontLine.style.stroke = heat(t);
                stops.forEach((el) => el.setAttribute("stop-color", heat(t)));
                glow.style.opacity = String(melt(t));
                // The live reading rides the heat front, counting as the oven climbs.
                readout.style.bottom = `${(t / MAX_C) * 100}%`;
                readout.style.color = heat(t);
                readoutValue.textContent = String(Math.round(t));
                LADDER.forEach((r, j) => {
                    const over = t - r.temp;
                    const sag = Math.max(0, Math.min(RIG.maxSag, over * RIG.sagPerDegree));
                    const bar = bars[j];
                    bar.setAttribute("d", barPath(barY(j), sag));
                    if (j === active) {
                        bar.style.stroke = heat(r.temp);
                        bar.style.filter = `drop-shadow(0 0 4px ${heat(r.temp)})`;
                    } else if (over > 0.5) {
                        bar.style.stroke = `hsl(var(--ember) / ${0.25 + 0.35 * Math.min(1, over / 60)})`;
                        bar.style.filter = "none";
                    } else {
                        bar.style.stroke = "hsl(var(--foreground) / 0.28)";
                        bar.style.filter = "none";
                    }
                    marks[j].toggleAttribute("data-active", j === active);
                    marks[j].toggleAttribute("data-failed", over > 0.5 && j !== active);
                });
            };

            gsap.set(cards.slice(1), { autoAlpha: 0, y: 40 });
            // Meters charge when their rung becomes current; the first as the section arrives.
            meters.forEach((m) => m?.empty());
            ScrollTrigger.create({ trigger: section, start: "top 70%", once: true, onEnter: () => meters[0]?.play() });

            const last = LADDER.length - 1;
            const tl = gsap.timeline({
                defaults: { ease: "power2.inOut" },
                onUpdate: render,
                scrollTrigger: {
                    trigger: section,
                    start: "top top",
                    end: phone ? "+=340%" : "+=380%",
                    pin: true,
                    scrub: 0.6,
                    anticipatePin: 1,
                    snap: { snapTo: 1 / last, duration: 0.45, ease: "power2.out", delay: 0.05 },
                    onUpdate: (self) => {
                        const i = Math.round(self.progress * last);
                        if (i !== active) {
                            active = i;
                            meters.forEach((m, j) => (j === i ? m?.play() : m?.empty()));
                            render();
                        }
                    },
                },
            });
            for (let i = 1; i <= last; i++) {
                const at = i - 1;
                tl.to(cards[i - 1], { autoAlpha: 0, y: -40, duration: 0.35 }, at + 0.1)
                    .to(oven, { t: LADDER[i].temp, duration: 0.8 }, at + 0.1)
                    .to(cards[i], { autoAlpha: 1, y: 0, duration: 0.4 }, at + 0.5);
            }
            tl.to({}, { duration: last - tl.duration() }); // one second per rung: snap points land on each
            render();

            return () => {
                delete section.dataset.motion;
                meters.forEach((m) => m?.fill());
                marks.forEach((el) => { el.removeAttribute("data-active"); el.removeAttribute("data-failed"); });
            };
        });

        refreshInPageOrder();
        return () => mm.revert();
    }, []);

    const goTo = (i: number) => {
        const section = sectionRef.current;
        if (!section || section.dataset.motion !== "on") {
            document.getElementById(`rung-${LADDER[i].key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        const spacer = section.parentElement!;
        const top = spacer.getBoundingClientRect().top + window.scrollY;
        const distance = spacer.offsetHeight - window.innerHeight;
        window.scrollTo({ top: top + (distance * i) / (LADDER.length - 1), behavior: "smooth" });
    };

    return (
        <section
            ref={sectionRef}
            id="heat-ladder"
            aria-labelledby="ladder-heading"
            className="group relative isolate overflow-clip bg-background data-[motion=on]:h-[100svh]"
        >
            {/* Molten metal on the right, heating up with the rung; faded out under the copy */}
            <div
                data-glow
                aria-hidden
                className="absolute inset-y-0 right-0 -z-10 hidden w-full opacity-0 [mask-image:linear-gradient(to_right,transparent_15%,black_65%)] group-data-[motion=on]:block md:w-[70%]"
            >
                {/* Heat palette (deep red, orange, white-hot core), not the violet default */}
                <MoltenMetal
                    colorMode="molten"
                    color1="#7a1200"
                    color2="#ff6a14"
                    color3="#ffe7b0"
                    scale={3}
                    glow={2.2}
                    brightness={1.5}
                    mouseInteraction
                    backgroundColor="#0a1511"
                />
            </div>

            <div className="container mx-auto flex h-full flex-col px-4 pb-10 pt-24 md:pt-28">
                {/* Phones, while pinned: the heading alone (no intro, no strength tags) so the tallest card still fits under it */}
                <header>
                    <div className="max-w-3xl">
                        <h2 id="ladder-heading" className={SECTION_TITLE}>
                            How hot does your part get?
                        </h2>
                        <p className="mt-5 max-w-xl text-pretty font-light leading-[1.7] text-foreground/60 max-md:group-data-[motion=on]:hidden">
                            Climb the ladder to the material that survives it. Temperatures are typical for each material and vary by grade and print settings.
                        </p>
                    </div>
                </header>

                <div className="mt-8 grid flex-1 gap-8 group-data-[motion=on]:min-h-0 group-data-[motion=on]:grid-cols-[4.5rem_1fr] md:group-data-[motion=on]:grid-cols-[16rem_1fr] md:gap-12">
                    {/* The oven test rig, read as a pyrometer: a precision scale, a live reading
                        riding the heat front, and each material's test bar clamped at its limit. */}
                    <div className="relative hidden group-data-[motion=on]:block">
                        <div className="absolute bottom-6 left-0 top-6 w-full">
                            <svg aria-hidden viewBox="0 0 200 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
                                <defs>
                                    <linearGradient id="oven-heat" x1="0" x2="0" y1="0" y2="1">
                                        <stop data-front-stop offset="0" stopColor={heat(LADDER[0].temp)} stopOpacity="0.16" />
                                        <stop data-front-stop offset="1" stopColor={heat(LADDER[0].temp)} stopOpacity="0" />
                                    </linearGradient>
                                </defs>
                                {/* Heat rising through the oven */}
                                <rect data-front x={SPINE} y="1000" width={200 - SPINE} height="0" fill="url(#oven-heat)" />
                                <line data-front-line x1={SPINE - 14} x2="200" y1="1000" y2="1000" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                                {/* The scale */}
                                <line x1={SPINE} x2={SPINE} y1="0" y2="1000" strokeWidth="1" vectorEffect="non-scaling-stroke" className="stroke-foreground/20" />
                                {TICKS.map((c) => (
                                    <line
                                        key={c}
                                        x1={SPINE - (c % 50 ? 5 : 11)}
                                        x2={SPINE}
                                        y1={yOf(c)}
                                        y2={yOf(c)}
                                        strokeWidth="1"
                                        vectorEffect="non-scaling-stroke"
                                        className={c % 50 ? "stroke-foreground/15" : "stroke-foreground/35"}
                                    />
                                ))}
                                {LADDER.map((r, j) => (
                                    <g key={r.key}>
                                        {/* Clamp */}
                                        <rect x={SPINE} y={barY(j) - 5} width="7" height="10" rx="1" className="fill-foreground/55" />
                                        <path data-bar d={barPath(barY(j), 0)} fill="none" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ stroke: "hsl(var(--foreground) / 0.28)" }} />
                                    </g>
                                ))}
                            </svg>
                            {/* Scale numbers */}
                            {TICKS.filter((c) => c % 50 === 0).map((c) => (
                                <span
                                    key={c}
                                    aria-hidden
                                    className="absolute left-0 hidden w-[calc(12%-0.25rem)] translate-y-1/2 text-right text-[9px] font-light tabular-nums tracking-[0.04em] text-foreground/55 md:block"
                                    style={{ bottom: `${(c / MAX_C) * 100}%` }}
                                >
                                    {c}
                                </span>
                            ))}
                            {/* The live reading, riding the heat front */}
                            <div
                                data-readout
                                aria-hidden
                                className="pointer-events-none absolute right-0 mb-1.5 flex items-baseline gap-0.5 font-extralight tabular-nums tracking-[-0.04em]"
                                style={{ bottom: `${(LADDER[0].temp / MAX_C) * 100}%`, color: heat(LADDER[0].temp) }}
                            >
                                <span data-readout-value className="text-2xl leading-none md:text-3xl">{LADDER[0].temp}</span>
                                <span className="text-[10px] font-light uppercase tracking-[0.12em] opacity-70">°C</span>
                            </div>
                            {/* Labels sit just above each bar and jump to that material */}
                            {LADDER.map((r, i) => (
                                <button
                                    key={r.key}
                                    type="button"
                                    data-mark
                                    onClick={() => goTo(i)}
                                    aria-label={`${r.name}, ${r.tempLabel}`}
                                    className="absolute mb-1.5 hidden whitespace-nowrap text-left text-[11px] font-light tracking-[0.01em] text-foreground/55 transition-[color,font-size] duration-300 hover:text-foreground data-[active]:text-[13px] data-[active]:font-normal data-[active]:text-foreground data-[failed]:text-foreground/50 data-[failed]:line-through data-[failed]:decoration-[hsl(var(--ember)/0.6)] md:block"
                                    style={{ left: `calc(${(RIG.x0 / 200) * 100}% + 2px)`, bottom: `${(LABEL_C[i] / MAX_C) * 100}%` }}
                                >
                                    {r.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* The rungs. Static: a list. Animated: one card at a time. */}
                    <div className="relative grid gap-12 group-data-[motion=on]:block">
                        {LADDER.map((r) => {
                            const listed = productsFor(catalogue, r.match, r.exclude);
                            const cheapest = listed[0];
                            return (
                                <article
                                    key={r.key}
                                    id={`rung-${r.key}`}
                                    data-card
                                    aria-label={r.name}
                                    className="group-data-[motion=on]:absolute group-data-[motion=on]:inset-0 group-data-[motion=on]:flex group-data-[motion=on]:items-center max-md:group-data-[motion=on]:items-start"
                                >
                                    <div className="grid w-full items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
                                        <div className="max-w-2xl">
                                            <p className="flex items-baseline gap-1.5 leading-none" style={{ color: heat(r.temp) }}>
                                                <span className="text-4xl font-extralight tabular-nums tracking-[-0.04em] md:text-5xl">{r.tempFigure}</span>
                                                <span className="text-sm font-light tracking-[0.08em]">°C</span>
                                            </p>
                                            <div className="mt-4">
                                                <HeatMeter temp={r.temp} max={MAX_C} />
                                            </div>
                                            <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-foreground/55">
                                                {r.tempNote ?? "Typical heat limit"}
                                            </p>
                                            <h3 className="mt-4 text-xl font-light tracking-[-0.02em] md:text-2xl">
                                                {r.name} <span className="text-foreground/55">· {r.title}</span>
                                            </h3>
                                            <p className="mt-4 max-w-xl text-pretty font-light leading-[1.7] text-foreground/60">{r.body}</p>
                                            <ul className="mt-5 flex flex-wrap gap-2 max-md:group-data-[motion=on]:hidden">
                                                {r.strengths.map((s) => (
                                                    <li key={s} className="rounded-full border border-foreground/10 px-3 py-1 text-xs font-light tracking-[0.01em] text-foreground/70">{s}</li>
                                                ))}
                                            </ul>
                                            <dl className="mt-6 grid items-baseline gap-x-4 gap-y-2.5 text-sm font-light text-foreground/80 sm:grid-cols-[7rem_1fr]">
                                                <dt className="text-[10px] uppercase tracking-[0.18em] text-foreground/55">Replaces</dt>
                                                <dd>{r.replaces}</dd>
                                                <dt className="text-[10px] uppercase tracking-[0.18em] text-foreground/55">Your printer</dt>
                                                <dd>{r.needs}</dd>
                                            </dl>
                                            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
                                                {cheapest ? (
                                                    <Link to={productHref(cheapest)} className={PRIMARY_CTA}>
                                                        Buy {r.name} · {listed.length > 1 ? "from " : ""}{formatINR(Number(cheapest.price))}
                                                        <ArrowRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-1" />
                                                    </Link>
                                                ) : (
                                                    <Link to="/contact" className={PRIMARY_CTA}>
                                                        Ask for {r.name}
                                                        <ArrowRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-1" />
                                                    </Link>
                                                )}
                                                {listed.length > 1 && (
                                                    <Link to="/filaments" className="text-sm font-light text-foreground/70 underline-offset-4 hover:text-foreground hover:underline">
                                                        See all {listed.length}
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                        {r.photo && (
                                            <figure className="hidden overflow-hidden rounded-[1.75rem] border border-foreground/10 shadow-[0_30px_60px_-24px_black] lg:block">
                                                <img src={r.photo} alt={`ProtoDesign ${r.name} filament spool with printed parts`} width={1200} height={800} decoding="async" className="aspect-[3/2] w-full object-cover" />
                                            </figure>
                                        )}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
};
