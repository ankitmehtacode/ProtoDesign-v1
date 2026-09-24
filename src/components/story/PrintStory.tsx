import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Volume2, VolumeX } from "lucide-react";
import { gsap, refreshInPageOrder } from "@/lib/gsap";
import logoMark from "@/assets/logo-mark-dark.webp";
import { PrintAudio } from "./printAudio";
import { Smoke } from "./smoke";

/*
 * The print job, told as a race. The section is a printer's textured build
 * plate; scrolling runs a two-filament job that prints an F1 car layer by
 * layer (each layer a lap), styled like F1 broadcast graphics. When the print
 * is done the part is cleaned up into the finished car, which does a burnout
 * and launches off the bed with tyre smoke and, if the visitor turns it on,
 * engine sound.
 *
 * Precision: the nozzle follows a real toolpath. The car is rasterised once
 * to find where each layer has material; the nozzle traces each layer edge to
 * edge, alternating direction like a slicer, and material appears only behind
 * its tip. The launch uses constant acceleration, and wheel rotation is tied
 * to distance travelled.
 *
 * The default markup is the finished car parked with the CTA visible, which is
 * what no-JS and reduced-motion visitors get.
 */

// --- Geometry (viewBox units) ------------------------------------------------

const VB_W = 1000;
const VB_Y = 60;
const VB_H = 270;
const GROUND = 300;
const TOP = 130;
const LAYERS = 100;
const LAYER_H = (GROUND - TOP) / LAYERS; // 1.7 units
// The toolhead and gantry are drawn in millimetres from real parts (V6-style
// hotend, 3010 heatsink fan, 4010 blower, MGN9 rail on a 2020 extrusion) with
// the nozzle tip at the origin, then scaled by this into viewBox units.
const HEAD_MM = 1.3;
const PARK = { x: 985, y: TOP - 30 };

const NOZZLE_C = 220;
const BED_C = 60;
const ROOM_C = 24;

type Shape =
    | { kind: "path"; d: string }
    | { kind: "rect"; x: number; y: number; w: number; h: number; r?: number }
    | { kind: "circle"; cx: number; cy: number; r: number };

type Part = { id: string; name: string; letter: string; base: string; hi: string; lo: string; ring: string; shapes: Shape[] };

/** A straight link (wishbone, pushrod, stalk) as a filled quad `w` units thick. */
function bar(x1: number, y1: number, x2: number, y2: number, w: number): Shape {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const nx = (-(y2 - y1) / len) * (w / 2);
    const ny = ((x2 - x1) / len) * (w / 2);
    const p = (x: number, y: number) => `${(x).toFixed(1)} ${(y).toFixed(1)}`;
    return { kind: "path", d: `M ${p(x1 + nx, y1 + ny)} L ${p(x2 + nx, y2 + ny)} L ${p(x2 - nx, y2 - ny)} L ${p(x1 - nx, y1 - ny)} Z` };
}

/*
 * A 2022-regulation car in side view, nose to the right, drawn to scale at
 * 1 unit = 6 mm: 3600 mm wheelbase (axles at x 200 and 800), 720 mm tyres on
 * 18" rims, 950 mm tall, ground at y 300. From the side the sidepods sit
 * inside the chassis silhouette, so they are read from the finishing detail
 * (inlet, undercut, downwash) rather than from a separate shape.
 *
 * Paint order: where parts overlap the later one is in front (black wing
 * elements over red endplates, visor over helmet, tyres over everything).
 * Colours sampled from a printed FV01 model.
 */
const PARTS: Part[] = [
    {
        id: "body", name: "Matte red", letter: "R", ring: "hsl(352 80% 50%)",
        base: "hsl(352 68% 34%)", hi: "hsl(352 52% 46%)", lo: "hsl(354 72% 17%)",
        shapes: [
            // Nose, monocoque, cockpit rim, headrest, airbox, engine cover, coke bottle.
            { kind: "path", d: "M 958 251 C 905 238 830 214 762 204 C 715 198 668 191 634 188 L 510 189 C 507 172 501 153 494 145 Q 489 140 480 141 L 468 142 C 428 150 332 184 252 209 C 214 220 182 227 160 231 L 152 250 L 236 262 C 262 270 290 280 320 284 L 660 284 C 690 272 720 258 762 250 C 840 253 918 262 956 262 C 966 262 968 254 958 251 Z" },
            // Rear wing endplates: 2022 rolled tips sweeping forward into the top.
            { kind: "path", d: "M 62 240 C 60 204 58 172 64 154 C 70 140 94 137 126 141 L 128 149 C 102 147 86 152 81 168 L 82 238 Z" },
            // Front wing endplate.
            { kind: "path", d: "M 985 296 L 999 296 C 999 280 996 264 986 252 L 976 252 C 983 266 985 282 985 296 Z" },
            // Helmet.
            { kind: "circle", cx: 540, cy: 175, r: 17 },
        ],
    },
    {
        id: "carbon", name: "Satin black", letter: "B", ring: "hsl(0 0% 92%)",
        base: "hsl(220 7% 11%)", hi: "hsl(220 6% 26%)", lo: "hsl(220 10% 4%)",
        shapes: [
            // Floor, curled leading edge, plank.
            { kind: "path", d: "M 262 284 L 668 284 C 684 283 694 279 702 272 L 708 275 C 700 286 688 292 668 292 L 262 292 Z" },
            { kind: "rect", x: 330, y: 292, w: 330, h: 4, r: 1.5 },
            // Diffuser sidewall, kicking up behind the rear axle.
            { kind: "path", d: "M 268 284 L 268 292 C 210 291 140 284 76 266 L 70 250 C 130 258 200 272 268 284 Z" },
            // Gearbox casing and rear crash structure.
            { kind: "path", d: "M 160 231 L 152 250 L 150 256 L 92 251 L 64 245 L 64 233 L 100 231 Z" },
            // Rear wing: mainplane, DRS flap, swan-neck pylon, two-element beam wing.
            { kind: "path", d: "M 132 171 C 120 164 96 162 72 168 L 72 172 C 96 172 118 175 132 176 Z" },
            { kind: "path", d: "M 116 158 C 104 150 86 145 66 145 L 66 149 C 86 151 104 157 116 163 Z" },
            bar(108, 232, 102, 172, 5),
            { kind: "path", d: "M 140 218 C 122 213 98 212 80 215 L 80 218 C 98 216 122 217 140 222 Z" },
            { kind: "path", d: "M 134 227 C 118 223 100 223 86 225 L 86 228 C 100 227 118 227 134 230 Z" },
            // Halo: rear mounts on the chassis, over the helmet, centre strut to the front.
            { kind: "path", d: "M 504 189 C 508 170 514 160 528 157 L 600 156 C 616 156 632 168 650 186 L 644 189 C 628 172 614 163 600 163 L 530 164 C 520 166 514 174 511 189 Z" },
            // Visor.
            { kind: "path", d: "M 546 166 C 553 166 557 170 557 177 L 541 178 L 541 168 Z" },
            // Onboard camera (T-cam) on the airbox.
            { kind: "rect", x: 474, y: 135, w: 14, h: 4, r: 1.5 },
            // Mirror housing on its stalk.
            { kind: "rect", x: 596, y: 182, w: 18, h: 7, r: 2.5 },
            bar(606, 188, 610, 199, 2.5),
            // Front suspension: upper and lower wishbones, pushrod, track rod.
            bar(792, 226, 740, 212, 3),
            bar(800, 262, 746, 252, 3),
            bar(794, 258, 752, 214, 2.5),
            bar(812, 244, 756, 236, 2),
            // Front wing: four elements sweeping up to meet the nose.
            { kind: "path", d: "M 994 287 C 960 283 920 284 880 288 L 880 293 C 920 291 960 292 994 293 Z" },
            { kind: "path", d: "M 970 279 C 940 275 905 276 874 281 L 874 284 C 905 282 940 281 970 283 Z" },
            { kind: "path", d: "M 952 270 C 925 266 895 267 868 273 L 868 276 C 895 272 925 272 952 274 Z" },
            { kind: "path", d: "M 932 261 C 908 257 884 259 862 265 L 862 268 C 884 263 908 263 932 265 Z" },
            // Wheel-wake winglet over the front tyre.
            { kind: "path", d: "M 772 178 C 790 172 812 172 830 178 L 828 181 C 812 176 790 176 774 181 Z" },
            // Tyres.
            { kind: "circle", cx: 200, cy: 240, r: 60 },
            { kind: "circle", cx: 800, cy: 240, r: 60 },
        ],
    },
];
const CARBON = PARTS.findIndex((p) => p.id === "carbon");

