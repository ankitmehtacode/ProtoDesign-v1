// @ts-check
/*
 * Printer comparisons (/compare/...) and custom-printing use cases
 * (/3d-printing/...). One source for the React pages, their prerendered HTML
 * (scripts/prerender.mjs) and public/sitemap-guides.xml's entries, which the
 * prerender writes from exactly the pages it built.
 *
 * Copy rules, as in site.js: every claim must be true today.
 *  - Comparisons name products by slug and take every price and spec from
 *    the catalogue at render time; the verdicts below only state differences
 *    the products' own specifications show, or that hold for the model line
 *    (enclosure, frame type). A pair whose product is archived, unpriced or
 *    renamed (new slug) is left out of the site, so a page never shows a
 *    printer we do not sell.
 *  - Use-case facts (materials, file limits, prices) come from src/lib/quote.ts
 *    and src/seo/faq.js; the pages compute example prices with quotePrice.
 */

import { FACTS, faqLd } from "./faq.js";
import { SITE_NAME, SITE_URL, breadcrumbLd, plainText, productUrl } from "./site.js";

/**
 * @typedef {{ slug: string, name: string }} Side
 * @typedef {{ slug: string, a: Side, b: Side, intro: string, chooseA: string, chooseB: string }} Comparison
 */

/** @type {Comparison[]} */
export const COMPARISONS = [
    {
        slug: "bambu-lab-a1-mini-vs-a1",
        a: { slug: "bambu-lab-a1-mini-3d-printer-db0w", name: "Bambu Lab A1 Mini" },
        b: { slug: "bambu-lab-a1-3d-printer--0c43", name: "Bambu Lab A1" },
        intro: "The same open-frame Bambu Lab printer in two sizes. Both print PLA, PETG and TPU, and both work with the AMS lite for multi-colour prints. The difference is how big a part you can print and how much desk it takes.",
        chooseA: "Your prints fit in a 180 mm cube (figurines, gadgets, small parts), desk space is tight, or this is your first printer and you want the lowest price.",
        chooseB: "You want to print larger parts in one piece: the A1 prints up to a 256 mm cube, over 2.8 times the volume of the A1 Mini.",
    },
    {
        slug: "bambu-lab-a1-vs-p1s",
        a: { slug: "bambu-lab-a1-3d-printer--0c43", name: "Bambu Lab A1" },
        b: { slug: "bambu-lab-p1s-3d-printer--f109", name: "Bambu Lab P1S" },
        intro: "Same 256 mm build volume, two different machines. The A1 is open-frame with a moving bed; the P1S is a closed CoreXY printer. The enclosure is what decides which materials you can print well.",
        chooseA: "You print PLA, PETG and TPU: toys, decor, household parts and most prototypes. It costs less and does those materials well.",
        chooseB: "You want ABS or ASA for parts that face heat or sunlight (car parts, outdoor fittings, enclosures). Those materials warp in open air, and the P1S's closed chamber keeps them warm.",
    },
    {
        slug: "bambu-lab-p1s-vs-p2s",
        a: { slug: "bambu-lab-p1s-3d-printer--f109", name: "Bambu Lab P1S" },
        b: { slug: "bambu-lab-p2s-3d-printer-7173", name: "Bambu Lab P2S" },
        intro: "Two generations of Bambu Lab's enclosed printer. Both print a 256 mm cube and handle ABS and ASA. The P2S is the newer model.",
        chooseA: "You want an enclosed printer for ABS and ASA at the lower price. It is a proven machine.",
        chooseB: "You want the newer generation: a faster toolhead (600 mm/s against 500) and a hotter bed (110 °C).",
    },
    {
        slug: "bambu-lab-p1s-vs-elegoo-centauri-carbon",
        a: { slug: "bambu-lab-p1s-3d-printer--f109", name: "Bambu Lab P1S" },
        b: { slug: "elegoo-centauri-carbon-3d-printer-cccc", name: "ELEGOO Centauri Carbon" },
        intro: "Two enclosed CoreXY printers with the same 256 mm cube build volume, from different makers. They differ in software and in what you can add later.",
        chooseA: "You may want multi-colour later: the P1S works with Bambu Lab's AMS. You also get Bambu Studio and the Bambu Handy app for remote monitoring.",
        chooseB: "You want an enclosed printer for less, and prefer to use your own slicer: it works with OrcaSlicer, Cura and PrusaSlicer.",
    },
    {
        slug: "bambu-lab-p1s-vs-creality-k1c",
        a: { slug: "bambu-lab-p1s-3d-printer--f109", name: "Bambu Lab P1S" },
        b: { slug: "creality-k1c-3d-printer-zlft", name: "Creality K1C" },
        intro: "Two enclosed CoreXY printers. The K1C is Creality's version for carbon-fibre filled filament; the P1S has the larger build volume.",
        chooseA: "You want the bigger build volume (256 mm cube against 220 × 220 × 250 mm) and the option to add Bambu Lab's AMS for multi-colour.",
        chooseB: "You mainly print carbon-fibre filled filament and want a printer built for it, with a top speed of 600 mm/s.",
    },
    {
        slug: "bambu-lab-a1-vs-elegoo-neptune-4-pro",
        a: { slug: "bambu-lab-a1-3d-printer--0c43", name: "Bambu Lab A1" },
        b: { slug: "elegoo-neptune-4-pro-3d-printer-b1k8", name: "ELEGOO Neptune 4 Pro" },
        intro: "Two open-frame printers with a moving bed at a similar price. The A1 is the easier to own; the Neptune 4 Pro is the more open to tinkering.",
        chooseA: "You want a printer that sets itself up, works with the AMS lite for multi-colour, and has the larger bed (256 × 256 mm).",
        chooseB: "You want to tinker: the Neptune 4 Pro runs Klipper firmware you can configure yourself, and prints taller parts (265 mm high).",
    },
    {
        slug: "elegoo-saturn-4-ultra-vs-anycubic-photon-mono-m7-pro",
        a: { slug: "elegoo-saturn-4-ultra-16k-3d-printer-fbe1", name: "ELEGOO Saturn 4 Ultra 16K" },
        b: { slug: "anycubic-photon-mono-m7-pro-resin-3d-printer-a0s2", name: "Anycubic Photon Mono M7 Pro" },
        intro: "Two 10-inch resin printers for detailed miniatures, jewellery models and dental work, at a similar price.",
        chooseA: "Detail matters most: its 16K screen has more pixels than the M7 Pro's 14K over a similar area.",
        chooseB: "You want a little more room: 223 × 126 × 230 mm against the Saturn 4 Ultra's 211.68 × 118.37 × 220 mm.",
    },
    {
        slug: "elegoo-mars-5-ultra-vs-anycubic-photon-mono-4",
        a: { slug: "elegoo-mars-5-ultra-3d-printer-a7bc", name: "ELEGOO Mars 5 Ultra" },
        b: { slug: "anycubic-photon-mono-4-resin-3d-printer-f16v", name: "Anycubic Photon Mono 4" },
        intro: "Two 7-inch resin printers, the usual first step into resin printing.",
        chooseA: "You want Wi-Fi printing and speed: the Mars 5 Ultra sends jobs over Wi-Fi and prints up to 150 mm an hour.",
        chooseB: "You want the lowest price into resin printing, and a 10K screen.",
    },
];

