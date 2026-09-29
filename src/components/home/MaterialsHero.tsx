import { Component, Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowRight } from "lucide-react";
import { gsap, refreshInPageOrder } from "@/lib/gsap";
import { Nozzle } from "./Nozzle";
import { PRIMARY_CTA } from "./cta";
import { LADDER } from "./materials";
import SpecularButton from "@/components/reactbits/SpecularButton";

import posterWide from "@/assets/hero-climb/w1920/0000.webp";
import posterWideSmall from "@/assets/hero-climb/w960/0000.webp";
// The portrait set is optional (phones crop the wide one without it), so its poster is looked up, not imported.
const posterTall = Object.values(import.meta.glob<string>("@/assets/hero-climb/t900/0000.webp", { eager: true, query: "?url", import: "default" }))[0];

// The film player mounts after the page has painted, so the headline and buttons never wait for it.
const HeroSequence = lazy(() => import("./HeroSequence"));

/**
 * The film is extra: if its chunk fails to download or it throws, the hero keeps
 * its poster frame and copy and the page carries on.
 * It must sit outside the lazy import to catch the import itself failing.
 */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(err: unknown) {
        console.error("[MaterialsHero] 3D scene failed; showing the hero without it.", err);
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}

/*
 * The margin story in one screen: engineering materials that let a printed
 * part do a machined part's job. Behind the promise runs the studio hero
 * (HeroSequence, a film rendered in Blender): a masked hero pumping a swing, then
 * flying spool to spool on strands of filament, climbing the heat ladder from PLA
 * to PEEK. Its first frame is the poster, so the hero is whole from first paint;
 * with reduced motion the poster is all there is.
 * The hero pins and the scroll drives the climb: GSAP scrubs one progress value
 * (smoothed, so it glides) that the film reads every frame. The copy steps
 * aside as the climb starts; a caption names the spool in hand; at PEEK the page
 * moves on to the heat ladder, which picks the same story up in detail.
 * The main button is polished metal catching the light (React Bits SpecularButton).
 */
const HEADLINE_S = 1.3;
const HEADLINE_LAYERS = 24;

