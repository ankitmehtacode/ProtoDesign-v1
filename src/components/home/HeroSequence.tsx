import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import climb from "@/assets/hero-climb/climb.json";
import { LADDER } from "./materials";
import { heat } from "./heat";

/*
 * The climb, PLA to PEEK, as a pre-rendered film scrubbed by the scroll.
 *
 * Every frame was rendered in Blender (~/Documents/protodesign-hero: animate.py for
 * the physics, camera.py for the shot), so the page gets the render's real volumetric
 * light, soft shadows and reflections at the cost of a few kilobytes a frame, with no
 * 3D engine and no GPU work beyond drawing one image.
 *
 * `progress.p` (0..1, eased by GSAP's scrub) picks the frame. Frames stream in
 * coarse-to-fine (every 64th, then every 32nd, ...), so the whole climb is scrubbable
 * within the first few requests and sharpens as the rest arrive; until a frame is in,
 * its nearest loaded neighbour stands in. Phones get their own portrait render, framed
 * for a tall screen, instead of a crop of the wide one.
 *
 * Frame 0 is also the poster MaterialsHero shows before this mounts, drawn with the
 * same cover fit, so the handover is invisible.
 */

type FrameSet = { urls: string[] };
const sorted = (glob: Record<string, string>) => Object.keys(glob).sort().map((k) => glob[k]);
const SETS: Record<"wide" | "wideSmall" | "tall", FrameSet> = {
    wide: { urls: sorted(import.meta.glob("@/assets/hero-climb/w1920/*.webp", { eager: true, query: "?url", import: "default" })) },
    wideSmall: { urls: sorted(import.meta.glob("@/assets/hero-climb/w960/*.webp", { eager: true, query: "?url", import: "default" })) },
    tall: { urls: sorted(import.meta.glob("@/assets/hero-climb/t900/*.webp", { eager: true, query: "?url", import: "default" })) },
};

/** Which render suits this screen. Save-Data and small screens take the light set. */
function pickSet(): FrameSet {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    // The portrait render is optional: until its frames are encoded, phones crop the light wide set.
    if (window.matchMedia("(orientation: portrait)").matches && SETS.tall.urls.length) return SETS.tall;
    const px = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
    return conn?.saveData || px <= 1280 ? SETS.wideSmall : SETS.wide;
}

/** Coarse-to-fine load order: 0, 64, 128, ..., then 32, 96, ..., down to every frame. */
function loadOrder(n: number) {
    const seen = new Set<number>();
    const order: number[] = [];
    for (let step = 64; step >= 1; step /= 2) {
        for (let i = 0; i < n; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
    }
    if (!seen.has(n - 1)) order.push(n - 1);
    return order;
}

/**
 * Draw like CSS object-fit: cover with object-position `fx` 50%. The wide render keeps
 * the hero at ~68% across, so a narrow crop of it centres there (matching the poster's
 * object-position); the portrait render is framed for its screen and crops centred.
 */
const WIDE_FOCUS = 0.68; // MaterialsHero's poster uses the same object-position
function cover(ctx: CanvasRenderingContext2D, img: ImageBitmap, w: number, h: number, fx: number) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (w - dw) * fx, (h - dh) / 2, dw, dh);
}

const PARALLEL = 6;

type Props = {
    progress: MutableRefObject<{ p: number }>;
    onSpool: (i: number) => void;
};

/**
 * The finale names the whole ladder: a label rides above every reel as the camera pulls
 * back. Positions come from the Blender cameras (climb.json `labels`: for each finale
 * frame, each reel's point in the frame, 0..1), mapped through the same cover crop as the
 * film, so they stay on their reels at any screen size.
 */
const LABELS = climb.labels;
const LABEL_IN = 16;   // finale frames before the first label fades in
const LABEL_FADE = 10; // frames each label takes to fade in
const LABEL_STAGGER = 1.5; // frames between labels, left to right
const LABEL_TOP = 150; // px: a label anchored higher (it hangs ~50 px above its anchor) would sit under the fixed site header