/**
 * @template {{ slug?: string, is_archived?: boolean, price: number | string }} P
 * @typedef {{ cmp: Comparison, a: P, b: P, path: string }} ResolvedComparison
 */

export const comparePath = (/** @type {Comparison} */ c) => `/compare/${c.slug}`;

/**
 * The comparisons whose two printers are both on sale, with their products.
 * @template {{ slug?: string, is_archived?: boolean, price: number | string }} P
 * @param {P[]} products
 * @returns {ResolvedComparison<P>[]}
 */
export function resolveComparisons(products) {
    const bySlug = new Map(products.filter((p) => p.slug && !p.is_archived && Number(p.price) > 0).map((p) => [p.slug, p]));
    return COMPARISONS.flatMap((cmp) => {
        const a = bySlug.get(cmp.a.slug);
        const b = bySlug.get(cmp.b.slug);
        return a && b ? [{ cmp, a, b, path: comparePath(cmp) }] : [];
    });
}

const inr = (/** @type {number | string} */ n) => `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;

/**
 * Title near 60 characters with both names, the words people search
 * ("a1 vs p1s price in india").
 * @param {Comparison} c
 */
export function compareTitle(c) {
    for (const t of [`${c.a.name} vs ${c.b.name}: Price in India & Specs`, `${c.a.name} vs ${c.b.name}: Price in India`, `${c.a.name} vs ${c.b.name}`]) {
        if (t.length <= 65) return t;
    }
    return plainText(`${c.a.name} vs ${c.b.name}`, 65);
}

/** @param {ResolvedComparison<{ price: number | string }>} r */
export const compareDescription = ({ cmp, a, b }) =>
    plainText(`${cmp.a.name} at ${inr(a.price)} or ${cmp.b.name} at ${inr(b.price)}? Specs side by side and which to buy. GST included, free shipping across India.`, 160);

export const COMPARE_CRUMBS = [{ name: "3D printers", path: "/printers" }, { name: "Compare 3D printers", path: "/compare" }];

/** @param {ResolvedComparison<{ slug?: string, id: string, name: string }>} r */
export const compareLd = ({ cmp, a, b, path }) => [
    breadcrumbLd([...COMPARE_CRUMBS, { name: `${cmp.a.name} vs ${cmp.b.name}`, path }]),
    {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: `${cmp.a.name} vs ${cmp.b.name}`,
        numberOfItems: 2,
        itemListElement: [a, b].map((p, i) => ({ "@type": "ListItem", position: i + 1, url: productUrl(p), name: plainText(p.name, 200) })),
    },
];

export const COMPARE_HUB = {
    path: "/compare",
    title: `Compare 3D Printers: Prices in India Side by Side | ${SITE_NAME}`,
    description: "Bambu Lab, ELEGOO, Creality and Anycubic printers compared side by side: price in India, build volume, speed, materials and which one to buy.",
    h1: "Compare 3D printers",
    intro: "Printers people often choose between, side by side: price with GST, build volume, speed, materials, and when each one is the better buy.",
};

export const compareHubLd = () => [breadcrumbLd(COMPARE_CRUMBS)];

// --- Use cases -----------------------------------------------------------------

/**
 * @typedef {{
 *   slug: string, title: string, description: string, h1: string, name: string, intro: string,
 *   sections: { heading: string, body: string[] }[],
 *   materials: { material: string, use: string }[],
 *   example: { label: string, cm3: number },
 *   faq: { q: string, a: string }[],
 * }} UseCase
 */

const ordering = {
    q: "Do I need an account to get a quote?",
    a: "No. On the quote page, give an email address and a WhatsApp number, upload your file and see the price straight away. Our team checks the file and emails you a payment link.",
};
const files = {
    q: "Which files can I send?",
    a: "An STL or OBJ file up to 200 MB, one model per request. Most CAD programs export STL; export in millimetres and check the size the quote page shows.",
};
const timing = {
    q: "How long does it take?",
    a: `We confirm the production time with your payment link. After dispatch, delivery takes ${FACTS.deliveryMetroDays} working days to metro cities and ${FACTS.deliveryRestDays} to the rest of India.`,
};

/** @type {UseCase[]} */
export const USE_CASES = [
    {
        slug: "prototypes",
        name: "Prototypes",
        title: `3D Printing for Prototypes in India: Instant Quote | ${SITE_NAME}`,
        description: "3D print a product prototype from your STL in PLA, PETG or ABS. Instant price online, printed in Indore and delivered across India.",
        h1: "3D printed prototypes",
        intro: "Hold your design before you pay for tooling. Upload an STL or OBJ, see the price straight away, and get a printed part to check fit, size and feel.",
        sections: [
            {
                heading: "What a printed prototype is for",
                body: [
                    "Checking that a part fits the parts around it, before a mould or a machining order.",
                    "Showing a client or an investor the real size and shape of a product.",
                    "Testing a clip, hinge or enclosure, then changing the CAD model and printing the next version.",
                ],
            },
            {
                heading: "Before you upload",
                body: [
                    "Make walls at least 1.2 mm thick, and 2 mm or more where the part takes load.",
                    "Leave 0.2 to 0.3 mm of clearance between parts that have to fit together; printed holes come out slightly small.",
                    "Overhangs steeper than about 45° need supports, which leave a rougher surface where they touch the part.",
                ],
            },
        ],
        materials: [
            { material: "PLA", use: "Looks and fit checks. Stiff and accurate, but it softens at about 55–60 °C." },
            { material: "PETG", use: "Working prototypes: tougher and slightly flexible, so clips and snap-fits survive being used." },
            { material: "ABS", use: "Parts that get warm, near motors, electronics or in a car." },
        ],
        example: { label: "an enclosure part of 40 cm³", cm3: 40 },
        faq: [ordering, files, timing],
    },
    {
        slug: "replacement-parts",
        name: "Replacement parts",
        title: `3D Printed Replacement Parts in India | ${SITE_NAME}`,
        description: "Broken knob, clip or bracket? Send its STL and we 3D print a replacement in PETG, ABS or PLA. Instant price, delivered across India.",
        h1: "3D printed replacement parts",
        intro: "A broken knob, clip, bracket or cover is often not sold on its own. If you have a 3D model of it, we can print a new one.",
        sections: [
            {
                heading: "Getting a model of the part",
                body: [
                    "Search Printables or Thingiverse for your appliance's model number with the part's name: many common parts are already modelled.",
                    "Or measure the broken part with a vernier caliper and draw it in free CAD software such as Tinkercad, FreeCAD or Fusion (free for personal use), then export STL.",
                ],
            },
            {
                heading: "What not to print",
                body: [
                    "Do not replace parts that keep someone safe: brakes, gas fittings, child-safety parts, or anything holding up a load that could fall on someone.",
                    "We do not describe our prints as food-safe, so do not use them for parts that touch food or drinking water.",
                ],
            },
        ],
        materials: [
            { material: "PETG", use: "Most replacement parts: tough, a little flexible and fine with water and daily handling." },
            { material: "ABS", use: "Parts near heat: inside appliances, near lamps or in a car parked in the sun." },
            { material: "PLA", use: "Indoor parts that see little heat or force, such as covers, caps and organisers." },
        ],
        example: { label: "a knob or clip of 10 cm³", cm3: 10 },
        faq: [files, ordering, timing],
    },
    {
        slug: "architectural-models",
        name: "Architectural models",
        title: `3D Printed Architectural Models in India | ${SITE_NAME}`,
        description: "3D print architectural and scale models from your STL. Fine 0.1 mm layers in white or grey PLA, priced online, delivered across India.",
        h1: "3D printed architectural models",
        intro: "Turn a building or site model into a physical model for a jury, a client meeting or a sales office. Upload the STL and see the price before you commit.",
        sections: [
            {
                heading: "Preparing the model",
                body: [
                    "Export STL from your modelling software (SketchUp, Rhino, Blender, or Revit through an STL exporter add-in) in millimetres, at the printed size.",
                    "At small scales walls and railings get very thin; thicken anything under 1.2 mm in the model or it may not print.",
                    "Large sites print better split into tiles that are glued together after printing. Send each tile as its own request.",
                ],
            },
            {
                heading: "Settings that suit models",
                body: [
                    "Choose 0.1 mm High Detail on the quote page for fine facades; 0.2 mm is fine for massing models and costs less.",
                    "A low infill keeps the price down: a model only has to hold its shape.",
                ],
            },
        ],
        materials: [
            { material: "PLA", use: "The usual choice: white or grey, crisp edges, and paints well." },
        ],
        example: { label: "a 60 cm³ massing model", cm3: 60 },
        faq: [files, ordering, timing],
    },
    {
        slug: "student-projects",
        name: "Student projects",
        title: `3D Printing for Student Projects in India | ${SITE_NAME}`,
        description: "3D printing for engineering and design students: robot parts, enclosures, mounts and models. Instant price online, delivered across India.",
        h1: "3D printing for student projects",
        intro: "Final-year projects, robotics competitions and design submissions: upload your STL, see the price, and get the part delivered to your college or home.",
        sections: [
            {
                heading: "What students print with us",
                body: [
                    "Robot chassis, brackets, sensor mounts and gripper parts.",
                    "Enclosures for Arduino, ESP32 and Raspberry Pi projects.",
                    "Display models and mechanisms for design and architecture submissions.",
                ],
            },
            {
                heading: "Keeping the cost down",
                body: [
                    "The price follows the model's volume, so hollow out or slim down parts that do not carry load.",
                    "Keep the quote page's default 20% infill unless a part takes real force.",
                    "For M3 screws, draw holes about 3.3 mm wide so the screw goes in without drilling.",
                ],
            },
        ],
        materials: [
            { material: "PLA", use: "Models, display pieces and most enclosures." },
            { material: "PETG", use: "Robot and drone parts that take knocks." },
            { material: "ABS", use: "Parts near motors and batteries that get warm." },
        ],
        example: { label: "a sensor mount of 15 cm³", cm3: 15 },
        faq: [ordering, files, timing],
    },
];

export const casePath = (/** @type {UseCase} */ u) => `/3d-printing/${u.slug}`;

/** @param {UseCase} u */
export const caseCrumbs = (u) => [{ name: "Custom 3D printing", path: "/custom" }, { name: u.name, path: casePath(u) }];

/** @param {UseCase} u */
export const caseLd = (u) => [
    breadcrumbLd(caseCrumbs(u)),
    {
        "@context": "https://schema.org",
        "@type": "Service",
        serviceType: "3D printing service",
        name: u.h1,
        description: u.description,
        provider: { "@id": `${SITE_URL}/#organization` },
        areaServed: { "@type": "Country", name: "India" },
        url: `${SITE_URL}${casePath(u)}`,
    },
];

export const USE_CASE_HUB = {
    path: "/3d-printing",
    title: `What We 3D Print: Prototypes, Parts & Models | ${SITE_NAME}`,
    description: "Custom 3D printing for prototypes, replacement parts, architectural models and student projects. Instant price online, delivered across India.",
    h1: "What people 3D print with us",
    intro: "Upload any STL or OBJ for an instant price. These guides cover the jobs we print most: which material to choose, how to prepare the file and what it costs.",
};

export const caseHubLd = () => [breadcrumbLd([{ name: "Custom 3D printing", path: "/custom" }, { name: "What we print", path: USE_CASE_HUB.path }])];

/** The use case's structured data with its questions. @param {UseCase} u */
export const casePageLd = (u) => [...caseLd(u), faqLd(u.faq, casePath(u))];
