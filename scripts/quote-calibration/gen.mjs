// Test shapes for calibrating the quote estimate (docs/quote-estimate.md).
// Writes models/<name>.stl (Z-up, mm, ASCII: OrcaSlicer 2.4.2 rejected one valid
// binary STL) and stats.json, each shape measured by the site's own analyzeMesh.
import fs from "node:fs";
import { analyzeMesh } from "../../src/lib/mesh.ts";

const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
function box(x0, y0, z0, x1, y1, z1) {
    const A = [x0, y0, z0], B = [x1, y0, z0], C = [x1, y1, z0], D = [x0, y1, z0];
    const E = [x0, y0, z1], F = [x1, y0, z1], G = [x1, y1, z1], H = [x0, y1, z1];
    return [...quad(A, D, C, B), ...quad(E, F, G, H), ...quad(A, B, F, E), ...quad(B, C, G, F), ...quad(C, D, H, G), ...quad(D, A, E, H)];
}
// Solid of revolution about Z from a closed (r, z) outline.
function revolve(outline, n = 96) {
    const tris = [];
    for (let i = 0; i < n; i++) {
        const t0 = (2 * Math.PI * i) / n, t1 = (2 * Math.PI * (i + 1)) / n;
        outline.forEach(([r0, z0], j) => {
            const [r1, z1] = outline[(j + 1) % outline.length];
            const P = (r, z, t) => [r * Math.cos(t), r * Math.sin(t), z];
            const a = P(r0, z0, t0), b = P(r0, z0, t1), c = P(r1, z1, t1), d = P(r1, z1, t0);
            if (r0 > 0) tris.push([a, c, b]);
            if (r1 > 0) tris.push([a, d, c]);
        });
    }
    return tris;
}
const ring = (n, f) => Array.from({ length: n }, (_, i) => f((2 * Math.PI * i) / n));
const arc = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(-Math.PI / 2 + (Math.PI * i) / n));

const models = {
    cube20: box(0, 0, 0, 20, 20, 20),
    cube50: box(0, 0, 0, 50, 50, 50),
    block: box(0, 0, 0, 100, 100, 40),
    tube: revolve([[27, 0], [30, 0], [30, 80], [27, 80]]),
    sphere: revolve(arc(48, (t) => [Math.abs(25 * Math.cos(t)) < 1e-9 ? 0 : 25 * Math.cos(t), 25 + 25 * Math.sin(t)]).reverse()),
    pin: revolve([[0, 0], [6, 0], [6, 90], [0, 90]]),
    plate: box(0, 0, 0, 120, 80, 3),
    table: [...[[0, 0], [54, 0], [0, 54], [54, 54]].flatMap(([x, y]) => box(x, y, 0, x + 6, y + 6, 40)), ...box(0, 0, 40, 60, 60, 45)],
    mushroom: [...revolve([[0, 0], [5, 0], [5, 30], [0, 30]]), ...revolve([[0, 30], [30, 30], [30, 34], [8, 42], [0, 42]])],
    torus: revolve(ring(48, (t) => [30 + 8 * Math.cos(t), 8 + 8 * Math.sin(t)])),
    cone: revolve([[0, 0], [35, 0], [0, 70]]),
    bowl: revolve([[0, 0], [20, 0], [40, 40], [36, 40], [17, 4], [0, 4]]),
};

fs.mkdirSync("models", { recursive: true });
const stats = {};
for (const [name, tris] of Object.entries(models)) {
    let stl = `solid ${name}\n`;
    for (const t of tris) stl += `facet normal 0 0 0\nouter loop\n${t.map((v) => `vertex ${v.join(" ")}`).join("\n")}\nendloop\nendfacet\n`;
    fs.writeFileSync(`models/${name}.stl`, `${stl}endsolid ${name}\n`);
    // Z-up file to the viewer's Y-up, as STLViewer does.
    const viewer = new Float32Array(tris.flat().flatMap(([x, y, z]) => [x, z, -y]));
    stats[name] = analyzeMesh(viewer);
    if (!stats[name].closed) throw new Error(`${name} is not closed: fix the generator`);
}
fs.writeFileSync("stats.json", JSON.stringify(stats, null, 1));
console.log(Object.entries(stats).map(([k, s]) => `${k} ${s.volume.toFixed(2)} cm³`).join("\n"));