export default function HeroSequence({ progress, onSpool }: Props) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const labels = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const el = canvas.current;
        const ctx = el?.getContext("2d", { alpha: false });
        if (!el || !ctx) return;
        const set = pickSet();
        const { urls } = set;
        const fx = set === SETS.tall ? 0.5 : WIDE_FOCUS;
        const n = urls.length;
        let alive = true;
        let dirty = true;

        // 1. Download: every frame as a compressed blob (a few MB for the whole climb), coarse to fine.
        const blobs: (Blob | undefined)[] = new Array(n);
        const queue = loadOrder(n);
        let failures = 0;
        const fetchNext = async (): Promise<void> => {
            const i = queue.shift();
            if (i === undefined || !alive) return;
            try {
                const res = await fetch(urls[i]);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                blobs[i] = await res.blob();
            } catch (err) {
                // A missing frame is covered by its neighbour; say so once, don't stop.
                if (failures++ === 0) console.error("[HeroSequence] frame failed to load; showing its neighbour", urls[i], err);
            }
            return fetchNext();
        };
        for (let k = 0; k < PARALLEL; k++) void fetchNext();

        // 2. Decode: a window of frames around the playhead, biased the way the scroll is
        //    going, decoded off the main thread (createImageBitmap), so drawing is a plain GPU
        //    copy and scrolling never waits on a decode. Left to itself the browser drops
        //    decoded frames (~8 MB each at 1920) and re-decodes them mid-scroll: that was the
        //    stutter. Only the window stays decoded, within a fixed memory budget.
        const cache = new Map<number, ImageBitmap>();
        const pending = new Set<number>();
        let want = 0, dir = 1, decoding = 0;
        const frameBytes = () => {
            const any = cache.values().next().value as ImageBitmap | undefined;
            return any ? any.width * any.height * 4 : 1920 * 1080 * 4;
        };
        const capacity = () => Math.max(16, Math.floor(260e6 / frameBytes()));
        const AHEAD = 28, BEHIND = 10;
        const pickNext = () => {
            let best = -1, bestScore = Infinity;
            for (let d = -BEHIND; d <= AHEAD; d++) {
                const i = want + d * dir;
                if (i < 0 || i >= n || !blobs[i] || cache.has(i) || pending.has(i)) continue;
                const score = d < 0 ? -d * 3 : d; // behind the playhead matters less
                if (score < bestScore) { bestScore = score; best = i; }
            }
            return best;
        };
        const evict = () => {
            const cap = capacity();
            while (cache.size > cap) {
                let far = -1, farD = -1;
                for (const i of cache.keys()) { const d = Math.abs(i - want); if (d > farD) { farD = d; far = i; } }
                cache.get(far)!.close();
                cache.delete(far);
            }
        };
        const decodeMore = () => {
            while (alive && decoding < 2) {
                const i = pickNext();
                if (i < 0) return;
                pending.add(i); decoding++;
                createImageBitmap(blobs[i]!)
                    .then((bmp) => {
                        if (!alive) { bmp.close(); return; }
                        cache.set(i, bmp);
                        evict();
                    })
                    .catch((err) => { if (failures++ === 0) console.error("[HeroSequence] frame failed to decode", i, err); })
                    .finally(() => { pending.delete(i); decoding--; decodeMore(); });
            }
        };

        // Size the backing store to the element (capped at 2x) and redraw on resize.
        const fit = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            el.width = Math.round(el.clientWidth * dpr);
            el.height = Math.round(el.clientHeight * dpr);
            dirty = true;
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);

        /** The decoded frame closest to `want`, or -1 before any is ready. */
        const nearest = (at: number) => {
            for (let d = 0; d < n; d++) {
                if (cache.has(at - d)) return at - d;
                if (cache.has(at + d)) return at + d;
            }
            return -1;
        };

        /** Put each finale label over its reel for climb frame `fi`, or hide them before the finale. */
        const track = set === SETS.tall ? LABELS.tall : LABELS.wide;
        const placeLabels = (fi: number, img: ImageBitmap) => {
            const k = fi - LABELS.first;
            const pts = k >= 0 ? track[Math.min(k, track.length - 1)] : null;
            const cw = el.clientWidth, ch = el.clientHeight;
            const s = Math.max(cw / img.width, ch / img.height);
            const dw = img.width * s, dh = img.height * s;
            const ox = (cw - dw) * fx, oy = (ch - dh) / 2;
            // Metres to pixels, from the reels' spacing (6 m apart in the scene).
            const ppm = pts ? Math.abs(pts[1][0] - pts[0][0]) * dw / 6 : 0;
            labels.current.forEach((node, i) => {
                if (!node) return;
                const a = pts ? Math.min(1, Math.max(0, (k - LABEL_IN - i * LABEL_STAGGER) / LABEL_FADE)) : 0;
                const x = pts ? ox + pts[i][0] * dw : 0;
                const y = pts ? oy + pts[i][1] * dh : 0;
                const onScreen = x > 24 && x < cw - 24;
                node.style.opacity = String(onScreen ? a : 0);
                // Above the reel, unless that would tuck it under the site header: then beside it.
                const beside = y < LABEL_TOP;
                (node.querySelector("[data-tick]") as HTMLElement).style.display = beside ? "none" : "";
                node.style.alignItems = beside ? "flex-start" : "center";
                node.style.transform = beside
                    // The anchor is 1.55 m above the reel's centre; the flange is 1.3 m across the radius.
                    ? `translate3d(${x + 1.5 * ppm + 10}px, ${y + 1.55 * ppm + (1 - a) * 8}px, 0) translate(0, -50%)`
                    : `translate3d(${x}px, ${y + (1 - a) * 8}px, 0) translate(-50%, -100%)`;
            });
        };

        // 3. Draw: only when the frame to show or the canvas size changed.
        let drawn = -1, lastSpool = -1, raf = 0, visible = true;
        const tick = () => {
            raf = 0;
            if (!alive || !visible) return;
            const p = Math.min(1, Math.max(0, progress.current.p));
            const next = Math.round(p * (n - 1));
            if (next !== want) { dir = next > want ? 1 : -1; want = next; }
            decodeMore();
            // By progress, not frame index: a set may have been rendered at another frame count.
            const spool = climb.spool[Math.round(p * (climb.spool.length - 1))] ?? 0;
            if (spool !== lastSpool) { lastSpool = spool; onSpool(spool); }
            const show = nearest(want);
            if (show >= 0 && (show !== drawn || dirty)) {
                const bmp = cache.get(show)!;
                cover(ctx, bmp, el.width, el.height, fx);
                placeLabels(Math.round(p * (climb.frames - 1)), bmp);
                drawn = show;
                dirty = false;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        // Stop drawing while the hero is off screen.
        const io = new IntersectionObserver(([e]) => {
            visible = e.isIntersecting;
            if (visible && !raf) { dirty = true; raf = requestAnimationFrame(tick); }
        });
        io.observe(el);

        return () => {
            alive = false;
            cancelAnimationFrame(raf);
            for (const bmp of cache.values()) bmp.close();
            cache.clear();
            ro.disconnect();
            io.disconnect();
        };
    }, [progress, onSpool]);

    return (
        <>
            <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full" />
            {/* The ladder, named: shown only in the finale, positioned by the draw loop */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                {LADDER.map((r, i) => (
                    <div
                        key={r.key}
                        ref={(node) => { labels.current[i] = node; }}
                        className="absolute left-0 top-0 flex flex-col items-center whitespace-nowrap opacity-0 will-change-transform"
                    >
                        <span className="text-[13px] font-light tracking-[-0.01em] text-foreground md:text-sm">{r.name}</span>
                        <span className="mt-0.5 text-[10px] tabular-nums tracking-[0.12em]" style={{ color: heat(r.temp) }}>{r.tempFigure} °C</span>
                        <span data-tick className="mt-1.5 h-3 w-px bg-foreground/35" />
                    </div>
                ))}
            </div>
        </>
    );
}
