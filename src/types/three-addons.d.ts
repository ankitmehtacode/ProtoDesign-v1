declare module "three/addons/loaders/STLLoader.js" {
    import * as THREE from "three";
    export class STLLoader {
        load(
            url: string,
            onLoad: (geometry: THREE.BufferGeometry) => void,
            onProgress?: (event: ProgressEvent) => void,
            onError?: (event: ErrorEvent) => void
        ): void;
        parse(data: ArrayBuffer): THREE.BufferGeometry;
    }
}

declare module "three/addons/loaders/OBJLoader.js" {
    import * as THREE from "three";
    export class OBJLoader {
        load(
            url: string,
            onLoad: (object: THREE.Group) => void,
            onProgress?: (event: ProgressEvent) => void,
            onError?: (event: ErrorEvent) => void
        ): void;
        parse(data: string): THREE.Group;
    }
}

declare module "three/addons/loaders/3MFLoader.js" {
    import * as THREE from "three";
    export class ThreeMFLoader {
        parse(data: ArrayBuffer): THREE.Group;
    }
}

declare module "occt-import-js" {
    type OcctMesh = { attributes: { position: { array: number[] } }; index: { array: number[] } };
    type Occt = {
        ReadStepFile(content: Uint8Array, params: { linearUnit?: string } | null): { success: boolean; meshes: OcctMesh[] };
    };
    export default function occtImport(options?: { locateFile?: (file: string) => string }): Promise<Occt>;
}

declare module "*.wasm?url" {
    const url: string;
    export default url;
}
