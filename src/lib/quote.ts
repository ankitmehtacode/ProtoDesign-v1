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
