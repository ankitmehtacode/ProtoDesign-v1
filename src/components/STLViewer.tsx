import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
    OrbitControls,
    PerspectiveCamera,
    Center,
    Grid
} from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { analyzeMesh, edgesClosed, type MeshStats } from "@/lib/mesh";

/** How long rotation input must rest before a model is measured again. */
const ROTATION_SETTLE_MS = 250;

interface STLViewerProps {
    file: File | null;
    scale?: number;
    rotation?: { x: number; y: number; z: number }; // Degrees
    color?: string; // NEW: Color prop
    showGrid?: boolean;
    /** Called when the model loads and again whenever the rotation changes. */
    onStatsCalculated: (stats: MeshStats) => void;
    /** Called when the file cannot be read as a model. */
    onError?: (message: string) => void;
}

const ModelRender = ({
                         geometry,
                         scale = 1,
                         rotation = { x: 0, y: 0, z: 0 },
                         color = "#10b981"
                     }: {
    geometry: THREE.BufferGeometry;
    scale: number;
    rotation: { x: number; y: number; z: number };
    color: string;
}) => {
    return (
        <mesh
            geometry={geometry}
            scale={[scale, scale, scale]}
            rotation={[
                rotation.x * Math.PI / 180,
                rotation.y * Math.PI / 180,
                rotation.z * Math.PI / 180
            ]}
            castShadow
            receiveShadow
        >
            <meshStandardMaterial
                color={color} // Dynamic color
                roughness={0.5}
                metalness={0.1}
            />
        </mesh>
    );
};

export const STLViewer = ({
                              file,
                              scale = 1,
                              rotation = { x: 0, y: 0, z: 0 },
                              color = "#10b981",
                              showGrid = true,
                              onStatsCalculated,
                              onError
                          }: STLViewerProps) => {
    // The geometry is kept with the file it came from, so a removed or replaced
    // file can never be shown or measured from the previous model.
    const [loaded, setLoaded] = useState<{ file: File; geometry: THREE.BufferGeometry; edgesClosed: boolean | null } | null>(null);
    const [loading, setLoading] = useState(false);
    const current = loaded && loaded.file === file ? loaded : null;
    const geometry = current?.geometry ?? null;

    // Latest callbacks without re-running the effects that use them.
    const callbacks = useRef({ onStatsCalculated, onError });
    callbacks.current = { onStatsCalculated, onError };

    useEffect(() => {
        if (!file) {
            setLoaded(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        file.arrayBuffer()
            .then((buffer) => parseModel(file.name, buffer))
            .then((geo) => {
                if (cancelled) return;
                if (!geo) throw new Error("no triangles");
                setLoaded({ file, geometry: geo, edgesClosed: edgesClosed(geo.attributes.position.array) });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Could not load model", file.name, err);
                setLoaded(null);
                callbacks.current.onError?.(`${file.name} could not be read as a 3D model. Check the file and try again.`);
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => {
            cancelled = true;
            setLoading(false);
        };
    }, [file]);

    // Measured with the same rotation the viewer shows, so overhangs and the
    // print height follow the orientation the customer picks. A large model
    // takes a noticeable moment to measure, so typing a rotation is measured
    // once it settles; a new model is measured straight away.
    // Numbers, not the object: a default rotation is a new object every render.
    const { x: rx, y: ry, z: rz } = rotation;
    const measured = useRef<THREE.BufferGeometry | null>(null);
    useEffect(() => {
        if (!current) return;
        const { geometry: geo, edgesClosed: closedEdges } = current;
        const measure = () => {
            measured.current = geo;
            const stats = analyzeMesh(geo.attributes.position.array, { x: rx, y: ry, z: rz });
            callbacks.current.onStatsCalculated({ ...stats, closed: stats.closed && closedEdges !== false });
        };
        if (measured.current !== geo) {
            measure();
            return;
        }
        const timer = setTimeout(measure, ROTATION_SETTLE_MS);
        return () => clearTimeout(timer);
    }, [current, rx, ry, rz]);

    return (
        <div className="w-full h-full rounded-lg overflow-hidden bg-gradient-to-b from-muted to-secondary relative shadow-inner border border-border">
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white z-10 backdrop-blur-sm">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                        Loading Model...
                    </div>
                </div>
            )}

            <Canvas shadows dpr={[1, 2]} camera={{ position: [50, 50, 50], fov: 50 }}>
                <PerspectiveCamera makeDefault position={[60, 60, 60]} />
                <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2} />

                <ambientLight intensity={0.6} />
                <directionalLight position={[50, 50, 25]} intensity={1} castShadow />

                {showGrid && (
                    <group>
                        <Grid
                            position={[0, -0.1, 0]}
                            args={[200, 200]}
                            cellSize={10}
                            cellThickness={1}
                            cellColor="#9ca3af"
                            sectionSize={50}
                            sectionThickness={1.5}
                            sectionColor="#4b5563"
                            fadeDistance={250}
                            infiniteGrid
                        />
                        <axesHelper args={[20]} position={[-100, 0.1, 100]} />
                    </group>
                )}

                {geometry && (
                    // Center measures once per cacheKey: re-seat the model on the floor when it turns or resizes.
                    <Center top cacheKey={`${rx},${ry},${rz},${scale}`}>
                        <ModelRender
                            geometry={geometry}
                            scale={scale}
                            rotation={rotation}
                            color={color}
                        />
                    </Center>
                )}
            </Canvas>
        </div>
    );
};
/** Every mesh under a loaded object, moved to where the file places it. */
function meshesOf(root: THREE.Object3D): THREE.BufferGeometry[] {
    const parts: THREE.BufferGeometry[] = [];
    root.updateMatrixWorld(true);
    root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) parts.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    });
    return parts;
}