const WHEELS = [
    { cx: 200, cy: 240, r: 60 },
    { cx: 800, cy: 240, r: 60 },
];

const ShapeEl = ({ s }: { s: Shape }) =>
    s.kind === "path" ? <path d={s.d} />
        : s.kind === "rect" ? <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} />
            : <circle cx={s.cx} cy={s.cy} r={s.r} />;

const Shapes = ({ part }: { part: Part }) => <>{part.shapes.map((s, i) => <ShapeEl key={i} s={s} />)}</>;

/*
 * Surface detail on the red bodywork, painted inside the body's clip before the
 * black parts: sidepod inlet, undercut and downwash, engine-cover louvres,
 * airbox, cockpit padding, panel shut lines, and the light along each crease.
 */
const BodyDetail = () => (
    <>
        {/* Sidepod: lit top face and shoulder, inlet mouth, shadowed undercut */}
        <path d="M 612 199 C 540 199 450 210 368 232 C 330 244 300 258 288 268 L 292 272 C 306 262 334 250 372 240 C 452 218 540 206 612 205 Z" fill="white" fillOpacity="0.06" />
        <path d="M 612 201 C 540 202 450 214 370 236 C 332 248 302 262 290 271" fill="none" stroke="white" strokeOpacity="0.16" strokeWidth="1.2" />
        <path d="M 290 272 C 320 262 360 250 400 242 C 380 256 344 272 322 284 L 300 284 Z" fill="black" fillOpacity="0.2" />
        <path d="M 620 238 C 590 256 520 272 430 280 L 420 284 L 660 284 C 646 270 632 252 620 238 Z" fill="black" fillOpacity="0.4" />
        <path d="M 620 238 C 590 256 520 272 430 280" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="1" />
        <path d="M 606 203 C 609 202 612 203 613 206 L 619 237 C 616 239 613 238 612 235 Z" fill="hsl(220 14% 4%)" />
        <path d="M 606 203 C 608 214 610 226 612 235" fill="none" stroke="white" strokeOpacity="0.2" strokeWidth="0.8" />
        {/* Engine cover spine, cooling louvres, airbox inlet */}
        <path d="M 490 147 C 430 154 338 188 270 207" fill="none" stroke="white" strokeOpacity="0.14" strokeWidth="1" />
        {[310, 322, 334, 346, 358].map((x) => (
            <g key={x}>
                <path d={`M ${x} 222 l 9 -4 l 0 2.2 l -9 4 Z`} fill="black" fillOpacity="0.55" />
                <path d={`M ${x} 224.6 l 9 -4`} stroke="white" strokeOpacity="0.12" strokeWidth="0.5" />
            </g>
        ))}
        <path d="M 492 147 C 497 151 501 160 503 170 L 497 171 C 495 161 491 153 486 149 Z" fill="black" fillOpacity="0.6" />
        {/* Cockpit padding and helmet highlight */}
        <path d="M 511 189.5 L 633 188.5" stroke="hsl(220 8% 8%)" strokeWidth="2.4" />
        <path d="M 528 168 A 14 14 0 0 1 546 161" fill="none" stroke="white" strokeOpacity="0.25" strokeWidth="1.2" strokeLinecap="round" />
        {/* Shut lines: nose to chassis, engine cover to sidepod */}
        <g fill="none" stroke="black" strokeOpacity="0.35" strokeWidth="0.7">
            <path d="M 764 205 C 766 220 766 236 764 250" />
            <path d="M 506 194 C 480 204 440 222 410 240" />
        </g>
        {/* Chassis flank light and the shadow under the nose */}
        <path d="M 636 197 C 700 201 760 211 830 225 C 880 235 920 245 952 253" fill="none" stroke="white" strokeOpacity="0.07" strokeWidth="3" strokeLinecap="round" />
        <path d="M 762 250 C 840 253 918 262 956 262" fill="none" stroke="black" strokeOpacity="0.35" strokeWidth="2" />
    </>
);

// M3 socket head cap screw seen end-on: 5.5 mm head, 2.5 mm hex socket.
const SOCKET = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${i ? "L" : "M"} ${(1.44 * Math.cos(a)).toFixed(2)} ${(1.44 * Math.sin(a)).toFixed(2)}`;
}).join(" ") + " Z";

const CapScrew = ({ x, y }: { x: number; y: number }) => (
    <g transform={`translate(${x} ${y})`}>
        <circle r="2.75" fill="url(#job-hd-screw)" />
        <path d={SOCKET} fill="hsl(220 10% 5%)" />
    </g>
);

// Rail bolt pitch for MGN9 is 20 mm; enough holes to run past both bed edges.
const RAIL_HOLES = Array.from({ length: Math.ceil((VB_W + 120) / (20 * HEAD_MM)) + 1 }, (_, i) => -60 + i * 20 * HEAD_MM);

function toPath2D(s: Shape): Path2D {
    if (s.kind === "path") return new Path2D(s.d);
    const p = new Path2D();
    if (s.kind === "circle") p.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
    else if (s.r && typeof p.roundRect === "function") p.roundRect(s.x, s.y, s.w, s.h, s.r);
    else p.rect(s.x, s.y, s.w, s.h);
    return p;
}

/**
 * Rasterise the car once: per-layer material extents (where the nozzle must
 * travel) and a part lookup (which filament is under the nozzle).
 */
function rasterise() {
    const RS = 2;
    const W = VB_W * RS;
    const H = VB_H * RS;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    g.setTransform(RS, 0, 0, RS, 0, -VB_Y * RS);
    PARTS.forEach((part, i) => {
        g.fillStyle = `rgb(${(i + 1) * 80},0,0)`;
        part.shapes.forEach((s) => g.fill(toPath2D(s)));
    });
    const px = g.getImageData(0, 0, W, H).data;

    const partAt = (x: number, y: number) => {
        const ix = Math.round(x * RS);
        const iy = Math.round((y - VB_Y) * RS);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) return -1;
        const o = (iy * W + ix) * 4;
        return px[o + 3] < 128 ? -1 : Math.round(px[o] / 80) - 1;
    };

    const extents: [number, number][] = [];
    for (let l = 0; l < LAYERS; l++) {
        const iy = Math.round((GROUND - (l + 0.5) * LAYER_H - VB_Y) * RS);
        let mn = -1;
        let mx = -1;
        for (let ix = 0; ix < W; ix++) {
            if (px[(iy * W + ix) * 4 + 3] >= 128) {
                if (mn < 0) mn = ix;
                mx = ix;
            }
        }
        extents.push(mn < 0 ? (extents[l - 1] ?? [40, 960]) : [mn / RS, mx / RS]);
    }
    return { partAt, extents };
}

// --- Race control ------------------------------------------------------------

type Phase = "intro" | "print" | "done" | "finished" | "launched";

function raceControl(phase: Phase, layer: number, homed: boolean): string {
    switch (phase) {
        case "intro": return homed ? "On the grid" : "Formation lap";
        case "print": return layer < 20 ? "Sector 1 · tyres, floor" : layer < 60 ? "Sector 2 · chassis, sidepods" : "Sector 3 · halo, airbox, wing";
        case "done": return "Chequered flag";
        case "finished": return "Parc fermé";
        case "launched": return "Lights out";
    }
}

// Textured PEI build plate: fine gold speckle over warm black.
const PLATE_NOISE = `url("data:image/svg+xml,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.85  0 0 0 0 0.66  0 0 0 0 0.35  0 0 0 1.6 -0.9'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='0.55'/></svg>",
)}")`;

