// Run: npm test (node --test, no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMesh } from "./mesh.ts";
import { threeMfTriangles } from "./threemf.ts";

const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';
const RELS = '<Relationships><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

/** A closed box mesh, x by y by z, with one corner at the origin. */
function boxMesh(x: number, y: number, z: number): string {
    const v = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]];
    const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]];
    const tris = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
    return `<mesh><vertices>${v.map(([a, b, c]) => `<vertex x="${a}" y="${b}" z="${c}" />`).join("")}</vertices>`
        + `<triangles>${tris.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("")}</triangles></mesh>`;
}
const model = (resources: string, build: string, unit = "millimeter") =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="${unit}" xml:lang="en-US" ${NS}><resources>${resources}</resources><build>${build}</build></model>`;

/** Volume in cm³ and bounding size in mm, however the model is turned. */
function measure(positions: Float32Array) {
    const stats = analyzeMesh(positions);
    const size = [stats.dimensions.x, stats.dimensions.y, stats.dimensions.z].map((cm) => Math.round(cm * 100) / 10).sort((a, b) => a - b);
    return { volume: Math.round(stats.volume * 1000) / 1000, size, triangles: stats.triangles };
}

test("a single-part 3MF (PrusaSlicer, Cura) gives its mesh in millimetres", () => {
    const files = {
        "_rels/.rels": RELS,
        "3D/3dmodel.model": model(`<object id="1" type="model">${boxMesh(20, 30, 10)}</object>`, '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 90 90 0"/>'),
    };
    assert.deepEqual(measure(threeMfTriangles(files)), { volume: 6, size: [10, 20, 30], triangles: 12 });
});

test("a slicer project is read whichever order its parts come in", () => {
    const root = model('<object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>',
        '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 128 128 5" printable="1"/>');
    const sub = model(`<object id="1" type="model">${boxMesh(20, 30, 10)}</object>`, "");
    const rootFirst = { "_rels/.rels": RELS, "3D/3dmodel.model": root, "3D/Objects/object_1.model": sub };
    const rootLast = { "3D/Objects/object_1.model": sub, "3D/3dmodel.model": root, "_rels/.rels": RELS };
    for (const files of [rootFirst, rootLast]) {
        assert.deepEqual(measure(threeMfTriangles(files)), { volume: 6, size: [10, 20, 30], triangles: 12 });
    }
});

test("a 3MF in inches or centimetres is scaled to millimetres", () => {
    const inch = { "3D/3dmodel.model": model(`<object id="1" type="model">${boxMesh(1, 2, 0.5)}</object>`, '<item objectid="1"/>', "inch") };
    assert.deepEqual(measure(threeMfTriangles(inch)), { volume: 16.387, size: [12.7, 25.4, 50.8], triangles: 12 });
    const cm = { "3D/3dmodel.model": model(`<object id="1" type="model">${boxMesh(2, 3, 1)}</object>`, '<item objectid="1"/>', "centimeter") };
    assert.deepEqual(measure(threeMfTriangles(cm)), { volume: 6, size: [10, 20, 30], triangles: 12 });
});

test("objects that share an id in different parts stay separate, and transforms are applied", () => {
    // Two parts both call their mesh object 1: a 10 mm cube and a 20 mm cube, the second scaled to half.
    const root = model('<object id="5" type="model"><components>'
        + '<component p:path="/3D/Objects/a.model" objectid="1"/>'
        + '<component p:path="/3D/Objects/b.model" objectid="1" transform="0.5 0 0 0 0.5 0 0 0 0.5 100 0 0"/>'
        + "</components></object>", '<item objectid="5"/>');
    const files = {
        "_rels/.rels": RELS, "3D/3dmodel.model": root,
        "3D/Objects/a.model": model(`<object id="1" type="model">${boxMesh(10, 10, 10)}</object>`, ""),
        "3D/Objects/b.model": model(`<object id="1" type="model">${boxMesh(20, 20, 20)}</object>`, ""),
    };
    const { volume, size, triangles } = measure(threeMfTriangles(files));
    assert.equal(triangles, 24);
    assert.equal(volume, 2); // 1 cm³ + (2 cm × 0.5)³
    assert.deepEqual(size, [10, 10, 110]); // the second cube sits 100 mm along x
});

test("parts kept off the plate are not priced, and a broken file is refused", () => {
    const off = { "3D/3dmodel.model": model(`<object id="1" type="model">${boxMesh(10, 10, 10)}</object><object id="2" type="model">${boxMesh(50, 50, 50)}</object>`,
        '<item objectid="1"/><item objectid="2" printable="0"/>') };
    assert.equal(measure(threeMfTriangles(off)).volume, 1);
    assert.throws(() => threeMfTriangles({ "3D/3dmodel.model": model("", '<item objectid="9"/>') }), /missing object/);
    assert.throws(() => threeMfTriangles({ "3D/3dmodel.model": model(`<object id="1" type="model">${boxMesh(1, 1, 1)}</object>`, '<item objectid="1"/>', "furlong") }), /unknown unit/);
    assert.throws(() => threeMfTriangles({ "readme.txt": "" }), /no 3D model part/);
});
