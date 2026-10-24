// @ts-check
/*
 * Questions customers (and AI assistants answering for them) ask about
 * ProtoDesign. One source for the FAQ shown on /custom, its prerendered HTML,
 * the FAQPage structured data and /llms.txt, so they can never disagree.
 *
 * Every answer must be true today. Where each fact comes from:
 *  - files, materials, colours: src/pages/CustomPrinting.tsx (dropzone, MATERIALS)
 *  - 200 MB: MAX_STL_BYTES in backend/src/services/storage.service.js
 *  - shipping, COD, GST: backend/src/services/order.service.js
 *  - delivery times: ShippingPage; returns: ReturnPage (src/pages/Legal.tsx)
 * Change the source and this file together.
 */

import { ORG, SITE_NAME, SITE_URL, saleLastDay, specLookup } from "./site.js";

/** Numbers quoted by the FAQ and the home page. */
export const FACTS = {
    shippingOnlineInr: 199,
    shippingCodInr: 300,
    codLimitInr: 999,
    dispatchDays: "2–3",
    deliveryMetroDays: "3–5",
    deliveryRestDays: "5–7",
    deliveryRemoteDays: "7–10",
    returnWindowDays: 7,
};

/** @type {{ q: string, a: string }[]} */
export const FAQ = [
    {
        q: "What files can I upload for a 3D printing quote?",
        a: "An STL or OBJ file, up to 200 MB, one model per request. The quote page shows the model in 3D with its size, estimated weight, print time and price as you change the settings.",
    },
    {
        q: "Which materials and colours can I choose?",
        a: "PLA in black, white, grey, yellow or green; PETG in translucent or black; and ABS in black, white, grey, red or blue. You can also choose the layer height (0.1 mm to 0.2 mm) and infill.",
    },
    {
        q: "How is the price of a custom 3D print worked out?",
        a: "The quote page calculates it live from your model's volume, the material, the layer height and the infill, plus a ₹150 setup fee. After you send the request, our team checks the file and emails you a payment link.",
    },
    {
        q: "How long does delivery take?",
        a: `In-stock items are dispatched within ${FACTS.dispatchDays} business days. Delivery then takes ${FACTS.deliveryMetroDays} working days to metro cities, ${FACTS.deliveryRestDays} to the rest of India and ${FACTS.deliveryRemoteDays} to remote areas and the North East. Custom prints need extra production time, which we confirm when we send the payment link.`,
    },
    {
        q: "How much is shipping?",
        a: `₹${FACTS.shippingOnlineInr} per order when you pay online, or ₹${FACTS.shippingCodInr} with cash on delivery. Any order that includes a 3D printer ships free.`,
    },
    {
        q: "Do prices include GST?",
        a: "Yes. Product prices include 18% GST; shipping is added at checkout.",
    },
    {
        q: "How can I pay?",
        a: `Online through PhonePe, or cash on delivery for orders under ₹${FACTS.codLimitInr} that do not include a 3D printer.`,
    },
    {
        q: "Can I return an item?",
        a: `Yes, if it arrives defective, damaged in transit or different from its description, reported within ${FACTS.returnWindowDays} days of delivery with photos. We replace it or refund you. Custom prints are made to your file, so they can only be returned if they arrive broken or differ significantly from the file.`,
    },
    {
        q: "Where is ProtoDesign based, and do you ship across India?",
        a: `We print in ${ORG.address.addressLocality}, ${ORG.address.addressRegion}, and ship to every pin code in India that our courier partners serve.`,
    },
    {
        q: "Who operates ProtoDesign?",
        a: `${SITE_NAME} is a brand of ${ORG.legalName} (CIN ${ORG.cin}, GSTIN ${ORG.gstin}), registered at ${ORG.address.streetAddress}, ${ORG.address.addressLocality}, ${ORG.address.addressRegion} ${ORG.address.postalCode}. Contact: ${ORG.email} or ${ORG.telephone}.`,
    },
];

// Price bands people search by ("3d printer under 30000").
const PRICE_BANDS = /** @type {const} */ ([
    [0, 30000, "under ₹30,000"],
    [30000, 60000, "₹30,000 to ₹60,000"],
    [60000, 150000, "₹60,000 to ₹1.5 lakh"],
    [150000, Infinity, "above ₹1.5 lakh"],
]);

