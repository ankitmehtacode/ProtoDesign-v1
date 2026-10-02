import { useQuery } from "@tanstack/react-query";
import { apiService } from "@/services/api.service";
import { Product } from "@/components/shop/product";
import photoPla from "@/assets/home/material-pla.webp";
import photoPetg from "@/assets/home/material-petg.webp";
import photoAbs from "@/assets/home/material-abs.webp";
import photoAsa from "@/assets/home/material-asa.webp";
import photoNylon from "@/assets/home/material-nylon.webp";
import photoUltem from "@/assets/home/material-ultem.webp";
import photoPeek from "@/assets/home/material-peek.webp";

/*
 * The heat ladder: materials ordered by how hot a part can get before it
 * softens. Temperatures are typical for the material class (they vary by grade,
 * brand and print settings) and are labelled that way on the page; nothing here
 * describes a specific product. Products are matched from the live catalogue by
 * name, so a material gets its price and Buy button as soon as it is listed.
 */
export type Rung = {
    key: string;
    name: string;
    temp: number; // °C, where it sits on the thermometer
    tempLabel: string; // in a sentence
    tempFigure: string; // the card's big reading, unit shown separately
    tempNote?: string; // small print under the reading
    title: string;
    body: string;
    strengths: string[];
    needs: string;
    replaces: string;
    match: RegExp;
    exclude?: RegExp;
    photo?: string; // studio shot of our spool (src/assets/home/CREDITS.md)
};

const COMPOSITE = /\b(cf|gf)\b|\bcarbon|glass[- ]?fib/i;

export const LADDER: Rung[] = [
    {
        key: "pla", name: "PLA", temp: 55, tempLabel: "~55 °C", tempFigure: "55",
        title: "The easy one.",
        body: "Crisp detail, low warp, low odour. Perfect for anything that lives indoors and out of the sun.",
        strengths: ["Prints on anything", "Fine detail", "Plant-based"],
        needs: "Any FDM printer",
        replaces: "Display models, décor, first prototypes",
        match: /\bpla\b/i, exclude: COMPOSITE, photo: photoPla,
    },
    {
        key: "petg", name: "PETG", temp: 75, tempLabel: "~75 °C", tempFigure: "75",
        title: "Tough and forgiving.",
        body: "Stronger layer bonding than PLA and it shrugs off moisture and everyday chemicals. For parts that get used, not just looked at.",
        strengths: ["Impact resistant", "Chemical resistant", "Low warp"],
        needs: "Any FDM printer with a heated bed",
        replaces: "Brackets, enclosures, jigs and fixtures",
        match: /\bpetg\b/i, exclude: COMPOSITE, photo: photoPetg,
    },
    {
        key: "abs", name: "ABS", temp: 100, tempLabel: "~100 °C", tempFigure: "100",
        title: "The engineering classic.",
        body: "Takes heat and knocks, and can be sanded, drilled and vapour-smoothed. The workhorse of functional parts.",
        strengths: ["Heat resistant", "High impact strength", "Easy to post-process"],
        needs: "Enclosure and heated bed",
        replaces: "Car interior parts, housings, tooling",
        match: /\babs\b/i, exclude: COMPOSITE, photo: photoAbs,
    },
    {
        key: "asa", name: "ASA", temp: 100, tempLabel: "~100 °C", tempFigure: "100",
        title: "ABS that lives outside.",
        body: "ABS-level strength with UV and weather resistance, so it doesn't yellow or turn brittle in the sun.",
        strengths: ["UV stable", "Weatherproof", "Heat resistant"],
        needs: "Enclosure and heated bed",
        replaces: "Outdoor mounts, exterior trim, signage",
        match: /\basa\b/i, exclude: COMPOSITE, photo: photoAsa,
    },
    {
        key: "pc", name: "Polycarbonate", temp: 125, tempLabel: "110–135 °C", tempFigure: "110–135",
        title: "Metal's first substitute.",
        body: "Extremely tough and rigid, and it holds its shape well past boiling point. Where printed parts start replacing machined ones.",
        strengths: ["Very high toughness", "Rigid", "High heat resistance"],
        needs: "All-metal hotend (260–300 °C) and an enclosure",
        replaces: "Machine guards, load-bearing brackets, light metal parts",
        match: /\bpc\b|polycarbonate/i, exclude: COMPOSITE,
    },
    {
        key: "nylon", name: "Nylon & PPA", temp: 160, tempLabel: "150 °C+ (PAHT, PPA)", tempFigure: "150+", tempNote: "PAHT and PPA grades",
        title: "Built to wear.",
        body: "Engineering nylons (PA12, PAHT) and PPA resist wear, oil, fuel and creep. Gears and bushings that keep running.",
        strengths: ["Wear resistant", "Oil and fuel resistant", "Low friction"],
        needs: "All-metal hotend, dry storage; hardened nozzle for fibre grades",
        replaces: "Gears, bushings, clips, under-bonnet parts",
        match: /nylon|\bpa ?(6|12)\b|\bpaht\b|\bppa\b/i, photo: photoNylon,
    },
    {
        key: "ultem", name: "ULTEM (PEI)", temp: 200, tempLabel: "~200 °C", tempFigure: "200",
        title: "Aerospace grade.",
        body: "Inherently flame-retardant, heat- and chemical-stable. Used in aircraft cabins and sterilisable tools.",
        strengths: ["Flame retardant", "Chemical stable", "Sterilisable"],
        needs: "350–400 °C hotend and a heated chamber",
        replaces: "Cabin components, electrical housings, medical fixtures",
        match: /ultem|\bpei\b/i, photo: photoUltem,
    },
    {
        key: "peek", name: "PEEK", temp: 250, tempLabel: "~250 °C continuous", tempFigure: "250", tempNote: "continuous use",
        title: "The top of the ladder.",
        body: "A super-polymer that works at around 250 °C and resists almost every chemical. Found in aerospace and medical engineering.",
        strengths: ["Extreme heat", "Near-universal chemical resistance", "Very strong"],
        needs: "Industrial printer: 400 °C+ hotend, heated chamber",
        replaces: "High-temperature metal parts",
        match: /\bpeek\b/i, photo: photoPeek,
    },
];

export const FIBRES = [
    {
        key: "cf", name: "Carbon fibre", match: /\bcf\b|\bcarbon/i,
        gain: "The stiffest option, with a clean matte finish.",
        bestFor: "Drone frames, brackets, jigs that must not flex",
    },
    {
        key: "gf", name: "Glass fibre", match: /\bgf\b|glass[- ]?fib/i,
        gain: "Tougher and less brittle than carbon, and easier on the budget.",
        bestFor: "Housings, clips and parts that take repeated impacts",
    },
];

/** Shared, cached catalogue (one request for every home section that needs it). */
export function useCatalogue() {
    return useQuery({
        queryKey: ["products"],
        queryFn: async () => {
            const res = await apiService.getProducts();
            return ((Array.isArray(res) ? res : res.data || []) as Product[]).filter((p) => !p.is_archived);
        },
        staleTime: 5 * 60 * 1000,
    });
}

const IS_MATERIAL = new Set(["filament", "resin"]);

/** Listed products for a material, cheapest first. */
export function productsFor(list: Product[] | undefined, match: RegExp, exclude?: RegExp) {
    return (list ?? [])
        .filter((p) => IS_MATERIAL.has(p.category) && match.test(`${p.name} ${p.sub_category ?? ""}`) && !(exclude?.test(p.name)))
        .sort((a, b) => Number(a.price) - Number(b.price));
}

export const productHref = (p: Product) => `/product/${p.slug || p.id}`;
