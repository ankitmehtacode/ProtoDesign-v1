/*
 * Tyre smoke as a canvas particle system. Rendered at device pixel ratio so it
 * stays crisp on high-density and 4K screens. Particles are pre-rendered puff
 * sprites drawn with per-particle alpha and scale, which keeps a few hundred of
 * them cheap enough to run at 60fps.
 */

type Particle = {
    x: number; y: number;
    vx: number; vy: number;
    size: number; grow: number;
    age: number; life: number;
    alpha: number; sprite: number; spin: number; angle: number;
};

const MAX_PARTICLES = 420;
const SPRITE_PX = 160;

/** A soft, lumpy puff: several offset radial blobs, so no two particles look identical. */
function makeSprite(seed: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE_PX;
    const g = c.getContext("2d")!;
    let s = seed;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 7; i++) {
        const r = SPRITE_PX * (0.18 + rand() * 0.22);
        const x = SPRITE_PX / 2 + (rand() - 0.5) * SPRITE_PX * 0.35;
        const y = SPRITE_PX / 2 + (rand() - 0.5) * SPRITE_PX * 0.35;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        // Warm-grey: the bed light tints the smoke slightly.
        grad.addColorStop(0, "rgba(232,228,220,0.32)");
        grad.addColorStop(0.55, "rgba(214,210,202,0.12)");
        grad.addColorStop(1, "rgba(200,196,188,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
    }
    return c;
}

export class Smoke {
    private ctx: CanvasRenderingContext2D;
    private particles: Particle[] = [];
    private sprites = [11, 29, 47, 83].map(makeSprite);
    private dpr = 1;
    private width = 0;
    private height = 0;

    constructor(private canvas: HTMLCanvasElement) {
        this.ctx = canvas.getContext("2d")!;
        this.resize();
    }

    resize() {
        this.dpr = Math.min(window.devicePixelRatio || 1, 3);
        const rect = this.canvas.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = Math.round(rect.width * this.dpr);
        this.canvas.height = Math.round(rect.height * this.dpr);
    }

    get alive() {
        return this.particles.length;
    }

    /**
     * Emit puffs at a point in canvas CSS pixels.
     * scale: the car's on-screen size relative to desktop, so smoke matches it on phones.
     */
    emit(x: number, y: number, count: number, opts: { vx: number; vy?: number; spread: number; scale: number; alpha?: number }) {
        for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
            const s = opts.scale;
            this.particles.push({
                x: x + (Math.random() - 0.5) * opts.spread * s,
                y: y - Math.random() * 6 * s,
                vx: (opts.vx + (Math.random() - 0.5) * 160) * s,
                vy: ((opts.vy ?? -30) - Math.random() * 70) * s,
                size: (18 + Math.random() * 26) * s,
                grow: (110 + Math.random() * 140) * s,
                age: 0,
                life: 1.4 + Math.random() * 1.6,
                alpha: (opts.alpha ?? 0.5) * (0.6 + Math.random() * 0.4),
                sprite: (Math.random() * this.sprites.length) | 0,
                spin: (Math.random() - 0.5) * 0.8,
                angle: Math.random() * Math.PI * 2,
            });
        }
    }

    clear() {
        this.particles.length = 0;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /** Advance and draw. dt in seconds. */
    tick(dt: number) {
        const { ctx } = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        const drag = Math.pow(0.12, dt); // velocity retained per second
        let w = 0;
        for (const p of this.particles) {
            p.age += dt;
            if (p.age >= p.life) continue;
            p.vx *= drag;
            p.vy = p.vy * drag - 14 * dt; // gentle buoyancy
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.size += p.grow * dt;
            p.grow *= Math.pow(0.35, dt);
            p.angle += p.spin * dt;

            const t = p.age / p.life;
            const fade = t < 0.08 ? t / 0.08 : 1 - (t - 0.08) / 0.92;
            if (p.x + p.size < 0 || p.x - p.size > this.width || p.y + p.size < 0) continue;

            ctx.globalAlpha = p.alpha * fade * fade;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.drawImage(this.sprites[p.sprite], -p.size, -p.size, p.size * 2, p.size * 2);
            ctx.restore();
            this.particles[w++] = p;
        }
        this.particles.length = w;
        ctx.globalAlpha = 1;
    }
}
