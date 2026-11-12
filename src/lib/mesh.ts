/**
 * Measures an uploaded model for the quote: the facts a slicer works from
 * (volume, surface, height, overhangs), cheap enough to redo on every rotation.
 *
 * Input is a non-indexed triangle list in millimetres (what STLLoader and
 * OBJLoader produce) with +Y up, as the quote page's viewer shows it.
 */
import { Euler, Matrix4 } from "three";

/** Faces sloping less than this from horizontal need support (Bambu Studio's default). */
const SUPPORT_THRESHOLD_DEG = 30;
/** Overhangs this close to the plate rest on it rather than on support. */
const BED_CONTACT_MM = 0.5;

export type Rotation = { x: number; y: number; z: number }; // degrees, as the viewer applies them

export type MeshStats = {
    /** Enclosed volume, cm³. */
    volume: number;
    /** Surface area, cm². */
    area: number;
    /** Size on the printer once rotated, cm: x and y across the plate, z the print height. */
    dimensions: { x: number; y: number; z: number };
    /**
     * Space under overhangs that need support, cm³ (projected overhang area
     * times its height above the plate). Support is a sparse lattice, so it
     * takes a fraction of this in filament; see quote.ts.
     */
    overhangSpace: number;
    triangles: number;
    /**
     * False when the surface has holes or the numbers are impossible, so the
     * volume, and the price with it, cannot be trusted.
     */
    closed: boolean;
};

export const EMPTY_STATS: MeshStats = {
    volume: 0, area: 0, dimensions: { x: 0, y: 0, z: 0 }, overhangSpace: 0, triangles: 0, closed: true,
};

export function analyzeMesh(positions: ArrayLike<number>, rotation: Rotation = { x: 0, y: 0, z: 0 }): MeshStats {
    const n = Math.floor(positions.length / 9) * 9;
    if (n === 0) return EMPTY_STATS;

    // Column-major, as three.js stores it; the same rotation the viewer applies.
    const e = new Matrix4().makeRotationFromEuler(new Euler(
        rotation.x * Math.PI / 180, rotation.y * Math.PI / 180, rotation.z * Math.PI / 180, "XYZ",
    )).elements;
    const rot = (i: number, out: number[]) => {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        out[0] = e[0] * x + e[4] * y + e[8] * z;
        out[1] = e[1] * x + e[5] * y + e[9] * z;
        out[2] = e[2] * x + e[6] * y + e[10] * z;
    };

    // Pass 1: the rotated bounding box. Overhang heights are measured from its floor.
    const v = [0, 0, 0];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i += 3) {
        rot(i, v);
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }

    // Pass 2: volume, area and overhangs, relative to the box corner so the
    // sums stay well conditioned for models far from the origin.
    const supportBelow = -Math.cos(SUPPORT_THRESHOLD_DEG * Math.PI / 180);
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    let volume6 = 0, area2 = 0;
    // Overhangs for both windings: the sign of the volume says which way faces point.
    let overhang = 0, overhangInverted = 0;
    // Area-weighted normals sum to zero on any closed surface.
    let nSumX = 0, nSumY = 0, nSumZ = 0;
    for (let i = 0; i < n; i += 9) {
        rot(i, a); rot(i + 3, b); rot(i + 6, c);
        const ax = a[0] - minX, ay = a[1] - minY, az = a[2] - minZ;
        const bx = b[0] - minX, by = b[1] - minY, bz = b[2] - minZ;
        const cx = c[0] - minX, cy = c[1] - minY, cz = c[2] - minZ;
        volume6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const wx = cx - ax, wy = cy - ay, wz = cz - az;
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; // length = 2 × area
        const len = Math.hypot(nx, ny, nz);
        area2 += len;
        nSumX += nx; nSumY += ny; nSumZ += nz;
        const height = (ay + by + cy) / 3;
        if (len > 0 && height > BED_CONTACT_MM) {
            if (ny / len < supportBelow) overhang += (-ny / 2) * height;
            else if (-ny / len < supportBelow) overhangInverted += (ny / 2) * height;
        }
    }

    const volumeMm3 = Math.abs(volume6) / 6;
    const areaMm2 = area2 / 2;
    const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
    const openness = areaMm2 > 0 ? Math.hypot(nSumX, nSumY, nSumZ) / 2 / areaMm2 : 1;
    const closed = openness < 0.01 && volumeMm3 > 0 && volumeMm3 <= sizeX * sizeY * sizeZ * 1.001;

    return {
        volume: volumeMm3 / 1000,
        area: areaMm2 / 100,
        // The viewer is Y-up; the printer is Z-up.
        dimensions: { x: sizeX / 10, y: sizeZ / 10, z: sizeY / 10 },
        overhangSpace: (volume6 < 0 ? overhangInverted : overhang) / 1000,
        triangles: n / 9,
        closed,
    };
}

/** Above this, checking every edge costs more time than a page should freeze for. */
const MAX_EDGE_CHECK_TRIANGLES = 500_000; // about half a second
const AXIS_STEPS = 131072; // 2^17 per axis: three axes pack exactly into a double
const GRID_OFFSET = 0.2371;

/**
 * Whether every edge is shared by exactly two triangles: true for a watertight
 * surface, false for holes, loose flaps or overlapping shells. The normal sum
 * in analyzeMesh misses holes that cancel out (a tube with both ends open),
 * which this catches. Doesn't change with rotation, so run it once per file.
 * Null when the model is too big to check.
 */
export function edgesClosed(positions: ArrayLike<number>): boolean | null {
    const n = Math.floor(positions.length / 9) * 9;
    if (n === 0) return true;
    if (n / 9 > MAX_EDGE_CHECK_TRIANGLES) return null;

    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
        const v = positions[i], a = i % 3;
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
    }
    // Corners closer than a step are one corner. The grid is shifted off the
    // half-step so a symmetric model's centre line (exactly halfway, give or
    // take rounding noise) doesn't straddle a boundary and split in two.
    const step = Math.max(1e-4, Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / (AXIS_STEPS - 2));
    const cell = (v: number, lo: number) => Math.round((v - lo) / step + GRID_OFFSET);
    const corners = n / 3;
    const keys = new Float64Array(corners);
    for (let c = 0; c < corners; c++) {
        const i = c * 3;
        keys[c] = (cell(positions[i], min[0]) * AXIS_STEPS + cell(positions[i + 1], min[1])) * AXIS_STEPS
            + cell(positions[i + 2], min[2]);
    }

    // Number the distinct corners: sort, drop repeats, then find each by binary search.
    const sorted = keys.slice().sort();
    let unique = 0;
    for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[unique++] = sorted[i];
    const id = (key: number) => {
        let lo = 0, hi = unique - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sorted[mid] < key) lo = mid + 1; else hi = mid;
        }
        return lo;
    };

    const VERTICES = 2 ** 26; // ids stay below this up to the triangle cap
    const edges = new Float64Array(corners);
    let count = 0;
    for (let t = 0; t < corners; t += 3) {
        const v = [id(keys[t]), id(keys[t + 1]), id(keys[t + 2])];
        // Exporters leave zero-area triangles with a repeated corner; they hold nothing together.
        if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
        for (let e = 0; e < 3; e++) {
            const a = v[e], b = v[(e + 1) % 3];
            edges[count++] = Math.min(a, b) * VERTICES + Math.max(a, b);
        }
    }
    const used = edges.subarray(0, count).sort();
    for (let i = 0; i < count;) {
        let j = i;
        while (j < count && used[j] === used[i]) j++;
        if (j - i !== 2) return false;
        i = j;
    }
    return true;
}
