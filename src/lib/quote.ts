/**
 * The custom-print quote: options, limits and the estimate. One source for
 * the quote page (/custom) and the example prices elsewhere on the site.
 *
 * The estimate prices what a print actually costs us: the filament it uses
 * and the hours it holds a printer, plus setup. Filament and time come from
 * the model's shape (see mesh.ts) through a model fitted to OrcaSlicer 2.4.2
 * slicing 12 test shapes on a Bambu Lab P1S with the stock Bambu profiles,
 * supports on (168 slices, docs/quote-estimate.md). Against the slicer it is
 * within about 3–6% on filament and 8–14% on time (RMS).
 *
 * MAX_MODEL_MB mirrors MAX_STL_BYTES in backend/src/services/storage.service.js;
 * src/seo/faq.js describes the same options in words. Change them together.
 */
import type { MeshStats } from "./mesh";

/* --- Business rates: what we charge. Change freely. --- */
export const SETUP_FEE_INR = 150;
const MACHINE_INR_PER_HOUR = 80;

/* --- Physics: fitted to the slicer. Refit with scripts/quote-calibration (docs/quote-estimate.md) rather than tune by hand. --- */
/** Support filament as a share of the space under overhangs. */
const SUPPORT_FILL = 0.1;
/** Heating, levelling and purge before the first layer. */
const START_SECONDS = 376;
/** Slowest the printer goes to let a small layer cool. */
const MIN_COOLING_SPEED_MM_S = 20;

export const MAX_MODEL_MB = 200;
export const MODEL_EXTENSIONS = [".stl", ".obj"] as const;

/*
 * shellCm: walls plus top and bottom skins, as a thickness over the surface.
 * Seconds: per layer (moves, retracts) and per cm³ laid as shell, sparse
 * infill, solid (100%) infill and support. Sparse infill is slower per cm³
 * than solid: more turns and travel.
 */
export const PRINTER_QUALITIES = [
    { id: "0.2-std-0.6-nozzle", name: "0.2 mm Standard (0.6mm Nozzle)", layerMm: 0.2, lineMm: 0.62, shellCm: 0.110,
      secPerLayer: 2.6, secPerCm3: { shell: 69.0, sparse: 96.1, solid: 59.3, support: 337 } },
    { id: "0.2-std", name: "0.2 mm Standard", layerMm: 0.2, lineMm: 0.42, shellCm: 0.085,
      secPerLayer: 3.19, secPerCm3: { shell: 76.4, sparse: 106.9, solid: 59.7, support: 364 } },
    { id: "0.15-med", name: "0.15 mm Medium", layerMm: 0.15, lineMm: 0.42, shellCm: 0.091,
      secPerLayer: 3.4, secPerCm3: { shell: 88.0, sparse: 130.8, solid: 68.5, support: 487 } },
    { id: "0.1-high", name: "0.1 mm High Detail", layerMm: 0.1, lineMm: 0.42, shellCm: 0.081,
      secPerLayer: 3.69, secPerCm3: { shell: 103.9, sparse: 181.6, solid: 92.4, support: 736 } },
];
export type PrintQuality = (typeof PRINTER_QUALITIES)[number];

/*
 * density g/cm³; inrPerGram is what we charge for the filament (business rate);
 * minLayerSec is the cooling time per layer from the Bambu filament profiles,
 * which makes small ABS and PETG parts much slower than PLA.
 */
export const MATERIALS = [
    { id: "abs", name: "ABS", density: 1.04, inrPerGram: 6, minLayerSec: 12, colors: ["Black", "White", "Grey", "Red", "Blue"] },
    { id: "pla", name: "PLA", density: 1.24, inrPerGram: 5, minLayerSec: 4, colors: ["Black", "White", "Grey", "Yellow", "Green"] },
    { id: "petg", name: "PETG", density: 1.27, inrPerGram: 6.5, minLayerSec: 10, colors: ["Translucent", "Black"] },
];
export type PrintMaterial = (typeof MATERIALS)[number];

/** Build volume of the printers custom jobs run on (Bambu Lab P1S/X1), cm. */
export const BUILD_VOLUME_CM = { x: 25.6, y: 25.6, z: 25 };

