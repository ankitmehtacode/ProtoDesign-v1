/**
 * Reads the triangles out of a 3MF file for the quote page.
 *
 * A 3MF is a zip of XML "model" parts. The root part lists what is on the
 * plate (build items); each item names an object, which is either a mesh or a
 * set of components pointing at other objects, possibly in another part
 * (slicer projects from Bambu Studio and OrcaSlicer keep every mesh in
 * 3D/Objects/*.model). Only geometry is read: colours, materials and slicer
 * settings do not change the price.
 *
 * three.js ships a 3MF loader, but it ignores the unit a file declares, fails
 * when the root part comes before the parts it refers to, and mixes up objects
 * that share an id across parts, so the meshes are read here instead.
 *
 * Input is the unzipped text of the parts (see STLViewer.tsx), so this stays a
 * pure function that tests can run without a browser.
 */

/** Millimetres per unit a 3MF may declare (3MF core specification, 3.4). */
const UNIT_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

const MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
/** Components nest; a file that nests deeper than this is looping. */
const MAX_DEPTH = 16;

/** Row-major 4x3 affine as 3MF writes it: x' = x·m[0] + y·m[3] + z·m[6] + m[9]. */
type Matrix = number[];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

type Ref = { path: string; id: string; matrix: Matrix };
type ObjectData = { vertices: number[]; triangles: number[]; components: Ref[] };
type Part = { unit: string; objects: Map<string, ObjectData>; items: Ref[] };

const normalize = (path: string) => path.replace(/^\/+/, "");

/** An attribute's value from a tag's attribute text; `name` may carry any namespace prefix. */
function attr(attrs: string, name: string): string | undefined {
    return new RegExp(`(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];
}

function matrixOf(attrs: string): Matrix {
    const text = attr(attrs, "transform");
    if (!text) return IDENTITY;
    const m = text.trim().split(/\s+/).map(Number);
    if (m.length !== 12 || m.some((n) => !Number.isFinite(n))) throw new Error(`3MF has a transform that is not 12 numbers: "${text}"`);
    return m;
}

/** The transform that applies `first`, then `then`. */
function compose(first: Matrix, then: Matrix): Matrix {
    const out = new Array<number>(12);
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
            out[row * 3 + col] = first[row * 3] * then[col] + first[row * 3 + 1] * then[3 + col] + first[row * 3 + 2] * then[6 + col]
                + (row === 3 ? then[9 + col] : 0);
        }
    }
    return out;
}

function ref(attrs: string, ownPath: string): Ref {
    const id = attr(attrs, "objectid");
    if (id === undefined) throw new Error("3MF refers to an object without an objectid");
    const path = attr(attrs, "path");
    return { path: path ? normalize(path) : ownPath, id, matrix: matrixOf(attrs) };
}

function parsePart(xml: string, path: string): Part {
    const unit = attr(/<(?:\w+:)?model\b([^>]*)>/.exec(xml)?.[1] ?? "", "unit") ?? "millimeter";
    const objects = new Map<string, ObjectData>();
    for (const [, attrs, body] of xml.matchAll(/<(?:\w+:)?object\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?object>/g)) {
        const id = attr(attrs, "id");
        if (id === undefined) continue;
        const data: ObjectData = { vertices: [], triangles: [], components: [] };
        for (const [, a] of body.matchAll(/<(?:\w+:)?vertex\b([^>]*)\/>/g)) {
            data.vertices.push(Number(attr(a, "x")), Number(attr(a, "y")), Number(attr(a, "z")));
        }
        for (const [, a] of body.matchAll(/<(?:\w+:)?triangle\b([^>]*)\/>/g)) {
            data.triangles.push(Number(attr(a, "v1")), Number(attr(a, "v2")), Number(attr(a, "v3")));
        }
        for (const [, a] of body.matchAll(/<(?:\w+:)?component\b([^>]*)\/>/g)) data.components.push(ref(a, path));
        objects.set(id, data);
    }
    const items: Ref[] = [];
    for (const [, a] of xml.matchAll(/<(?:\w+:)?item\b([^>]*)\/>/g)) {
        // Parts a slicer project keeps off the plate are not printed.
        if (attr(a, "printable") !== "0") items.push(ref(a, path));
    }
    return { unit, objects, items };
}

/** The part the package names as its 3D model, else the one directly under 3D/. */
function rootPath(files: Record<string, string>): string {
    const paths = Object.keys(files);
    const rels = paths.find((p) => normalize(p).toLowerCase() === "_rels/.rels");
    if (rels) {
        for (const [, a] of files[rels].matchAll(/<Relationship\b([^>]*)\/?>/g)) {
            const target = attr(a, "Target");
            if (attr(a, "Type") === MODEL_REL && target) return normalize(target);
        }
    }
    const fallback = paths.map(normalize).find((p) => /^3D\/[^/]+\.model$/i.test(p));
    if (!fallback) throw new Error("3MF has no 3D model part");
    return fallback;
}

/**
 * Every printable triangle in the file as a flat, non-indexed position list in
 * millimetres, each mesh placed where the build puts it.
 * @param files unzipped text of the package's .model and .rels parts, by path
 */
export function threeMfTriangles(files: Record<string, string>): Float32Array {
    const text = new Map(Object.entries(files).map(([path, xml]) => [normalize(path), xml]));
    const parts = new Map<string, Part>();
    const part = (path: string) => {
        let p = parts.get(path);
        if (!p) {
            const xml = text.get(path);
            if (xml === undefined) throw new Error(`3MF refers to a missing part: ${path}`);
            parts.set(path, p = parsePart(xml, path));
        }
        return p;
    };

    const root = part(rootPath(files));
    const mm = UNIT_MM[root.unit];
    if (!mm) throw new Error(`3MF declares an unknown unit: ${root.unit}`);

    const out: number[] = [];
    const emit = ({ path, id, matrix }: Ref, depth: number) => {
        if (depth > MAX_DEPTH) throw new Error("3MF components are nested too deeply");
        const object = part(path).objects.get(id);
        if (!object) throw new Error(`3MF refers to a missing object: ${id} in ${path}`);
        const { vertices, triangles } = object;
        for (const index of triangles) {
            const x = vertices[index * 3], y = vertices[index * 3 + 1], z = vertices[index * 3 + 2];
            if (!Number.isFinite(x + y + z)) throw new Error("3MF has a triangle that points at a missing vertex");
            out.push(
                (x * matrix[0] + y * matrix[3] + z * matrix[6] + matrix[9]) * mm,
                (x * matrix[1] + y * matrix[4] + z * matrix[7] + matrix[10]) * mm,
                (x * matrix[2] + y * matrix[5] + z * matrix[8] + matrix[11]) * mm,
            );
        }
        for (const c of object.components) emit({ ...c, matrix: compose(c.matrix, matrix) }, depth + 1);
    };
    for (const item of root.items) emit(item, 0);
    return new Float32Array(out);
}
