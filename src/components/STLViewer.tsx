import { useEffect, useState } from "react";
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

interface ModelStats {
    volume: number; // cm3
    dimensions: { x: number; y: number; z: number }; // cm
    triangles: number;
}

interface STLViewerProps {
    file: File | null;
    scale?: number;
    rotation?: { x: number; y: number; z: number }; // Degrees
    color?: string; // NEW: Color prop
    showGrid?: boolean;
    onStatsCalculated: (stats: ModelStats) => void;
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
                              onStatsCalculated
                          }: STLViewerProps) => {
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
    const [loading, setLoading] = useState(false);

    // Calculate Volume (Signed Triangle Volume)
    const calculateVolume = (geo: THREE.BufferGeometry) => {
        const position = geo.attributes.position;
        const faces = position.count / 3;
        let sum = 0;
        const p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), p3 = new THREE.Vector3();
        for (let i = 0; i < faces; i++) {
            p1.fromBufferAttribute(position, i * 3 + 0);
            p2.fromBufferAttribute(position, i * 3 + 1);
            p3.fromBufferAttribute(position, i * 3 + 2);
            sum += p1.dot(p2.cross(p3)) / 6.0;
        }
        return Math.abs(sum) / 1000; // mm3 to cm3
    };

    useEffect(() => {
        if (!file) {
            setGeometry(null);
            return;
        }

        setLoading(true);
        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                const arrayBuffer = event.target?.result as ArrayBuffer;
                const name = file.name.toLowerCase();
                let geo: THREE.BufferGeometry | null = null;

                if (name.endsWith(".stl")) {
                    const loader = new STLLoader();
                    geo = loader.parse(arrayBuffer);
                } else if (name.endsWith(".obj")) {
                    const text = new TextDecoder().decode(arrayBuffer);
                    const loader = new OBJLoader();
                    const obj = loader.parse(text);
                    obj.traverse((child) => {
                        if ((child as THREE.Mesh).isMesh && !geo) {
                            geo = (child as THREE.Mesh).geometry.clone();
                        }
                    });
                }

                if (geo) {
                    geo.center();
                    geo.computeVertexNormals();
                    geo.computeBoundingBox();

                    const size = new THREE.Vector3();
                    geo.boundingBox!.getSize(size);

                    // Robust Triangle Counting
                    const triangleCount = geo.index
                        ? geo.index.count / 3
                        : geo.attributes.position.count / 3;

                    onStatsCalculated({
                        volume: parseFloat(calculateVolume(geo).toFixed(2)),
                        dimensions: {
                            x: parseFloat((size.x / 10).toFixed(2)),
                            y: parseFloat((size.y / 10).toFixed(2)),
                            z: parseFloat((size.z / 10).toFixed(2)),
                        },
                        triangles: Math.floor(triangleCount)
                    });
                    setGeometry(geo);
                }
            } catch (err) {
                console.error("Error loading model:", err);
            } finally {
                setLoading(false);
            }
        };
        reader.readAsArrayBuffer(file);
    }, [file]);

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
                    <Center top>
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