// Timeline positions (timeline seconds, mapped onto scroll).
const T_HEAT = 1.0;
const T_HOME = 0.4;
const T_PRINT = T_HEAT + T_HOME + 0.1;
const T_PRINT_LEN = 7;
const T_PARK = T_PRINT + T_PRINT_LEN + 0.1;
const T_FINISH = T_PARK + 1;
const T_LAUNCH = T_FINISH + 1.2;

// The getaway runs in real time (seconds), not on scroll.
const BURNOUT = 0.34;
const EXIT = 1.3;

const heatColour = (f: number) => `hsl(${Math.round(210 - 210 * f)} 85% 55%)`;

// --- Component --------------------------------------------------------------

/** Temperature readout, styled like a tyre-temperature box. */
const Temp = ({ label, hud, value }: { label: string; hud: string; value: number }) => (
    <div className="min-w-[4.5rem]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">{label}</p>
        <p className="text-lg font-bold italic leading-tight tabular-nums text-white"><span data-hud={hud}>{value}°</span></p>
        <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
            <div data-bar={hud} className="h-full w-full origin-left rounded-full" style={{ backgroundColor: heatColour(1) }} />
        </div>
    </div>
);


export const PrintStory = () => {
    const sectionRef = useRef<HTMLElement>(null);
    const audioRef = useRef<PrintAudio | null>(null);
    const [soundOn, setSoundOn] = useState(false);

    const toggleSound = async () => {
        audioRef.current ??= new PrintAudio();
        if (audioRef.current.enabled) {
            audioRef.current.disable();
            setSoundOn(false);
        } else {
            try {
                await audioRef.current.enable();
                setSoundOn(true);
            } catch (error) {
                console.warn("PrintStory: audio unavailable", error);
            }
        }
    };

    useLayoutEffect(() => () => audioRef.current?.dispose(), []);

    useLayoutEffect(() => {
        const section = sectionRef.current;
        if (!section) return;

        const mm = gsap.matchMedia();

        mm.add(
            { motion: "(prefers-reduced-motion: no-preference)", phone: "(max-width: 767px)" },
            (ctx) => {
                const { motion, phone } = ctx.conditions as { motion: boolean; phone: boolean };
                if (!motion) return;

                section.dataset.motion = "on";
                const q = gsap.utils.selector(section);
                const one = <T extends Element>(sel: string) => q<T>(sel)[0];
                const audio = () => audioRef.current;

                const { partAt, extents } = rasterise();

                const svg = one<SVGSVGElement>("[data-svg]");
                const doneClip = one<SVGRectElement>("[data-done-clip]");
                const layerClip = one<SVGRectElement>("[data-layer-clip]");
                const bead = one<SVGRectElement>("[data-bead]");
                const head = one<SVGGElement>("[data-head]");
                const gantry = one<SVGGElement>("[data-gantry]");
                const tube = one<SVGLineElement>("[data-tube]"); // filament; rides inside the head group
                const car = one<SVGGElement>("[data-car]");
                const squat = one<SVGGElement>("[data-squat]");
                const drive = one<SVGGElement>("[data-drive]");
                const blur = one<SVGFEGaussianBlurElement>("[data-blur]");
                const pan = one<HTMLDivElement>("[data-pan]");
                const bed = one<HTMLDivElement>("[data-bed]");
                const smokeCanvas = one<HTMLCanvasElement>("[data-smoke]");
                const slots = q<HTMLElement>("[data-slot]");
                const rims = q<SVGGElement>("[data-rim]");
                const hud = {
                    lap: one<HTMLElement>("[data-hud=lap]"),
                    nozzle: one<HTMLElement>("[data-hud=nozzle]"),
                    nozzleBar: one<HTMLElement>("[data-bar=nozzle]"),
                    bed: one<HTMLElement>("[data-hud=bed]"),
                    bedBar: one<HTMLElement>("[data-bar=bed]"),
                    status: one<HTMLElement>("[data-hud=status]"),
                };

                const smoke = new Smoke(smokeCanvas);
                const resize = new ResizeObserver(() => smoke.resize());
                resize.observe(smokeCanvas);

                // One mutable job state; the scrubbed timeline tweens it, render() draws it.
                const job = { heat: 0, home: 0, p: 0, park: 0, lift: 0, finish: 0, launch: 0 };
                let active = false;
                let launched = false;
                let activePart = -1;
                let pitStopUntil = 0;
                let headX = PARK.x;
                let lastStatus = "";

                const setActivePart = (i: number, printing: boolean) => {
                    if (i === activePart) return;
                    activePart = i;
                    tube.style.stroke = PARTS[i].hi; // the base black would vanish on the plate
                    bead.style.fill = PARTS[i].hi;
                    slots.forEach((el, k) => el.toggleAttribute("data-active", k === i));
                    // Thin black parts (suspension, halo) swap filament several times a
                    // layer; one pit stop call-out and click at a time, not a burst.
                    if (printing && performance.now() >= pitStopUntil) {
                        pitStopUntil = performance.now() + 700;
                        audio()?.click();
                    }
                };

                const phaseNow = (): Phase =>
                    launched ? "launched"
                        : job.finish > 0.5 ? "finished"
                            : job.park > 0.5 ? "done"
                                : job.p > 0 ? "print" : "intro";

                /** Nozzle tip position for a print progress 0..1, following the toolpath. */
                const tipAt = (p: number) => {
                    const lf = p * LAYERS;
                    const l = Math.min(Math.floor(lf), LAYERS - 1);
                    const f = p >= 1 ? 1 : lf - l;
                    const [mn, mx] = extents[l];
                    const ltr = l % 2 === 0;
                    return { l, f, mn, mx, ltr, x: ltr ? mn + f * (mx - mn) : mx - f * (mx - mn), y: GROUND - (l + 1) * LAYER_H };
                };
                const START = tipAt(0);
                const END = tipAt(1);

                const render = () => {
                    const printing = job.p > 0 && job.p < 1;
                    const tip = tipAt(job.p);

                    // Material: completed layers, plus the current layer up to the nozzle.
                    if (job.p >= 1) {
                        doneClip.setAttribute("y", String(TOP - 10));
                        doneClip.setAttribute("height", String(GROUND - TOP + 30));
                        layerClip.setAttribute("width", "0");
                    } else {
                        const doneTop = GROUND - tip.l * LAYER_H;
                        doneClip.setAttribute("y", String(doneTop));
                        doneClip.setAttribute("height", String(GROUND - doneTop + 20));
                        const x0 = tip.ltr ? tip.mn - 1 : tip.x;
                        const x1 = tip.ltr ? tip.x : tip.mx + 1;
                        layerClip.setAttribute("x", String(x0));
                        layerClip.setAttribute("y", String(tip.y - 0.1));
                        layerClip.setAttribute("width", String(job.p > 0 ? Math.max(0, x1 - x0) : 0));
                        layerClip.setAttribute("height", String(LAYER_H + 0.2));
                    }
                    // Molten trail just behind the tip.
                    bead.setAttribute("x", String(tip.ltr ? tip.x - 46 : tip.x));
                    bead.setAttribute("y", String(tip.y - 0.1));
                    bead.style.opacity = printing ? "1" : "0";

                    // Hotend: park -> home -> toolpath -> park.
                    let hx: number;
                    let hy: number;
                    if (job.p <= 0) {
                        hx = PARK.x + (START.x - PARK.x) * job.home;
                        hy = PARK.y + (START.y - PARK.y) * job.home;
                    } else if (job.park > 0) {
                        hx = END.x + (PARK.x - END.x) * job.park;
                        hy = END.y + (PARK.y - END.y) * job.park;
                    } else {
                        hx = tip.x;
                        hy = tip.y;
                    }
                    headX = hx;
                    gsap.set(head, { x: hx, y: hy });
                    gsap.set(gantry, { y: hy });

                    if (printing) {
                        const i = partAt(tip.x, tip.y + LAYER_H / 2);
                        if (i >= 0) setActivePart(i, true);
                    }

                    // Phone: the camera follows the nozzle along the car until the reveal.
                    if (phone && job.park === 0) {
                        const overflow = pan.offsetWidth - bed.clientWidth;
                        const centred = (hx / VB_W) * pan.offsetWidth - bed.clientWidth / 2;
                        gsap.set(pan, { x: -Math.min(overflow, Math.max(0, centred)) });
                    }

                    // Broadcast graphics.
                    const nozzleF = job.heat * (1 - 0.35 * job.park);
                    hud.lap.textContent = String(tip.l + (job.p >= 1 ? 1 : job.p > 0 ? 1 : 0)).padStart(3, "0");
                    hud.nozzle.textContent = `${Math.round(ROOM_C + (NOZZLE_C - ROOM_C) * nozzleF)}°`;
                    hud.bed.textContent = `${Math.round(ROOM_C + (BED_C - ROOM_C) * job.heat)}°`;
                    gsap.set(hud.nozzleBar, { scaleX: nozzleF, backgroundColor: heatColour(nozzleF) });
                    gsap.set(hud.bedBar, { scaleX: job.heat, backgroundColor: heatColour(job.heat) });

                    const status = performance.now() < pitStopUntil && printing
                        ? `Pit stop · ${PARTS[activePart].name.toLowerCase()}`
                        : raceControl(phaseNow(), tip.l, job.home >= 1);
                    if (status !== lastStatus) {
                        lastStatus = status;
                        hud.status.textContent = status;
                        gsap.fromTo(hud.status, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.25, ease: "power2.out" });
                    }

                    gsap.set(car, { y: -10 * job.lift });
                    audio()?.setFan(active && job.heat > 0 && job.park < 1 ? job.heat : 0);

                    // Crossing the launch point fires the getaway; scrolling back brings the car home.
                    if (job.launch >= 1 && !launched) {
                        launched = true;
                        getaway.timeScale(1).play(0);
                        audio()?.launch(BURNOUT, EXIT);
                    } else if (job.launch < 1 && launched) {
                        launched = false;
                        getaway.timeScale(3).reverse();
                    }
                };

                // --- The getaway: burnout, then constant acceleration off the bed.
                const g = { spin: 0, x: 0, squat: 0 };
                let lastGX = 0;
                let lastGT = 0;
                const svgToCanvas = (x: number, y: number) => {
                    const m = svg.getScreenCTM();
                    const c = smokeCanvas.getBoundingClientRect();
                    if (!m) return null;
                    const pt = new DOMPoint(x, y).matrixTransform(m);
                    return { x: pt.x - c.left, y: pt.y - c.top, scale: m.a / 1.2 };
                };
                const applyGetaway = () => {
                    gsap.set(drive, { x: g.x });
                    gsap.set(squat, { y: 3 * g.squat });
                    rims.forEach((rim, i) => {
                        const w = WHEELS[i];
                        // Rolling without slip, plus wheelspin during the burnout.
                        const angle = g.spin + (g.x / (2 * Math.PI * w.r)) * 360;
                        gsap.set(rim, { rotation: angle, svgOrigin: `${w.cx} ${w.cy}` });
                    });

                    const t = getaway.time();
                    const now = performance.now() / 1000;
                    const dt = Math.max(1 / 240, now - lastGT);
                    const v = Math.abs(g.x - lastGX) / dt; // units per second
                    lastGX = g.x;
                    lastGT = now;
                    blur.setAttribute("stdDeviation", `${Math.min(26, v / 70).toFixed(2)} 0`);

                    if (getaway.reversed() || t >= EXIT) return;
                    const rear = svgToCanvas(WHEELS[0].cx + g.x, GROUND - 2);
                    if (!rear) return;
                    if (t < BURNOUT) {
                        // Spinning rear tyre throws smoke backwards and up into a wide cloud.
                        smoke.emit(rear.x - 30 * rear.scale, rear.y, 3, { vx: -260, vy: -60, spread: 90, scale: rear.scale, alpha: 0.45 });
                    } else {
                        // Trail thins out as the tyres find grip.
                        const k = 1 - (t - BURNOUT) / (EXIT - BURNOUT);
                        smoke.emit(rear.x, rear.y, Math.round(1 + 3 * k), { vx: -120, spread: 60, scale: rear.scale, alpha: 0.35 * k + 0.1 });
                    }
                };

                const getaway = gsap.timeline({ paused: true, defaults: { ease: "none" }, onUpdate: applyGetaway })
                    .call(() => drive.setAttribute("filter", "url(#job-blur)"), [], 0)
                    .to(g, { spin: 1440, duration: BURNOUT, ease: "power2.in" }, 0)
                    .to(g, { squat: 1, duration: 0.12, ease: "power2.out" }, 0)
                    .to(g, { squat: 0, duration: 0.25, ease: "power2.out" }, BURNOUT)
                    .to(g, { x: 1800, duration: EXIT - BURNOUT, ease: "power1.in" }, BURNOUT) // t² = constant acceleration
                    .to(q("[data-rain-light]"), { opacity: 1, duration: 0.07, repeat: 9, yoyo: true }, 0)
                    .to(q("[data-skid]"), { opacity: 0.6, duration: 0.3 }, 0.1)
                    .fromTo(q("[data-speedline]"), { scaleX: 0, opacity: 0.8 }, { scaleX: 1, opacity: 0, duration: 0.9, stagger: 0.04, ease: "power2.out", transformOrigin: "100% 50%" }, BURNOUT + 0.25)
                    .fromTo(bed, { x: -2 }, { x: 2, duration: 0.035, repeat: 9, yoyo: true, clearProps: "x" }, 0);

                // Real-time loop: stepper sound from head speed, and the smoke.
                let lastHeadX = headX;
                const frame = (_time: number, deltaMs: number) => {
                    const dt = deltaMs / 1000;
                    if (active && dt > 0) {
                        const speed = Math.abs(headX - lastHeadX) / dt / 3000;
                        audio()?.setStepper(job.p > 0 && job.p < 1 ? speed : 0);
                    }
                    lastHeadX = headX;
                    if (smoke.alive) smoke.tick(Math.min(dt, 1 / 20));
                };
                gsap.ticker.add(frame);

                // Starting state: cold printer parked, nothing printed, raw part not finished.
                gsap.set(q("[data-preview]"), { opacity: 0 });
                gsap.set(q("[data-layered]"), { opacity: 1 });
                gsap.set(q("[data-finished]"), { opacity: 0 });
                gsap.set(q("[data-cta]"), { autoAlpha: 0, y: 30 });
                gsap.set(q("[data-shadow], [data-skid], [data-rain-light]"), { opacity: 0 });
                setActivePart(CARBON, false); // the tyres print first

                const tl = gsap.timeline({
                    defaults: { ease: "none" },
                    onUpdate: render,
                    scrollTrigger: {
                        trigger: section,
                        start: "top top",
                        end: phone ? "+=460%" : "+=420%",
                        pin: true,
                        scrub: phone ? 0.4 : 0.7,
                        anticipatePin: 1,
                        onToggle: (self) => {
                            active = self.isActive;
                            if (!active) {
                                audio()?.setStepper(0);
                                audio()?.setFan(0);
                            }
                        },
                    },
                });

                tl.to(job, { heat: 1, duration: T_HEAT, ease: "power1.out" }, 0)
                    .to(q("[data-preview]"), { opacity: 1, duration: 0.6 }, 0.2)
                    .to(job, { home: 1, duration: T_HOME, ease: "power2.inOut" }, T_HEAT)
                    .to(job, { p: 1, duration: T_PRINT_LEN }, T_PRINT)
                    .to(q("[data-preview]"), { opacity: 0, duration: 1 }, T_PRINT + T_PRINT_LEN - 0.8)
                    .to(job, { park: 1, duration: 0.8, ease: "power2.inOut" }, T_PARK)
                    .to(job, { lift: 1, duration: 0.6, ease: "back.out(2)" }, T_PARK + 0.4)
                    .to(q("[data-shadow]"), { opacity: 1, duration: 0.6 }, T_PARK + 0.4);

                if (phone) {
                    // Pull back from the tracking shot to reveal the whole car.
                    tl.fromTo(
                        pan,
                        { scale: 1 },
                        { scale: () => bed.clientWidth / pan.offsetWidth, x: 0, transformOrigin: "0% 50%", duration: 0.9, ease: "power2.inOut", immediateRender: false },
                        T_PARK,
                    );
                }

                // Finishing: a polish pass sweeps across and the raw print becomes the car.
                tl.to(q("[data-sheen]"), { x: 2200, duration: 1, ease: "power1.inOut" }, T_FINISH)
                    .to(q("[data-finished]"), { opacity: 1, duration: 0.5 }, T_FINISH + 0.3)
                    .to(q("[data-layered]"), { opacity: 0, duration: 0.5 }, T_FINISH + 0.45)
                    .to(job, { finish: 1, duration: 0.01 }, T_FINISH + 0.5)
                    .to(job, { launch: 1, duration: 0.01 }, T_LAUNCH)
                    .to(q("[data-cta]"), { autoAlpha: 1, y: 0, duration: 0.5, ease: "power3.out" }, T_LAUNCH + 0.3)
                    .to({}, { duration: 0.9 }); // hold before the pin releases

                render();

                return () => {
                    gsap.ticker.remove(frame);
                    resize.disconnect();
                    getaway.kill();
                    smoke.clear();
                    drive.removeAttribute("filter");
                    audio()?.setStepper(0);
                    audio()?.setFan(0);
                    delete section.dataset.motion;
                    slots.forEach((el) => el.removeAttribute("data-active"));
                };
            },
        );

        refreshInPageOrder();
        return () => mm.revert();
    }, []);

    return (
        <section
            ref={sectionRef}
            aria-labelledby="job-heading"
            className="group relative overflow-hidden text-[hsl(40_20%_92%)]"
            style={{
                backgroundColor: "hsl(28 12% 11%)",
                backgroundImage: `radial-gradient(ellipse 70% 45% at 50% 52%, hsl(34 48% 58% / 0.30), transparent 72%), ${PLATE_NOISE}`,
            }}
        >
            {/* Exactly one screen tall: a pinned section taller than the viewport hides its own ending */}
            <div className="relative flex h-[100svh] flex-col px-4 pb-6 pt-24 md:px-10 md:pt-28">
                <h2 id="job-heading" className="sr-only">An F1 car, 3D printed layer by layer</h2>

                {/* Broadcast graphics: the print job as a race */}
                <header className="relative z-10 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 md:flex md:items-center md:justify-between">
                    {/* Timing tower: one layer is one lap */}
                    <div className="flex items-center gap-3">
                        <img src={logoMark} alt="ProtoDesign" width={247} height={256} loading="lazy" className="h-9 w-auto" />
                        <div className="leading-none">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Lap</p>
                            <p className="text-3xl font-bold italic tabular-nums tracking-tight">
                                <span data-hud="lap">{LAYERS}</span>
                                <span className="text-base text-white/40">/{LAYERS}</span>
                            </p>
                        </div>
                    </div>

                    {/* Race control: the only narrator */}
                    <div className="justify-self-end border-l-[3px] border-[hsl(48_100%_55%)] bg-black/35 px-3 py-1.5 backdrop-blur-sm md:order-last md:min-w-[15rem]">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[hsl(48_100%_60%)]">Race control</p>
                        <p data-hud="status" className="text-sm font-bold uppercase italic tracking-wide text-white">Parc fermé</p>
                    </div>

                    {/* Temperatures read like tyre temps; filaments are the compounds */}
                    <div className="col-span-2 flex items-end gap-4 md:col-span-1 md:gap-5">
                        <Temp label="Nozzle" hud="nozzle" value={NOZZLE_C} />
                        <Temp label="Bed" hud="bed" value={BED_C} />
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Compound</p>
                            <div className="mt-1 flex gap-1.5">
                                {PARTS.map((p) => (
                                    <span
                                        key={p.id}
                                        data-slot
                                        title={p.name}
                                        className="flex h-7 w-7 items-center justify-center rounded-full border-[3px] bg-black/60 text-[11px] font-bold italic opacity-40 transition-all duration-200 data-[active]:scale-110 data-[active]:opacity-100"
                                        style={{ borderColor: p.ring }}
                                    >
                                        {p.letter}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={toggleSound}
                            aria-pressed={soundOn}
                            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/15 px-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/70 transition-colors hover:text-white md:ml-2"
                        >
                            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                            <span className="sr-only sm:not-sr-only">Sound</span>
                        </button>
                    </div>
                </header>


                {/* The bed. Phones clip here for the tracking shot; wider screens clip only
                    vertically, so the car can run to the viewport edge. */}
                <div data-bed className="relative flex min-h-0 flex-1 items-center overflow-hidden md:justify-center md:overflow-x-visible md:overflow-y-clip">
                    <div data-pan className="w-[190vw] shrink-0 will-change-transform md:flex md:h-full md:w-full md:max-w-[1200px] md:items-center md:justify-center">
                        <svg data-svg viewBox={`0 ${VB_Y} ${VB_W} ${VB_H}`} className="block h-auto w-full overflow-visible md:max-h-full" role="img" aria-label="A matte red and black F1 car being 3D printed layer by layer, then driving away">
                            <defs>
                                <clipPath id="job-car">{PARTS.map((p) => <Shapes key={p.id} part={p} />)}</clipPath>
                                {PARTS.map((p) => (
                                    <clipPath key={p.id} id={`job-part-${p.id}`}><Shapes part={p} /></clipPath>
                                ))}
                                <clipPath id="job-printed">
                                    <rect data-done-clip x="-50" y={TOP - 10} width={VB_W + 100} height={GROUND - TOP + 30} />
                                    <rect data-layer-clip x="0" y="0" width="0" height="0" />
                                </clipPath>
                                {PARTS.map((p) => (
                                    <linearGradient key={p.id} id={`job-grad-${p.id}`} x1="0" x2="0" y1="0" y2="1">
                                        <stop offset="0" stopColor={p.hi} />
                                        <stop offset="0.45" stopColor={p.base} />
                                        <stop offset="1" stopColor={p.lo} />
                                    </linearGradient>
                                ))}
                                {/* Raw print: one extruded bead per layer, lit on top */}
                                {PARTS.map((p) => (
                                    <pattern key={p.id} id={`job-bead-${p.id}`} width="8" height={LAYER_H} patternUnits="userSpaceOnUse">
                                        <rect width="8" height={LAYER_H} fill={`url(#job-grad-${p.id})`} />
                                    </pattern>
                                ))}
                                {/* Finished car: smooth matte shading across the whole body height */}
                                {PARTS.map((p) => (
                                    <linearGradient key={p.id} id={`job-gloss-${p.id}`} x1="0" x2="0" y1={TOP} y2={GROUND} gradientUnits="userSpaceOnUse">
                                        <stop offset="0" stopColor={p.hi} />
                                        <stop offset="0.5" stopColor={p.base} />
                                        <stop offset="1" stopColor={p.lo} />
                                    </linearGradient>
                                ))}
                                <linearGradient id="job-sheen" x1="0" x2="1" y1="0" y2="0.3">
                                    <stop offset="0.35" stopColor="white" stopOpacity="0" />
                                    <stop offset="0.5" stopColor="white" stopOpacity="0.55" />
                                    <stop offset="0.65" stopColor="white" stopOpacity="0" />
                                </linearGradient>
                                <linearGradient id="job-reflect" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0" stopColor="white" stopOpacity="0.09" />
                                    <stop offset="0.35" stopColor="white" stopOpacity="0" />
                                </linearGradient>
                                <radialGradient id="job-rim">
                                    <stop offset="0" stopColor="hsl(220 6% 24%)" />
                                    <stop offset="0.8" stopColor="hsl(220 8% 12%)" />
                                    <stop offset="1" stopColor="hsl(220 10% 6%)" />
                                </radialGradient>
                                {/* Rim light on the silhouette only: erode the shape and keep the ring,
                                    so overlapping parts never draw internal outlines. */}
                                <filter id="job-rim-light" x="-2%" y="-5%" width="104%" height="110%">
                                    <feMorphology in="SourceAlpha" operator="erode" radius="1.1" result="inner" />
                                    <feComposite in="SourceAlpha" in2="inner" operator="out" result="edge" />
                                    <feFlood floodColor="hsl(40 30% 90%)" floodOpacity="0.3" />
                                    <feComposite in2="edge" operator="in" />
                                </filter>
                                {/* Toolhead materials, lit from the upper left like the car */}
                                <linearGradient id="job-hd-alu" x1="0" x2="1" y1="0" y2="0">
                                    <stop offset="0" stopColor="hsl(210 6% 30%)" />
                                    <stop offset="0.28" stopColor="hsl(210 10% 86%)" />
                                    <stop offset="0.55" stopColor="hsl(210 6% 60%)" />
                                    <stop offset="1" stopColor="hsl(210 8% 24%)" />
                                </linearGradient>
                                <linearGradient id="job-hd-block" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0" stopColor="hsl(210 8% 80%)" />
                                    <stop offset="0.5" stopColor="hsl(210 6% 60%)" />
                                    <stop offset="1" stopColor="hsl(210 8% 40%)" />
                                </linearGradient>
                                <linearGradient id="job-hd-brass" x1="0" x2="1" y1="0" y2="0">
                                    <stop offset="0" stopColor="hsl(38 55% 28%)" />
                                    <stop offset="0.3" stopColor="hsl(44 75% 66%)" />
                                    <stop offset="0.6" stopColor="hsl(40 60% 45%)" />
                                    <stop offset="1" stopColor="hsl(36 55% 22%)" />
                                </linearGradient>
                                <linearGradient id="job-hd-steel" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0" stopColor="hsl(220 6% 82%)" />
                                    <stop offset="0.45" stopColor="hsl(220 5% 58%)" />
                                    <stop offset="1" stopColor="hsl(220 6% 34%)" />
                                </linearGradient>
                                <linearGradient id="job-hd-anod" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0" stopColor="hsl(220 6% 22%)" />
                                    <stop offset="1" stopColor="hsl(220 8% 9%)" />
                                </linearGradient>
                                <radialGradient id="job-hd-screw" cx="0.38" cy="0.35" r="0.7">
                                    <stop offset="0" stopColor="hsl(220 5% 46%)" />
                                    <stop offset="1" stopColor="hsl(220 8% 12%)" />
                                </radialGradient>
                                {/* Printed parts show their own layer lines */}
                                <pattern id="job-hd-printed" width="10" height="0.6" patternUnits="userSpaceOnUse">
                                    <rect width="10" height="0.6" fill="hsl(220 5% 13%)" />
                                    <rect y="0.5" width="10" height="0.1" fill="white" fillOpacity="0.07" />
                                </pattern>
                                <filter id="job-blur" x="-40%" y="-10%" width="180%" height="120%">
                                    <feGaussianBlur data-blur stdDeviation="0 0" />
                                </filter>
                            </defs>

                            {/* Bed edge; skid marks stay behind after the launch */}
                            <rect x="-40" y={GROUND} width={VB_W + 80} height="3" fill="white" fillOpacity="0.08" />
                            <g data-skid opacity="0">
                                {WHEELS.map((w) => (
                                    <rect key={w.cx} x={w.cx - 20} y={GROUND - 3} width="260" height="5" rx="2.5" fill="black" fillOpacity="0.7" />
                                ))}
                            </g>

                            {/* Slicer preview: a ghost of the part before it exists */}
                            <g data-preview clipPath="url(#job-car)" opacity="0">
                                <rect x="0" y={TOP - 10} width={VB_W} height={GROUND - TOP + 30} fill="white" fillOpacity="0.07" />
                            </g>

                            {/* Speed lines the car leaves behind */}
                            <g aria-hidden>
                                {[150, 178, 206, 232, 258, 284].map((y, i) => (
                                    <rect key={y} data-speedline x={-200 + i * 40} y={y} width={1000 - i * 60} height="3" rx="1.5" fill="hsl(40 40% 96%)" opacity="0" />
                                ))}
                            </g>

                            <g data-drive>
                                <ellipse data-shadow cx="500" cy={GROUND + 14} rx="470" ry="9" fill="black" fillOpacity="0.55" />
                                <g data-car>
                                    <g data-squat>
                                        {/* Raw print */}
                                        <g data-layered opacity="0">
                                            <g clipPath="url(#job-printed)">
                                                {PARTS.map((p) => (
                                                    <g key={p.id} clipPath={`url(#job-part-${p.id})`}>
                                                        <rect x="0" y={TOP - 10} width={VB_W} height={GROUND - TOP + 20} fill={`url(#job-bead-${p.id})`} />
                                                    </g>
                                                ))}
                                            </g>
                                            {/* Molten trail behind the nozzle, only on material just laid */}
                                            <g clipPath="url(#job-car)">
                                                <g clipPath="url(#job-printed)">
                                                    <rect data-bead x="0" y="0" width="46" height={LAYER_H + 0.2} opacity="0" />
                                                </g>
                                            </g>
                                        </g>

                                        {/* The finished car (visible by default for the static render) */}
                                        <g data-finished>
                                            {/* Per part: matte shading and the faint layer lines a real print keeps,
                                                then the part's surface detail, so later parts cover both completely */}
                                            {PARTS.map((p) => (
                                                <g key={p.id} clipPath={`url(#job-part-${p.id})`}>
                                                    <rect x="0" y={TOP - 10} width={VB_W} height={GROUND - TOP + 20} fill={`url(#job-gloss-${p.id})`} />
                                                    <rect x="0" y={TOP - 10} width={VB_W} height={GROUND - TOP + 20} fill={`url(#job-bead-${p.id})`} opacity="0.16" />
                                                    {p.id === "body" && <BodyDetail />}
                                                </g>
                                            ))}
                                            <g clipPath="url(#job-car)">
                                                <rect x="0" y={TOP - 10} width={VB_W} height={GROUND - TOP + 20} fill="url(#job-reflect)" />
                                            </g>
                                            <g filter="url(#job-rim-light)" fill="black">{PARTS.map((p) => <Shapes key={p.id} part={p} />)}</g>
                                            {/* Carbon detail: halo edge, visor reflection, floor edge, rain light */}
                                            <g fill="none" strokeLinecap="round">
                                                <path d="M 512 180 C 514 168 520 160 530 159 L 600 158 C 614 158 628 167 644 183" stroke="white" strokeOpacity="0.2" strokeWidth="0.8" />
                                                <path d="M 547 168 C 551 168 554 171 555 175" stroke="white" strokeOpacity="0.3" strokeWidth="0.9" />
                                                <path d="M 270 285 L 668 285" stroke="white" strokeOpacity="0.08" strokeWidth="0.8" />
                                            </g>
                                            <rect data-rain-light x="62.5" y="235" width="4" height="7" rx="1" fill="hsl(0 90% 55%)" opacity="0" />
                                            {/* Wheels: 720 mm slick on an 18" rim under an aero cover. The cover's
                                                five vents roll with the car; the light on it stays put. */}
                                            {WHEELS.map((w) => (
                                                <g key={w.cx}>
                                                    <circle cx={w.cx} cy={w.cy} r={w.r - 3} fill="none" stroke="white" strokeOpacity="0.05" strokeWidth="2" />
                                                    <circle cx={w.cx} cy={w.cy} r={w.r - 12} fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1.2" />
                                                    <g data-rim>
                                                        <circle cx={w.cx} cy={w.cy} r="38" fill="hsl(220 6% 22%)" />
                                                        <circle cx={w.cx} cy={w.cy} r="36" fill="url(#job-rim)" />
                                                        {[0, 72, 144, 216, 288].map((a) => (
                                                            <rect key={a} x={w.cx - 1.5} y={w.cy - 33} width="3" height="19" rx="1.5" fill="black" fillOpacity="0.4" transform={`rotate(${a} ${w.cx} ${w.cy})`} />
                                                        ))}
                                                        <circle cx={w.cx} cy={w.cy} r="8" fill="hsl(220 6% 30%)" />
                                                        <circle cx={w.cx} cy={w.cy} r="3.5" fill="hsl(220 8% 14%)" />
                                                    </g>
                                                    <path d={`M ${w.cx - 33.8} ${w.cy - 12.3} A 36 36 0 0 1 ${w.cx - 12.3} ${w.cy - 33.8}`} fill="none" stroke="white" strokeOpacity="0.14" strokeWidth="1.2" strokeLinecap="round" />
                                                </g>
                                            ))}
                                        </g>

                                        {/* Polish pass. Parked off to the left (bright band at x -1100) so the
                                            static render never shows it. */}
                                        <g clipPath="url(#job-car)">
                                            <rect data-sheen x="-2100" y={TOP - 10} width="2000" height={GROUND - TOP + 20} fill="url(#job-sheen)" />
                                        </g>
                                    </g>
                                </g>
                            </g>

                            {/* Filament, gantry and hotend: only when the job is animated */}
                            <g className="hidden group-data-[motion=on]:inline">
                                {/* X axis: black 2020 extrusion with an MGN9 rail bolted to its face.
                                    It rides up with the head (Z) but never moves sideways. */}
                                <g data-gantry>
                                    <rect x="-60" y={-80 * HEAD_MM} width={VB_W + 120} height={20 * HEAD_MM} fill="url(#job-hd-anod)" />
                                    <rect x="-60" y={-80 * HEAD_MM} width={VB_W + 120} height="0.7" fill="white" fillOpacity="0.14" />
                                    <rect x="-60" y={-74.5 * HEAD_MM} width={VB_W + 120} height={9 * HEAD_MM} fill="url(#job-hd-steel)" />
                                    <rect x="-60" y={-73 * HEAD_MM} width={VB_W + 120} height="0.5" fill="black" fillOpacity="0.3" />
                                    <rect x="-60" y={-67 * HEAD_MM} width={VB_W + 120} height="0.5" fill="black" fillOpacity="0.3" />
                                    {RAIL_HOLES.map((x) => (
                                        <circle key={x} cx={x} cy={-70 * HEAD_MM} r={1.6 * HEAD_MM} fill="hsl(220 10% 7%)" />
                                    ))}
                                </g>
                                {/* Toolhead, origin at the nozzle tip, in mm. Back to front: rail block,
                                    carriage plate, hotend, fans and the printed part-cooling duct. */}
                                <g data-head>
                                    <g transform={`scale(${HEAD_MM})`}>
                                        {/* Bowden: PTFE tube with the active filament inside */}
                                        <line data-tube x1="0" x2="0" y1="-800" y2="-90.5" strokeWidth="1.75" style={{ stroke: PARTS[CARBON].hi }} />
                                        <line x1="0" x2="0" y1="-800" y2="-90.5" stroke="white" strokeOpacity="0.2" strokeWidth="4" />
                                        <line x1="-1.3" x2="-1.3" y1="-800" y2="-90.5" stroke="white" strokeOpacity="0.22" strokeWidth="0.4" />

                                        {/* MGN9H block ends and seals either side of the plate */}
                                        <rect x="-20.5" y="-79" width="41" height="18" rx="0.6" fill="url(#job-hd-steel)" />
                                        <rect x="-20.5" y="-79" width="1.2" height="18" fill="hsl(220 8% 10%)" />
                                        <rect x="19.3" y="-79" width="1.2" height="18" fill="hsl(220 8% 10%)" />

                                        {/* Carriage plate */}
                                        <rect x="-18" y="-84" width="36" height="36" rx="2" fill="url(#job-hd-anod)" />
                                        <rect x="-16.5" y="-84" width="33" height="0.5" fill="white" fillOpacity="0.16" />
                                        <CapScrew x={-10} y={-79} />
                                        <CapScrew x={10} y={-79} />
                                        <CapScrew x={-10} y={-64.5} />
                                        <CapScrew x={10} y={-64.5} />
                                        <CapScrew x={-9.5} y={-52.5} />
                                        <CapScrew x={9.5} y={-52.5} />

                                        {/* Push-fit coupling: hex body, black collet */}
                                        <path d="M -4 -88.5 H -2 V -84 H -4 Z" fill="hsl(220 5% 74%)" />
                                        <path d="M -2 -88.5 H 2 V -84 H -2 Z" fill="hsl(220 5% 56%)" />
                                        <path d="M 2 -88.5 H 4 V -84 H 2 Z" fill="hsl(220 6% 36%)" />
                                        <rect x="-2.8" y="-90.5" width="5.6" height="2" rx="0.4" fill="hsl(220 6% 13%)" />

                                        {/* Heatsink: groove-mount collar, then eleven 22 mm fins on a 9 mm core */}
                                        <rect x="-8" y="-49" width="16" height="3" fill="url(#job-hd-alu)" />
                                        <rect x="-4.5" y="-46" width="9" height="26" fill="url(#job-hd-alu)" />
                                        <rect x="-4.5" y="-46" width="9" height="26" fill="black" fillOpacity="0.45" />
                                        {Array.from({ length: 11 }, (_, i) => -22 - i * 2.4).map((fy) => (
                                            <g key={fy}>
                                                <rect x="-11" y={fy} width="22" height="1" rx="0.3" fill="url(#job-hd-alu)" />
                                                <rect x="-10.5" y={fy} width="21" height="0.25" fill="white" fillOpacity="0.3" />
                                            </g>
                                        ))}
                                        <rect x="-3" y="-21" width="6" height="1" fill="url(#job-hd-alu)" />

                                        {/* Heat break throat */}
                                        <rect x="-1.4" y="-20" width="2.8" height="2.5" fill="url(#job-hd-alu)" />
                                        <rect x="-1.4" y="-19.1" width="2.8" height="0.25" fill="black" fillOpacity="0.35" />
                                        <rect x="-1.4" y="-18.3" width="2.8" height="0.25" fill="black" fillOpacity="0.35" />

                                        {/* Heater cartridge leads, routed up behind the fan */}
                                        <path d="M -8.5 -13.2 C -12 -13.2 -13.5 -15 -14.5 -19" fill="none" stroke="hsl(356 68% 40%)" strokeWidth="1.1" strokeLinecap="round" />
                                        <path d="M -8.5 -10.8 C -13 -10.8 -15.5 -13.5 -16.5 -19" fill="none" stroke="hsl(356 68% 34%)" strokeWidth="1.1" strokeLinecap="round" />
                                        <rect x="-8.6" y="-14.75" width="2.8" height="6" rx="0.5" fill="url(#job-hd-steel)" />

                                        {/* Heater block: 16 x 11.5, clamp screw on the face */}
                                        <rect x="-6" y="-17.5" width="16" height="11.5" rx="0.5" fill="url(#job-hd-block)" />
                                        <rect x="-5.5" y="-17.5" width="15" height="0.3" fill="white" fillOpacity="0.4" />
                                        <rect x="-6" y="-6.4" width="16" height="0.4" fill="black" fillOpacity="0.3" />
                                        <rect x="3.2" y="-12" width="6.8" height="0.35" fill="black" fillOpacity="0.55" />
                                        <g transform="translate(6.3 -14.6) scale(0.62)"><CapScrew x={0} y={0} /></g>

                                        {/* Nozzle: thread stub, 7 mm hex (three faces), cone to a 1.2 mm flat */}
                                        <rect x="-3" y="-6" width="6" height="0.7" fill="hsl(38 50% 30%)" />
                                        <path d="M -4 -5.3 H -2 V -2.3 H -3.4 L -4 -2.9 Z" fill="hsl(44 70% 60%)" />
                                        <path d="M -2 -5.3 H 2 V -2.3 H -2 Z" fill="hsl(41 62% 47%)" />
                                        <path d="M 2 -5.3 H 4 V -2.9 L 3.4 -2.3 H 2 Z" fill="hsl(37 58% 30%)" />
                                        <path d="M -3.1 -2.3 H 3.1 L 0.6 0 H -0.6 Z" fill="url(#job-hd-brass)" />

                                        {/* 3010 heatsink fan, edge-on: two frame flanges, open waist */}
                                        <path d="M -20.5 -47 C -23.5 -40 -23.5 -26 -20.5 -19" fill="none" stroke="hsl(356 68% 38%)" strokeWidth="0.8" />
                                        <path d="M -20 -47 C -23 -40 -23 -26 -20 -19" fill="none" stroke="hsl(220 6% 8%)" strokeWidth="0.8" />
                                        <rect x="-21.5" y="-48" width="10" height="30" rx="1" fill="hsl(220 6% 6%)" />
                                        <rect x="-21.5" y="-48" width="2.2" height="30" rx="0.8" fill="hsl(220 5% 16%)" />
                                        <rect x="-13.7" y="-48" width="2.2" height="30" rx="0.8" fill="hsl(220 5% 16%)" />
                                        <rect x="-19.3" y="-48" width="5.6" height="3" fill="hsl(220 5% 12%)" />
                                        <rect x="-19.3" y="-21" width="5.6" height="3" fill="hsl(220 5% 12%)" />

                                        {/* 4010 blower, edge-on, feeding the part-cooling duct */}
                                        <path d="M 21 -58 C 21 -64 23 -68 22.5 -74" fill="none" stroke="hsl(356 68% 38%)" strokeWidth="0.8" />
                                        <path d="M 21.8 -58 C 21.8 -64 23.8 -68 23.3 -74" fill="none" stroke="hsl(220 6% 8%)" strokeWidth="0.8" />
                                        <rect x="13" y="-58" width="10" height="40" rx="1.2" fill="hsl(220 5% 11%)" />
                                        <rect x="17.8" y="-58" width="0.4" height="40" fill="black" fillOpacity="0.6" />
                                        <rect x="13.4" y="-57.6" width="9.2" height="0.4" fill="white" fillOpacity="0.1" />

                                        {/* Printed duct: wraps under the block, mouth aimed at the tip */}
                                        <path d="M 13.5 -18.5 H 22.5 V -9 C 22.5 -4.5 20 -2.2 15.5 -1.4 L 9.2 -0.6 L 8.4 -4.4 L 13.5 -5.6 Z" fill="url(#job-hd-printed)" />
                                        <path d="M 8.4 -4.4 L 9.2 -0.6 L 10.3 -0.8 L 9.6 -4.6 Z" fill="hsl(220 10% 4%)" />
                                    </g>
                                </g>
                            </g>
                        </svg>
                    </div>
                </div>

                {/* Tyre smoke, over the bed, under the copy */}
                <canvas data-smoke aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />

                {/* Payoff. Static (no-JS, reduced motion): below the parked car. Animated:
                    the car has driven off, so it takes the car's place on the empty bed. On
                    phones the parked gantry crosses mid-screen, so it sits in the empty
                    lower half instead. The wrapper positions; GSAP owns the inner transform. */}
                <div className="pointer-events-none relative z-10 flex justify-center group-data-[motion=on]:absolute group-data-[motion=on]:inset-0 group-data-[motion=on]:items-end group-data-[motion=on]:px-4 group-data-[motion=on]:pb-12 md:group-data-[motion=on]:items-center md:group-data-[motion=on]:pb-0 md:group-data-[motion=on]:pt-16">
                    <div data-cta className="pointer-events-auto flex max-w-xl flex-col items-center text-center">
                        <p className="text-balance font-display text-4xl leading-[1.05] md:text-6xl">That car started as a&nbsp;file.</p>
                        <p className="mt-4 max-w-[26rem] text-pretty text-sm leading-relaxed text-white/65 md:text-base">
                            Send us yours: STL, OBJ, 3MF or STEP, up to 200&nbsp;MB. We quote, print and ship&nbsp;it.
                        </p>
                        <div className="mt-6 flex flex-wrap justify-center gap-3">
                            <Link to="/custom" className="group/cta inline-flex min-h-11 items-center gap-2 rounded-full bg-[hsl(352_68%_40%)] px-5 font-medium text-white transition-transform active:scale-95">
                                Upload your file <ArrowRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-1" />
                            </Link>
                            <Link to="/printers" className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-5 font-medium text-white/85 transition-colors hover:border-white/40">
                                Shop printers
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