const inr = (/** @type {number | string} */ n) => `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;

/**
 * Questions about 3D printer prices in India, answered from the catalogue as
 * it is, so every name and number is one a customer can buy at. Shown on
 * /printers and in its prerendered HTML and FAQPage data. Empty when there
 * are too few printers to compare.
 *
 * Prices are the ones customers pay (festival prices during a sale). The
 * category also holds scanners, engravers and wash stations, so a printer is
 * a product whose name says printer, the same rule as the home page's deals.
 * @param {{ name: string, price: number | string, stock: number, category?: string, sub_category?: string | null,
 *           specifications?: unknown, is_archived?: boolean, festival?: { name: string, ends_at: string, gift?: { label: string } } | null }[]} products
 * @returns {{ q: string, a: string }[]}
 */
export function printerPriceFaq(products) {
    const printers = products
        .filter((p) => p.category === "3d_printer" && !p.is_archived && p.stock > 0 && Number(p.price) > 0 && /\bprinter\b/i.test(p.name))
        .sort((a, b) => Number(a.price) - Number(b.price));
    if (printers.length < 2) return [];
    const name = (/** @type {{ name: string }} */ p) => p.name.replace(/\s+/g, " ").trim();
    const cheapest = printers[0];
    const dearest = printers[printers.length - 1];
    const bands = PRICE_BANDS
        .map(([min, max, label]) => [printers.filter((p) => Number(p.price) >= min && Number(p.price) < max).length, label])
        .filter(([n]) => n > 0)
        .map(([n, label]) => `${n} ${label}`);
    // Resin by its sub-category or Technology spec (mSLA, LCD...), else its name:
    // "ELEGOO Mars 5 Ultra 3D Printer" never says resin.
    const isResin = (/** @type {typeof printers[number]} */ p) =>
        /\b(resin|m?sla|lcd|dlp)\b/i.test(`${p.sub_category ?? ""} ${specLookup(p.specifications, ["technology", "print technology"]) ?? ""} ${p.name}`);
    const resin = printers.find(isResin);
    const fdm = printers.find((p) => !isResin(p));
    const budget = printers.filter((p) => Number(p.price) < 30000);
    const onSale = printers.filter((p) => p.festival);

    /** @type {{ q: string, a: string }[]} */
    const faq = [
        {
            q: "How much does a 3D printer cost in India?",
            a: `The ${printers.length} 3D printers in stock here cost from ${inr(cheapest.price)} (${name(cheapest)}) to ${inr(dearest.price)} (${name(dearest)}). By price: ${bands.join(", ")}. Prices include 18% GST, and every printer ships free across India.`,
        },
        {
            q: "What is the cheapest 3D printer you sell?",
            a: [
                fdm && `The cheapest filament (FDM) printer is the ${name(fdm)} at ${inr(fdm.price)}.`,
                resin && `The cheapest resin printer is the ${name(resin)} at ${inr(resin.price)}.`,
            ].filter(Boolean).join(" "),
        },
    ];
    if (budget.length) {
        faq.push({
            q: "Which 3D printers cost under ₹30,000?",
            a: `${budget.slice(0, 6).map((p) => `${name(p)} (${inr(p.price)})`).join(", ")}${budget.length > 6 ? `, and ${budget.length - 6} more` : ""}.`,
        });
    }
    if (onSale.length) {
        const sale = /** @type {NonNullable<typeof onSale[number]["festival"]>} */ (onSale[0].festival);
        const gift = sale.gift ? ` with a ${sale.gift.label.replace(/^Free /, "free ")} while stocks last` : "";
        faq.push({
            q: "Which 3D printers are on sale?",
            a: onSale.length === 1
                ? `The ${name(onSale[0])} is in our ${sale.name} until ${saleLastDay(sale.ends_at)} at ${inr(onSale[0].price)}${gift ? `,${gift}` : ""}.`
                : `${onSale.length} printers in stock are in our ${sale.name} until ${saleLastDay(sale.ends_at)}, from ${inr(onSale[0].price)} (${name(onSale[0])})${gift ? `, each${gift}` : ""}.`,
        });
    }
    faq.push({
        q: "Do 3D printer prices include GST and shipping?",
        a: `Yes. Every price includes 18% GST, and any order with a 3D printer ships free. Printers in stock are dispatched within ${FACTS.dispatchDays} business days and reach metro cities in ${FACTS.deliveryMetroDays} working days, the rest of India in ${FACTS.deliveryRestDays}.`,
    });
    return faq;
}

/**
 * FAQPage data for a page's questions. Defaults to the /custom FAQ.
 * @param {{ q: string, a: string }[]} [entries]
 * @param {string} [path]
 */
export const faqLd = (entries = FAQ, path = "/custom") => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}${path}#faq`,
    mainEntity: entries.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
    })),
});
