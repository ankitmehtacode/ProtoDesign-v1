/**
 * The custom-print quote: options, limits and the price formula. One source for
 * the quote page (/custom) and the home page's estimate, so the price a visitor
 * sees on the home page is the price the quote page will show them.
 *
 * MAX_MODEL_MB mirrors MAX_STL_BYTES in backend/src/services/storage.service.js;
 * src/seo/faq.js describes the same options in words. Change them together.
 */

export const SETUP_FEE_INR = 150;
const BASE_RATE_INR_PER_CM3 = 8;

export const MAX_MODEL_MB = 200;
export const MODEL_EXTENSIONS = [".stl", ".obj"] as const;

export const PRINTER_QUALITIES = [
    { id: "0.2-std-0.6-nozzle", name: "0.2 mm Standard (0.6mm Nozzle)", layerMm: 0.2, multiplier: 1.0 },
    { id: "0.2-std", name: "0.2 mm Standard", layerMm: 0.2, multiplier: 1.2 },
    { id: "0.15-med", name: "0.15 mm Medium", layerMm: 0.15, multiplier: 1.5 },
    { id: "0.1-high", name: "0.1 mm High Detail", layerMm: 0.1, multiplier: 2.0 },
];

// density in g/cm3, for the weight estimate
export const MATERIALS = [
    { id: "abs", name: "ABS", density: 1.04, colors: ["Black", "White", "Grey", "Red", "Blue"] },
    { id: "pla", name: "PLA", density: 1.24, colors: ["Black", "White", "Grey", "Yellow", "Green"] },
    { id: "petg", name: "PETG", density: 1.27, colors: ["Translucent", "Black"] },
];

const names = MATERIALS.map((m) => m.name);
/** "ABS, PLA or PETG" */
export const MATERIAL_LIST = `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

export const INFILLS = [20, 30, 40, 50, 60, 70, 80, 90, 100];

/** The quote page's starting settings, which the home page estimate assumes. */
export const DEFAULT_INFILL = INFILLS[0];
export const DEFAULT_QUALITY = PRINTER_QUALITIES[0];

const COLOR_HEX: Record<string, string> = {
    Black: "#1a1a1a",
    White: "#f5f5f5",
    Grey: "#808080",
    Red: "#ef4444",
    Blue: "#3b82f6",
    Yellow: "#eab308",
    Green: "#22c55e",
    Translucent: "#e5e7eb",
};

/** Display colour for a filament colour name (viewer and swatches). */
export const colorHex = (name: string) => COLOR_HEX[name] ?? "#10b981";

/** Price in INR for a model whose (already scaled) volume is `volumeCm3`. */
export function quotePrice(volumeCm3: number, qualityMultiplier = DEFAULT_QUALITY.multiplier, infill = DEFAULT_INFILL): number {
    if (!volumeCm3) return 0;
    const infillFactor = 1 + infill / 200;
    return Math.round(volumeCm3 * BASE_RATE_INR_PER_CM3 * qualityMultiplier * infillFactor) + SETUP_FEE_INR;
}

/** Why a file cannot be quoted, or null when it can. */
export function modelFileProblem(file: File): string | null {
    const name = file.name.toLowerCase();
    if (!MODEL_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        return `${file.name} is not an STL or OBJ file. Export your model as .stl or .obj and try again.`;
    }
    if (file.size > MAX_MODEL_MB * 1024 * 1024) {
        return `${file.name} is larger than ${MAX_MODEL_MB} MB. Reduce the mesh resolution and try again.`;
    }
    return null;
}

/*
 * Hand-off for a model picked outside the quote page (the home page drop zone),
 * or held while the visitor signs in to send a quote. In memory only: a File
 * cannot be persisted, and a reload starting fresh is the honest behaviour.
 */
export type PendingQuote = {
    file: File;
    settings?: {
        qualityId: string;
        materialId: string;
        color: string;
        infill: number;
        scale: number;
        rotation: { x: number; y: number; z: number };
    };
};

let pending: PendingQuote | null = null;

export const holdQuote = (quote: PendingQuote) => {
    pending = quote;
};

/** Returns the held quote once, then forgets it. */
export const takeHeldQuote = (): PendingQuote | null => {
    const quote = pending;
    pending = null;
    return quote;
};
