import { useLayoutEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { heat, registerMeter } from "./heat";

/*
 * A material's heat limit as an anime power meter: one cel-shaded segment per
 * 10 °C, slanted like a HUD gauge. Charging reads like a cel: the meter squashes
 * (anticipation), segments snap on one at a time behind speed lines, then an
 * impact frame (a white flash, a radial burst, a camera shake) and a sparkle pop
 * at the tip. Heat squiggles keep rising off the tip afterwards, more the hotter
 * it is, animated on steps so they move in frames rather than glide.
 * Everything is hard-edged vector: no blur, so it stays crisp at any size.
 * The markup renders the finished state, so without motion it is a still meter.
 */

// Geometry in a 300 x 64 viewBox.
const X0 = 10;
const X1 = 290;
const BODY_Y = 24;
const BODY_H = 18;
const CY = BODY_Y + BODY_H / 2;
const GAP = 2;
const SKEW = `translate(0 ${CY}) skewX(-16) translate(0 ${-CY})`;

const segWidth = (count: number) => (X1 - X0 - GAP * (count - 1)) / count;
/** Right edge of the k-th lit segment: where the tip sits. */
const tipX = (k: number, count: number) => X0 + k * (segWidth(count) + GAP) - GAP;

// Speed lines trail the tip: [y offset from centre, length].
const SPEED: [number, number][] = [[-15, 42], [-11, 64], [0, 76], [11, 58], [15, 36]];
// Impact burst: eight rays.
const RAYS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4 + Math.PI / 8);
// Four-point sparkle, centred on 0,0.
const STAR = "M0 -11 C1 -3 3 -1 11 0 C3 1 1 3 0 11 C-1 3 -3 1 -11 0 C-3 -1 -1 -3 0 -11Z";

type Props = { temp: number; max: number };

