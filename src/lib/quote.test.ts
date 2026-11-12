// Run: npm test (node --test, no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMesh, edgesClosed } from "./mesh.ts";
import { MATERIALS, PRINTER_QUALITIES, estimatePrint, estimateWarnings, quotePrice } from "./quote.ts";

type V3 = [number, number, number];
const quality = (id: string) => PRINTER_QUALITIES.find((q) => q.id === id)!;
const material = (id: string) => MATERIALS.find((m) => m.id === id)!;

// Test shapes are built Z-up in mm, like model files, then turned Y-up the way the viewer turns them.
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): V3[][] {
    const A: V3 = [x0, y0, z0], B: V3 = [x1, y0, z0], C: V3 = [x1, y1, z0], D: V3 = [x0, y1, z0];
    const E: V3 = [x0, y0, z1], F: V3 = [x1, y0, z1], G: V3 = [x1, y1, z1], H: V3 = [x0, y1, z1];
    const quad = (a: V3, b: V3, c: V3, d: V3) => [[a, b, c], [a, c, d]];
    return [...quad(A, D, C, B), ...quad(E, F, G, H), ...quad(A, B, F, E), ...quad(B, C, G, F), ...quad(C, D, H, G), ...quad(D, A, E, H)];
}
/** Solid of revolution about Z from a closed (r, z) outline. */
function revolve(outline: [number, number][], n = 96): V3[][] {
    const tris: V3[][] = [];
    for (let i = 0; i < n; i++) {
        const t0 = (2 * Math.PI * i) / n, t1 = (2 * Math.PI * (i + 1)) / n;
        outline.forEach(([r0, z0], j) => {
            const [r1, z1] = outline[(j + 1) % outline.length];
            const P = (r: number, z: number, t: number): V3 => [r * Math.cos(t), r * Math.sin(t), z];
            const a = P(r0, z0, t0), b = P(r0, z0, t1), c = P(r1, z1, t1), d = P(r1, z1, t0);
            if (r0 > 0) tris.push([a, c, b]);
            if (r1 > 0) tris.push([a, d, c]);
        });
    }
    return tris;
}
function toViewer(tris: V3[][]): Float32Array {
    const out = new Float32Array(tris.length * 9);
    tris.flat().forEach(([x, y, z], i) => out.set([x, z, -y], i * 3));
    return out;
}
const flip = (tris: V3[][]) => tris.map(([a, b, c]) => [a, c, b]);

const cube20 = box(0, 0, 0, 20, 20, 20);
const block = box(0, 0, 0, 100, 100, 40);
const legs = [[0, 0], [54, 0], [0, 54], [54, 54]].flatMap(([x, y]) => box(x, y, 0, x + 6, y + 6, 40));
const table = [...legs, ...box(0, 0, 40, 60, 60, 45)];
const pin = revolve([[0, 0], [6, 0], [6, 90], [0, 90]]);
const tube = revolve([[27, 0], [30, 0], [30, 80], [27, 80]]);

test("measures a cube", () => {
    const s = analyzeMesh(toViewer(cube20));
    assert.ok(Math.abs(s.volume - 8) < 1e-6);
    assert.ok(Math.abs(s.area - 24) < 1e-6);
    assert.deepEqual(s.dimensions, { x: 2, y: 2, z: 2 });
    assert.equal(s.overhangSpace, 0);
    assert.equal(s.closed, true);
    assert.equal(s.triangles, 12);
});

test("reports print height as z, whichever way the file was exported", () => {
    assert.equal(analyzeMesh(toViewer(pin)).dimensions.z, 9);
    // Lying down: 90° about the viewer's X axis.
    assert.ok(Math.abs(analyzeMesh(toViewer(pin), { x: 90, y: 0, z: 0 }).dimensions.z - 1.2) < 0.01);
});

test("flags a model with a hole", () => {
    assert.equal(analyzeMesh(toViewer(cube20.slice(1))).closed, false);
});

test("finds holes that the normal sum misses", () => {
    // A tube with both ends open: the holes cancel, so only the edges show it.
    const sleeve = revolve([[10, 0], [10, 20], [0, 20], [0, 0]]).filter((t) => t.every(([x, y]) => Math.hypot(x, y) > 9));
    assert.equal(analyzeMesh(toViewer(sleeve)).closed, true, "the cheap check is fooled");
    assert.equal(edgesClosed(toViewer(sleeve)), false);
    for (const solid of [cube20, table, pin, tube]) assert.equal(edgesClosed(toViewer(solid)), true);
    assert.equal(edgesClosed(toViewer(cube20.slice(1))), false);
    assert.equal(edgesClosed(toViewer([...cube20, ...cube20])), false, "two shells in the same place");
    // Zero-area triangles, as exporters leave at poles and seams, are not holes.
    const sliver: V3[][] = [[[0, 0, 0], [0, 0, 0], [20, 0, 0]]];
    assert.equal(edgesClosed(toViewer([...cube20, ...sliver])), true);
});