export const MaterialsHero = () => {
    const ref = useRef<HTMLElement>(null);
    // The metal button is WebGL and always animating: plain button for reduced motion.
    const [still] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const toLadder = () => document.getElementById("heat-ladder")?.scrollIntoView({ behavior: still ? "auto" : "smooth" });
    // Written by the scroll timeline, read by the film each frame (no React renders).
    const progress = useRef({ p: 0 });
    const [spool, setSpool] = useState(-1);

    // Mount the 3D scene once the browser is idle after first paint.
    const [scene, setScene] = useState(false);
    useEffect(() => {
        const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
        const id = ric(() => setScene(true));
        return () => (window.cancelIdleCallback ?? window.clearTimeout)(id as number);
    }, []);

    useLayoutEffect(() => {
        const section = ref.current;
        if (!section) return;
        const q = gsap.utils.selector(section);
        const mm = gsap.matchMedia();
        mm.add({ motion: "(prefers-reduced-motion: no-preference)", phone: "(max-width: 767px)" }, (ctx) => {
            const { motion, phone } = ctx.conditions as { motion: boolean; phone: boolean };
            if (!motion) return;
            section.dataset.motion = "on";
            const tl = gsap.timeline({
                defaults: { ease: "none" },
                scrollTrigger: {
                    trigger: section,
                    start: "top top",
                    end: phone ? "+=420%" : "+=520%",
                    pin: true,
                    scrub: 1,
                    anticipatePin: 1,
                },
            });
            tl.to(progress.current, { p: 1, duration: 1 }, 0)
                // The copy steps aside as the climb begins; the caption takes over.
                .to(q("[data-copy]"), { y: -80, autoAlpha: 0, duration: 0.12, ease: "power1.in" }, 0.02)
                // With the copy gone, lift the shade that kept it readable: the climb gets the full frame.
                .to(q("[data-shade]"), { opacity: 0.25, duration: 0.14 }, 0.04)
                .to(q("[data-cue]"), { autoAlpha: 0, duration: 0.04 }, 0)
                .fromTo(q("[data-caption]"), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.06, ease: "power2.out" }, 0.1)
                // At the summit the film names every reel itself (HeroSequence), so the single caption steps aside.
                .to(q("[data-caption]"), { autoAlpha: 0, y: -12, duration: 0.025, ease: "power1.in" }, 0.915);
            return () => {
                delete section.dataset.motion;
            };
        });
        refreshInPageOrder();
        return () => mm.revert();
    }, []);

    const rung = spool >= 0 ? LADDER[spool] : null;

    return (
        <section ref={ref} aria-labelledby="hero-heading" className="group relative isolate h-[100svh] min-h-[36rem] overflow-hidden bg-background text-foreground">
            <div aria-hidden className="absolute inset-0 -z-10">
                {/* The film's first frame: painted at once, and all there is with reduced motion */}
                <picture>
                    {/* Phones get the portrait render, framed for them (HeroSequence picks the same set) */}
                    {posterTall && <source media="(orientation: portrait)" srcSet={posterTall} />}
                    <img
                        src={posterWideSmall}
                        srcSet={`${posterWideSmall} 960w, ${posterWide} 1920w`}
                        sizes="100vw"
                        alt=""
                        // React 18 only passes the lowercase attribute through, and its types don't list it.
                        {...{ fetchpriority: "high" }}
                        // Keep the hero in a narrow crop; must match HeroSequence's WIDE_FOCUS.
                        className={`absolute inset-0 h-full w-full object-cover object-[68%_50%] ${posterTall ? "portrait:object-center" : ""}`}
                    />
                </picture>
                {scene && !still && <SceneBoundary><Suspense fallback={null}><HeroSequence progress={progress} onSpool={setSpool} /></Suspense></SceneBoundary>}
                {/* Film grain over the scene */}
                <div className="absolute inset-0 opacity-[0.07] mix-blend-overlay [background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/></svg>')]" />
                {/* Dark on the left for the words, the hero left lit on the right */}
                <div data-shade className="absolute inset-0 [background:linear-gradient(90deg,hsl(var(--background))_0%,hsl(var(--background)/0.85)_30%,hsl(var(--background)/0.1)_65%,transparent_100%)]" />
                <div className="absolute inset-x-0 bottom-0 h-40 [background:linear-gradient(to_top,hsl(var(--background)),transparent)]" />
            </div>

            <div className="container mx-auto flex h-full flex-col justify-center px-4 pb-28 pt-28">
                <div data-copy className="max-w-2xl">
                    <h1 id="hero-heading" className="relative w-fit font-sans font-light leading-[0.95] tracking-[-0.045em] text-[clamp(2.75rem,6.5vw,5.75rem)]">
                        <span
                            className="layer-lines print-up block px-[0.02em]"
                            style={{ "--print-duration": `${HEADLINE_S}s`, "--layers": HEADLINE_LAYERS } as CSSProperties}
                        >
                            Print parts that replace metal.
                        </span>
                        <span
                            aria-hidden
                            className="nozzle-rise pointer-events-none absolute inset-x-0 h-0 motion-reduce:hidden"
                            style={{ "--print-duration": `${HEADLINE_S}s`, "--layers": HEADLINE_LAYERS } as CSSProperties}
                        >
                            <span
                                className="nozzle-sweep absolute bottom-0 left-0 block w-full"
                                style={{ "--print-duration": `${HEADLINE_S}s`, "--layers": HEADLINE_LAYERS } as CSSProperties}
                            >
                                <Nozzle className="absolute bottom-0 left-0 w-[0.26em] -translate-x-1/2 drop-shadow-[0_0_12px_hsl(var(--ember)/0.7)]" />
                            </span>
                        </span>
                        <span className="sr-only"> Engineering 3D printing filament, delivered across India</span>
                    </h1>
                    <p className="mt-8 max-w-md text-pretty text-base font-light leading-[1.7] tracking-[-0.005em] text-foreground/70">
                        Engineering filament, from everyday PLA to PEEK: the heat, strength and chemical resistance to do real work. Delivered anywhere in India.
                    </p>
                    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
                        {still ? (
                            <a href="#heat-ladder" className={PRIMARY_CTA}>
                                Find your material
                                <ArrowDown className="h-4 w-4" />
                            </a>
                        ) : (
                            <SpecularButton size="lg" tint="#2bd18a" tintOpacity={0.18} onClick={toLadder}>
                                <span className="inline-flex items-center gap-2 font-semibold">
                                    Find your material <ArrowDown className="h-4 w-4" />
                                </span>
                            </SpecularButton>
                        )}
                        <Link to="/filaments" className="group/link inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline">
                            Shop all filament
                            <ArrowRight className="h-4 w-4 transition-transform group-hover/link:translate-x-0.5" />
                        </Link>
                    </div>
                    <dl className="mt-14 grid max-w-md grid-cols-3 divide-x divide-foreground/10 border-t border-foreground/10 pt-5 [&>div]:px-5 [&>div:first-child]:pl-0">
                        <div>
                            <dt className="text-[10px] font-normal uppercase tracking-[0.18em] text-foreground/55">Heat, typical</dt>
                            <dd className="mt-2 text-lg font-extralight tracking-[-0.02em] tabular-nums">to 250&thinsp;°C</dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-normal uppercase tracking-[0.18em] text-foreground/55">Materials</dt>
                            <dd className="mt-2 text-lg font-extralight tracking-[-0.02em]">PLA → PEEK</dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-normal uppercase tracking-[0.18em] text-foreground/55">Composites</dt>
                            <dd className="mt-2 text-lg font-extralight tracking-[-0.02em]">CF &amp; GF</dd>
                        </div>
                    </dl>
                </div>
            </div>

            {/* The spool in hand, while the hero climbs */}
            <div data-caption aria-live="off" className="pointer-events-none absolute bottom-16 left-4 invisible opacity-0 md:bottom-20 md:left-auto md:right-12 md:text-right">
                <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/55 tabular-nums">
                    {rung ? `${String(spool + 1).padStart(2, "0")} / ${String(LADDER.length).padStart(2, "0")}` : ""}
                </p>
                <p key={rung?.key} className="mt-2 text-4xl font-extralight leading-none tracking-[-0.045em] animate-in fade-in slide-in-from-bottom-2 duration-500 md:text-5xl">
                    {rung?.name}
                </p>
                <p className="mt-2 text-sm font-light text-foreground/70">
                    {rung && <>{rung.title} <span className="text-foreground/55">·</span> {rung.tempLabel}</>}
                </p>
            </div>

            {/* Scroll cue, gone as soon as the climb starts */}
            <div data-cue aria-hidden className="pointer-events-none absolute inset-x-0 bottom-8 hidden flex-col items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-foreground/70 group-data-[motion=on]:flex">
                Scroll
                <span className="relative h-10 w-px overflow-hidden bg-foreground/20">
                    <span className="absolute inset-x-0 top-0 h-1/2 animate-[cue_1.6s_ease-in-out_infinite] bg-primary" />
                </span>
            </div>
        </section>
    );
};
