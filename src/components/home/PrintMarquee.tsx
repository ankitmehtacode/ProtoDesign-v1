import type { CSSProperties } from "react";
import { formatINR } from "@/lib/currency";
import { quotePrice } from "@/lib/quote";
import keycaps from "@/assets/home/keycaps.webp";
import planter from "@/assets/home/planter.webp";
import lamp from "@/assets/home/lamp.webp";
import vase from "@/assets/home/vase.webp";
import skull from "@/assets/home/skull.webp";
import drone from "@/assets/home/drone.webp";
import nightlight from "@/assets/home/nightlight.webp";
import terrain from "@/assets/home/terrain.webp";
import prototype from "@/assets/home/prototype.webp";
import { SECTION_TITLE } from "./cta";

/*
 * Ideas, on a loop: tells a visitor in two seconds that whatever they have in
 * mind counts, with what it costs. Photos are Unsplash-licensed and self-hosted (see
 * src/assets/home/CREDITS.md); they show what can be printed, not our portfolio.
 * The row is doubled so the loop is seamless (translateX -50%); screen readers
 * get the list once as text. Reduced motion: no loop, swipe instead.
 */
// volume: a typical size in cm³, priced with the quote page's own formula.
const IDEAS: { label: string; src: string; volume?: number }[] = [
    { label: "Keycap set", src: keycaps, volume: 80 },
    { label: "Planter", src: planter, volume: 150 },
    { label: "Lamp shade", src: lamp, volume: 100 },
    { label: "Spiral vase", src: vase, volume: 120 },
    { label: "Sculpture", src: skull, volume: 90 },
    { label: "Drone frame", src: drone, volume: 40 },
    { label: "Night light", src: nightlight, volume: 60 },
    { label: "Terrain model", src: terrain, volume: 200 },
    { label: "Prototypes", src: prototype },
];

const Row = ({ className = "" }: { className?: string }) => (
    <ul aria-hidden className={`flex shrink-0 gap-5 pr-5 ${className}`}>
        {IDEAS.map((idea, i) => (
            <li
                key={idea.label}
                className="relative w-52 shrink-0 overflow-hidden rounded-[1.75rem] bg-muted shadow-[0_2px_4px_hsl(160_35%_11%/0.06),0_18px_36px_-18px_hsl(160_35%_11%/0.35)] transition-transform duration-300 ease-out [transform:rotate(var(--tilt))] hover:[transform:rotate(0deg)_scale(1.04)] md:w-60"
                style={{ "--tilt": `${i % 2 ? 2 : -2}deg` } as CSSProperties}
            >
                <img src={idea.src} alt="" width={560} height={700} loading="lazy" decoding="async" className="aspect-[4/5] h-auto w-full object-cover" />
                <span className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
                    <span className="rounded-full bg-background/90 px-3 py-1 text-sm font-semibold backdrop-blur-sm">{idea.label}</span>
                    {idea.volume && (
                        <span className="-rotate-3 rounded-full bg-primary px-3 py-1 font-display text-base font-bold tabular-nums text-primary-foreground">
                            {formatINR(quotePrice(idea.volume))}
                        </span>
                    )}
                </span>
            </li>
        ))}
    </ul>
);

export const PrintMarquee = () => (
    <section aria-labelledby="ideas-heading" className="overflow-hidden bg-background pb-20 pt-8 md:pb-28">
        <div className="container mx-auto px-4">
            <h2 id="ideas-heading" className={SECTION_TITLE}>
                What will you make?
            </h2>
            <p className="mt-3 max-w-xl text-muted-foreground">
                Example prices for typical sizes at the quote page's starting settings. Your file gets its exact price.
            </p>
            <p className="sr-only">
                For example: {IDEAS.map((idea) => `${idea.label.toLowerCase()}${idea.volume ? ` about ${formatINR(quotePrice(idea.volume))}` : ""}`).join(", ")}.
            </p>
        </div>
        <div className="mt-10 overflow-x-auto py-4 [scrollbar-width:none] motion-safe:overflow-x-visible">
            <div className="marquee flex w-max hover:[animation-play-state:paused]" style={{ "--marquee-duration": "60s" } as CSSProperties}>
                <Row />
                {/* The loop's second half; with reduced motion the single row just scrolls. */}
                <Row className="motion-reduce:hidden" />
            </div>
        </div>
    </section>
);