test("inside-out and far-from-origin models measure the same", () => {
    const base = analyzeMesh(toViewer(table));
    const inverted = analyzeMesh(toViewer(flip(table)));
    const moved = analyzeMesh(toViewer(table.map((t) => t.map(([x, y, z]) => [x + 5000, y - 3000, z + 700] as V3))));
    for (const s of [inverted, moved]) {
        assert.ok(Math.abs(s.volume - base.volume) < 1e-3);
        assert.ok(Math.abs(s.overhangSpace - base.overhangSpace) < 1e-2);
    }
    assert.ok(base.overhangSpace > 100, "the table top needs support");
    // Upside down the top sits on the plate and the legs point up: no support.
    assert.ok(analyzeMesh(toViewer(table), { x: 180, y: 0, z: 0 }).overhangSpace < 1);
});

// OrcaSlicer 2.4.2, Bambu Lab P1S, stock Bambu profiles, supports on (docs/quote-estimate.md).
const SLICED: [string, V3[][], string, number, string, number, number][] = [
    // shape, quality, infill, material, filament cm³, total seconds
    ["cube20", cube20, "0.2-std-0.6-nozzle", 20, "pla", 3.71, 895],
    ["block", block, "0.2-std", 20, "pla", 101.6, 10578],
    ["block", block, "0.1-high", 50, "pla", 204.19, 40626],
    ["table", table, "0.2-std", 20, "pla", 24.72, 6929],
    ["tube", tube, "0.15-med", 100, "pla", 40.8, 5080],
    ["cube20", cube20, "0.2-std", 20, "abs", 3.1, 1664],
    ["pin", pin, "0.2-std", 20, "petg", 4.54, 3457],
];

test("agrees with the slicer", () => {
    for (const [name, tris, q, infill, m, cm3, seconds] of SLICED) {
        const mat = material(m);
        const e = estimatePrint(analyzeMesh(toViewer(tris)), 1, quality(q), mat, infill);
        const filamentErr = e.grams / mat.density / cm3 - 1;
        const timeErr = e.seconds / seconds - 1;
        assert.ok(Math.abs(filamentErr) < 0.15, `${name} ${q} ${m}: filament off by ${(filamentErr * 100).toFixed(0)}%`);
        assert.ok(Math.abs(timeErr) < 0.25, `${name} ${q} ${m}: time off by ${(timeErr * 100).toFixed(0)}%`);
    }
});

test("price follows the settings the way a print does", () => {
    const s = analyzeMesh(toViewer(block));
    const at = (q: string, m: string, infill: number) => estimatePrint(s, 1, quality(q), material(m), infill);
    assert.ok(at("0.2-std", "pla", 50).grams > at("0.2-std", "pla", 20).grams);
    assert.ok(at("0.1-high", "pla", 20).seconds > at("0.2-std", "pla", 20).seconds);
    assert.ok(estimatePrint(s, 2, quality("0.2-std"), material("pla"), 20).price > at("0.2-std", "pla", 20).price);
    // A hollow-ish 400 cm³ block is mostly air at 20%: nowhere near 400 cm³ of plastic.
    assert.ok(at("0.2-std", "pla", 20).grams < 200);
    assert.deepEqual(estimatePrint(analyzeMesh([]), 1), { grams: 0, seconds: 0, price: 0 });
});

test("example prices rise with size", () => {
    assert.equal(quotePrice(0), 0);
    assert.ok(quotePrice(10) < quotePrice(40) && quotePrice(40) < quotePrice(200));
});

test("warns about models it cannot price with confidence", () => {
    const s = analyzeMesh(toViewer(block));
    assert.deepEqual(estimateWarnings(s, 1), []);
    assert.equal(estimateWarnings(s, 3).length, 1, "300 mm is past the plate");
    assert.equal(estimateWarnings(analyzeMesh(toViewer(cube20.slice(1))), 1).length, 1);
    assert.equal(estimateWarnings(analyzeMesh(toViewer(box(0, 0, 0, 2, 2, 2))), 1).length, 1, "2 mm: probably inches");
});
