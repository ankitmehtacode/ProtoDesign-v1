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

import { ORG, SITE_NAME, SITE_URL } from "./site.js";

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
        a: "In-stock items are dispatched within 2–3 business days. Delivery then takes 3–5 working days to metro cities, 5–7 to the rest of India and 7–10 to remote areas and the North East. Custom prints need extra production time, which we confirm when we send the payment link.",
    },
    {
        q: "How much is shipping?",
        a: "₹199 per order when you pay online, or ₹300 with cash on delivery. Any order that includes a 3D printer ships free.",
    },
    {
        q: "Do prices include GST?",
        a: "Yes. Product prices include 18% GST; shipping is added at checkout.",
    },
    {
        q: "How can I pay?",
        a: "Online through PhonePe, or cash on delivery for orders under ₹999 that do not include a 3D printer.",
    },
    {
        q: "Can I return an item?",
        a: "Yes, if it arrives defective, damaged in transit or different from its description, reported within 7 days of delivery with photos. We replace it or refund you. Custom prints are made to your file, so they can only be returned if they arrive broken or differ significantly from the file.",
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

export const faqLd = () => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/custom#faq`,
    mainEntity: FAQ.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
    })),
});