export const HeatMeter = ({ temp, max }: Props) => {
    const ref = useRef<SVGSVGElement>(null);
    const count = max / 10;
    const lit = Math.max(1, Math.round(temp / 10));
    const hot = heat(temp);
    const waves = temp >= 150 ? 3 : temp >= 90 ? 2 : 1;

    useLayoutEffect(() => {
        const svg = ref.current;
        if (!svg) return;
        const q = gsap.utils.selector(svg);
        let idle: gsap.core.Timeline | undefined;
        const n = { v: lit };

        const ctx = gsap.context(() => {
            const segs = q<SVGGElement>("[data-seg]");
            const tip = q<SVGGElement>("[data-tip]")[0];
            const rig = q<SVGGElement>("[data-rig]")[0];
            const body = q<SVGGElement>("[data-body]")[0];
            const flash = q<SVGRectElement>("[data-flash]")[0];
            const speed = q<SVGLineElement>("[data-speed]");
            const burst = q<SVGGElement>("[data-burst]")[0];
            const [star, twinkle] = q<SVGPathElement>("[data-star]");
            const wave = q<SVGPathElement>("[data-wave]");

            // Whole segments only: the fill steps, it never smears between them.
            const draw = () => {
                const k = Math.round(n.v);
                segs.forEach((s, i) => s.setAttribute("opacity", i < k ? "1" : "0"));
                gsap.set(tip, { x: tipX(k, count) });
            };

            const startIdle = () => {
                idle?.kill();
                idle = gsap.timeline({ repeat: -1 });
                wave.forEach((w, i) => {
                    idle!
                        .fromTo(w, { y: 2, opacity: 0 }, { y: -5, opacity: 1, duration: 0.3, ease: "steps(3)" }, i * 0.22)
                        .to(w, { y: -14, opacity: 0, duration: 0.45, ease: "steps(4)" }, i * 0.22 + 0.3);
                });
                idle.to(twinkle, { scale: 0.2, duration: 0.16, ease: "steps(2)", yoyo: true, repeat: 1 }, 0.5);
            };

            // Origins are set once, while unscaled: setting one mid-animation makes GSAP
            // add a compensating offset that sticks (the sparkle drifted off the tip).
            gsap.set([body, burst, star, twinkle], { transformOrigin: "50% 50%" });
            gsap.set(speed, { transformOrigin: "100% 50%" });

            const tl = gsap.timeline({ paused: true });
            tl.set([flash, burst, ...speed, ...wave], { opacity: 0 }, 0)
                .set([star, twinkle], { scale: 0 }, 0)
                // Anticipation: squash, then spring back as it charges.
                .fromTo(body, { scaleY: 1, scaleX: 1 }, { scaleY: 0.72, scaleX: 1.015, duration: 0.1, ease: "power2.in" }, 0)
                .to(body, { scaleY: 1, scaleX: 1, duration: 0.4, ease: "elastic.out(1.2, 0.45)" }, 0.1)
                // Charge: segments snap on, fast then settling, speed lines streaming off the tip.
                .fromTo(n, { v: 0 }, { v: lit, duration: 0.55, ease: "power3.out", onUpdate: draw, immediateRender: false }, 0.1)
                .fromTo(speed, { opacity: 1, scaleX: 0.2 }, { scaleX: 1, duration: 0.25, ease: "power2.out", stagger: 0.03 }, 0.1)
                .to(speed, { opacity: 0, scaleX: 0.1, duration: 0.14, ease: "steps(2)" }, 0.58)
                // Impact frame.
                .fromTo(flash, { opacity: 0.95 }, { opacity: 0, duration: 0.14, ease: "steps(2)" }, 0.64)
                .fromTo(burst, { opacity: 1, scale: 0.4 }, { opacity: 0, scale: 1.6, duration: 0.3, ease: "power2.out" }, 0.64)
                .to(rig, { keyframes: { x: [5, -4, 3, -1, 0] }, duration: 0.24, ease: "steps(5)" }, 0.64)
                .fromTo(star, { scale: 0, rotation: -90 }, { scale: 1.6, rotation: 0, duration: 0.16, ease: "power4.out" }, 0.64)
                .to(star, { scale: 1, duration: 0.3, ease: "back.out(3)" }, 0.8)
                .fromTo(twinkle, { scale: 0 }, { scale: 1, duration: 0.18, ease: "steps(3)" }, 0.74)
                .call(startIdle, undefined, 0.9);

            const settle = (v: number, time: number) => {
                idle?.kill();
                tl.pause(time);
                n.v = v;
                draw();
            };

            settle(lit, tl.duration());
            return registerMeter(svg, {
                play: () => {
                    idle?.kill();
                    tl.restart();
                },
                empty: () => settle(0, 0),
                fill: () => settle(lit, tl.duration()),
            });
        }, svg);

        return () => {
            idle?.kill();
            ctx.revert();
        };
    }, [lit, count]);

    const w = segWidth(count);
    return (
        <svg ref={ref} data-meter aria-hidden viewBox="0 0 300 64" className="block w-full max-w-sm overflow-visible">
            <g data-rig>
                <g data-body>
                    <g transform={SKEW}>
                        {/* Housing: a hard ink outline */}
                        <rect x={X0 - 4} y={BODY_Y - 4} width={X1 - X0 + 8} height={BODY_H + 8} rx="3" className="fill-background stroke-foreground/80" strokeWidth="1.5" />
                        {Array.from({ length: count }, (_, i) => {
                            const x = X0 + i * (w + GAP);
                            return (
                                <g key={i} shapeRendering="crispEdges">
                                    <rect x={x} y={BODY_Y} width={w} height={BODY_H} className="fill-foreground/[0.07]" />
                                    {i < lit && (
                                        // Cel shading: base, a hard highlight band, a hard shadow band.
                                        <g data-seg>
                                            <rect x={x} y={BODY_Y} width={w} height={BODY_H} fill={heat((i + 1) * 10)} />
                                            <rect x={x} y={BODY_Y} width={w} height={BODY_H * 0.3} fill="white" opacity="0.5" />
                                            <rect x={x} y={BODY_Y + BODY_H * 0.72} width={w} height={BODY_H * 0.28} fill="black" opacity="0.3" />
                                        </g>
                                    )}
                                </g>
                            );
                        })}
                        <rect data-flash x={X0 - 4} y={BODY_Y - 4} width={X1 - X0 + 8} height={BODY_H + 8} rx="3" fill="white" opacity="0" />
                    </g>
                </g>

                <g data-tip transform={`translate(${tipX(lit, count)} 0)`}>
                    <g transform={`translate(0 ${CY})`}>
                        {SPEED.map(([dy, len]) => (
                            <line key={dy} data-speed x1={-len - 6} x2={-6} y1={dy} y2={dy} className="stroke-foreground" strokeWidth={dy ? 1.5 : 2} strokeLinecap="round" opacity="0" />
                        ))}
                        <g data-burst opacity="0">
                            {RAYS.map((a) => (
                                <line key={a} x1={Math.cos(a) * 11} y1={Math.sin(a) * 11} x2={Math.cos(a) * 19} y2={Math.sin(a) * 19} stroke={hot} strokeWidth="2" strokeLinecap="round" />
                            ))}
                        </g>
                        {Array.from({ length: waves }, (_, i) => (
                            // Wrapped: GSAP owns the path's own transform.
                            <g key={i} transform={`translate(${(i - (waves - 1) / 2) * 8} ${-BODY_H / 2 - 5})`}>
                                <path data-wave d="M0 0 q3 -3.5 0 -7 q-3 -3.5 0 -7" fill="none" stroke={hot} strokeWidth="1.5" strokeLinecap="round" opacity="0" />
                            </g>
                        ))}
                        <path data-star d={STAR} fill="white" stroke={hot} strokeWidth="1.5" strokeLinejoin="round" />
                        <g transform="translate(12 -13) scale(0.42)">
                            <path data-star d={STAR} fill="white" stroke={hot} strokeWidth="2" />
                        </g>
                    </g>
                </g>
            </g>

            {/* Scale */}
            {Array.from({ length: max / 50 + 1 }, (_, i) => i * 50).map((c) => (
                <text key={c} x={X0 + ((X1 - X0) * c) / max} y="60" textAnchor="middle" className="fill-foreground/55 text-[9px] font-light tabular-nums">
                    {c}
                </text>
            ))}
        </svg>
    );
};