/**
 * 3MF is a zip of XML parts; src/lib/threemf.ts reads the meshes out of them.
 * Only the model and relationship parts are unzipped: a slicer project also
 * carries thumbnails and settings.
 */
async function threeMfMeshes(buffer: ArrayBuffer): Promise<THREE.BufferGeometry[]> {
    const [{ unzipSync, strFromU8 }, { threeMfTriangles }] = await Promise.all([
        import("three/addons/libs/fflate.module.js"),
        import("@/lib/threemf"),
    ]);
    const files: Record<string, string> = {};
    for (const [path, bytes] of Object.entries(unzipSync(new Uint8Array(buffer), { filter: (f) => /\.(model|rels)$/i.test(f.name) }))) {
        if (/\.(model|rels)$/i.test(path)) files[path] = strFromU8(bytes);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(threeMfTriangles(files), 3));
    return [geo];
}

/**
 * STEP holds exact surfaces, not triangles, so it is meshed here with
 * OpenCascade (occt-import-js, about 7.6 MB of WebAssembly). Loaded only when
 * someone drops a STEP file, and served from our own origin.
 */
let occtLoading: ReturnType<typeof import("occt-import-js").default> | null = null;
const loadOcct = () => (occtLoading ??= Promise.all([
    import("occt-import-js"),
    import("occt-import-js/dist/occt-import-js.wasm?url"),
]).then(([{ default: occtImport }, { default: wasmUrl }]) => occtImport({ locateFile: () => wasmUrl }))
    // A failed download must not be remembered: the next STEP file tries again.
    .catch((err) => { occtLoading = null; throw err; }));

async function stepMeshes(buffer: ArrayBuffer): Promise<THREE.BufferGeometry[]> {
    const occt = await loadOcct();
    const result = occt.ReadStepFile(new Uint8Array(buffer), { linearUnit: "millimeter" });
    if (!result.success) throw new Error("OpenCascade could not read the STEP file");
    return result.meshes.map((mesh) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
        geo.setIndex(Array.from(mesh.index.array));
        return geo;
    });
}

/**
 * One non-indexed, Y-up triangle list for the whole file. Model files are Z-up
 * (as slicers read them), so they are turned to stand on the viewer's floor the
 * way they will stand on the print bed. Every mesh in the file is kept.
 */
async function parseModel(name: string, buffer: ArrayBuffer): Promise<THREE.BufferGeometry | null> {
    const lower = name.toLowerCase();
    let parts: THREE.BufferGeometry[];
    if (lower.endsWith(".stl")) {
        parts = [new STLLoader().parse(buffer)];
    } else if (lower.endsWith(".3mf")) {
        parts = await threeMfMeshes(buffer);
    } else if (lower.endsWith(".step") || lower.endsWith(".stp")) {
        parts = await stepMeshes(buffer);
    } else {
        parts = meshesOf(new OBJLoader().parse(new TextDecoder().decode(buffer)));
    }
    const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
    const length = flat.reduce((n, g) => n + g.attributes.position.count * 3, 0);
    if (length < 9) return null;

    let geo: THREE.BufferGeometry;
    if (flat.length === 1) {
        // The usual case: transform the loader's geometry in place. Copying it
        // would hold a second copy of a model that can be 200 MB.
        geo = flat[0];
    } else {
        const positions = new Float32Array(length);
        let offset = 0;
        for (const g of flat) {
            positions.set(g.attributes.position.array as ArrayLike<number>, offset);
            offset += g.attributes.position.count * 3;
        }
        geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    }
    geo.rotateX(-Math.PI / 2);
    geo.center();
    geo.computeVertexNormals();
    return geo;
}