const names = MATERIALS.map((m) => m.name);
/** "ABS, PLA or PETG" */
export const MATERIAL_LIST = `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

export const INFILLS = [20, 30, 40, 50, 60, 70, 80, 90, 100];

/** The quote page's starting settings, which the home page estimate assumes. */
export const DEFAULT_INFILL = INFILLS[0];
export const DEFAULT_QUALITY = PRINTER_QUALITIES[0];
export const DEFAULT_MATERIAL = MATERIALS[0];

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

export type Estimate = { grams: number; seconds: number; price: number };

/** Filament, print time and price for a model measured by analyzeMesh, at `scale` (1 = 100%). */
export function estimatePrint(
    stats: Pick<MeshStats, "volume" | "area" | "overhangSpace" | "dimensions">,
    scale: number,
    quality: PrintQuality = DEFAULT_QUALITY,
    material: PrintMaterial = DEFAULT_MATERIAL,
    infill: number = DEFAULT_INFILL,
): Estimate {
    if (!(stats.volume > 0) || !(scale > 0)) return { grams: 0, seconds: 0, price: 0 };
    const volume = stats.volume * scale ** 3;
    const area = stats.area * scale ** 2;
    const height = stats.dimensions.z * scale;

    // cm³ of filament: a solid shell over the surface (all of it for thin
    // parts), infill inside, and a sparse lattice under overhangs.
    const shell = Math.min(volume, area * quality.shellCm);
    const inner = (volume - shell) * (infill / 100);
    const support = stats.overhangSpace * scale ** 3 * SUPPORT_FILL;
    const filament = shell + inner + support;

    const layers = Math.max(1, Math.ceil((height * 10) / quality.layerMm));
    const rate = quality.secPerCm3;
    const printing = layers * quality.secPerLayer + shell * rate.shell
        + inner * (infill >= 100 ? rate.solid : rate.sparse) + support * rate.support;
    // Small layers wait to cool, but the printer will not crawl slower than
    // MIN_COOLING_SPEED_MM_S, so a tiny layer cannot be stretched to the full wait.
    const slowestLayer = (filament * 1000) / layers / (quality.layerMm * quality.lineMm * MIN_COOLING_SPEED_MM_S);
    const seconds = Math.max(printing, layers * Math.min(material.minLayerSec, slowestLayer)) + START_SECONDS;

    const grams = filament * material.density;
    const price = Math.round(SETUP_FEE_INR + grams * material.inrPerGram + (seconds / 3600) * MACHINE_INR_PER_HOUR);
    return { grams, seconds, price };
}

/**
 * Example price for a compact, solid-looking part of `volumeCm3` (a cube, no
 * overhangs) at the quote page's starting settings. For marketing copy only;
 * a real file is priced by estimatePrint.
 */
export function quotePrice(volumeCm3: number): number {
    if (!(volumeCm3 > 0)) return 0;
    const side = Math.cbrt(volumeCm3);
    return estimatePrint({ volume: volumeCm3, area: 6 * side * side, overhangSpace: 0, dimensions: { x: side, y: side, z: side } }, 1).price;
}

/** "3h 05m" */
export function formatDuration(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Things the customer should know before trusting the estimate. */
export function estimateWarnings(stats: MeshStats, scale: number): string[] {
    if (!stats.volume && !stats.triangles) return [];
    const warnings: string[] = [];
    if (!stats.closed) {
        warnings.push("This model has holes or overlapping surfaces, so its volume can't be measured reliably. We'll check it and confirm the price.");
    }
    const d = { x: stats.dimensions.x * scale, y: stats.dimensions.y * scale, z: stats.dimensions.z * scale };
    const [a, b] = [d.x, d.y].sort((p, q) => q - p);
    if (a > BUILD_VOLUME_CM.x || b > BUILD_VOLUME_CM.y || d.z > BUILD_VOLUME_CM.z) {
        warnings.push(`At this size it's bigger than our ${BUILD_VOLUME_CM.x} × ${BUILD_VOLUME_CM.y} × ${BUILD_VOLUME_CM.z} cm print area. We'll print it in parts or suggest a size, and confirm the price.`);
    }
    if (Math.max(d.x, d.y, d.z) < 0.5) {
        warnings.push("This model is under 5 mm. If it was exported in inches or centimetres, scale it up to its real size.");
    }
    return warnings;
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

/* --- Contact for a quote (components/QuoteContactCard.tsx) --- */

export type ContactErrors = { email?: string; phone?: string };

// Same rules as the server (backend/src/services/quote.email.js).
const SINGLE_EMAIL = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;

export function contactErrors(contact: { email: string; phone: string }): ContactErrors {
    const errors: ContactErrors = {};
    if (!SINGLE_EMAIL.test(contact.email.trim())) {
        errors.email = contact.email.trim() ? "Please check your email address." : "Enter your email to receive the quote.";
    }
    const digits = contact.phone.replace(/\D/g, "").length;
    if (!/^\+?[0-9\s()-]+$/.test(contact.phone.trim()) || digits < 10 || digits > 15) {
        errors.phone = contact.phone.trim() ? "Enter a 10-digit mobile number." : "Enter your WhatsApp number.";
    }
    return errors;
}

// Misspellings of the domains most customers use. A wrong domain means the
// quote and payment link never arrive, and the customer thinks we ignored them.
const DOMAIN_FIXES: Record<string, string> = {
    "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gamil.com": "gmail.com",
    "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.in": "gmail.com",
    "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
    "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com", "yahoo.co": "yahoo.com",
    "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com", "outlok.com": "outlook.com", "outlook.con": "outlook.com",
    "rediffmail.con": "rediffmail.com", "redifmail.com": "rediffmail.com",
};

export function emailSuggestion(email: string): string | null {
    const [local, domain] = email.trim().toLowerCase().split("@");
    const fixed = local && domain ? DOMAIN_FIXES[domain] : undefined;
    return fixed ? `${local}@${fixed}` : null;
}
