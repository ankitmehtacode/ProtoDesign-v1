// @ts-check
/*
 * Single source of truth for search metadata. Read by the React app (Seo.tsx,
 * for client-side navigation) and by scripts/prerender.mjs (which writes a
 * static HTML file per route so crawlers that do not run JavaScript, and
 * Google's first pass before rendering, see the right title, description,
 * canonical URL, structured data and a text summary).
 *
 * Plain JS with JSDoc so Node can import it without a TypeScript step.
 *
 * Copy rules: every claim here must be true of the business today. Delivery
 * times, materials and file formats below come from the shipping policy and
 * the quote page; change them there and here together.
 */

export const SITE_URL = "https://www.protodesignstudio.com";
export const SITE_NAME = "ProtoDesign";
export const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`;

export const ORG = {
    legalName: "Zon Robotics and AI Pvt. Ltd.",
    email: "help@protodesignstudio.com",
    telephone: "+91-8249581682",
    address: {
        addressLocality: "Indore",
        addressRegion: "Madhya Pradesh",
        postalCode: "453331",
        addressCountry: "IN",
    },
    logo: `${SITE_URL}/apple-touch-icon.png`,
};

/**
 * @typedef {{ name: string, path: string }} Crumb
 * @typedef {{
 *   title: string,
 *   description: string,
 *   h1?: string,
 *   intro?: string,
 *   noindex?: boolean,
 *   crumbs?: Crumb[],
 *   service?: boolean,
 *   category?: string,
 * }} PageMeta
 */

/** @type {Record<string, PageMeta>} */
export const PAGES = {
    "/": {
        title: "3D Printing Service & 3D Printers in India | ProtoDesign",
        description:
            "Instant 3D printing quotes: upload STL, OBJ, 3MF or STEP, printed in PLA, PETG or ABS and delivered across India. Shop 3D printers and filament too.",
        h1: "3D printing service and 3D printers, delivered across India",
        intro: "Upload a model for an instant quote, or shop the printers, filament and resin we print with. Based in Indore, shipping across India: metro cities in 3–5 working days, the rest of India in 5–7.",
    },
    "/custom": {
        title: "Online 3D Printing Service in India: Instant Quote | ProtoDesign",
        description:
            "Get an instant price for custom 3D printing. Upload STL, OBJ, 3MF or STEP up to 200 MB, choose PLA, PETG or ABS, and we print and ship anywhere in India.",
        h1: "Custom 3D printing with an instant quote",
        intro: "Upload STL, OBJ, 3MF or STEP files up to 200 MB. Choose PLA, PETG or ABS and a colour, see the estimated weight, print time and price, then send the job. We print it and ship it anywhere in India.",
        crumbs: [{ name: "Custom 3D printing", path: "/custom" }],
        service: true,
    },
    "/shop": {
        title: "Buy 3D Printers, Filament & Resin Online in India | ProtoDesign",
        description:
            "Shop 3D printers, PLA and PETG filament, resin, accessories and spare parts online. Dispatched in 2–3 business days and delivered across India.",
        h1: "Everything we print with",
        intro: "3D printers, filament, resin, accessories and spare parts. In-stock orders are dispatched in 2–3 business days and delivered across India.",
        crumbs: [{ name: "Shop", path: "/shop" }],
    },
    "/printers": {
        title: "Buy 3D Printers Online in India: FDM, Resin & Metal | ProtoDesign",
        description:
            "Compare and buy FDM, resin (SLA) and metal 3D printers and 3D pens with prices in rupees. Delivered across India from Indore.",
        h1: "3D printers",
        intro: "FDM, resin and metal 3D printers, plus 3D pens, priced in rupees and delivered across India.",
        crumbs: [{ name: "Shop", path: "/shop" }, { name: "3D printers", path: "/printers" }],
        category: "3d_printer",
    },
    "/printables": {
        title: "3D Printed Products & Decor to Buy in India | ProtoDesign",
        description: "Ready-made 3D printed pieces, designed and printed by ProtoDesign and shipped across India.",
        h1: "3D printables",
        intro: "Finished 3D printed pieces, designed and printed by us.",
        crumbs: [{ name: "Shop", path: "/shop" }, { name: "3D printables", path: "/printables" }],
        category: "3dprintables",
    },
    "/filaments": {
        title: "3D Printer Filament Online in India: PLA, PETG, ABS | ProtoDesign",
        description: "Buy 3D printer filament online in India: PLA, PETG, ABS and engineering materials for FDM printers.",
        h1: "3D printer filament",
        intro: "Filament for FDM printers, delivered across India.",
        crumbs: [{ name: "Shop", path: "/shop" }, { name: "Filament", path: "/filaments" }],
        category: "filament",
    },
    "/resins": {
        title: "3D Printer Resin Online in India | ProtoDesign",
        description: "Buy photopolymer resin for SLA and DLP 3D printers online, delivered across India.",
        h1: "3D printer resin",
        intro: "Photopolymer resins for SLA and DLP printers.",
        crumbs: [{ name: "Shop", path: "/shop" }, { name: "Resin", path: "/resins" }],
        category: "resin",
    },
    "/accessories": {
        title: "3D Printer Accessories Online in India | ProtoDesign",
        description: "3D printer tools, upgrades and accessories, delivered across India.",
        h1: "3D printer accessories",
        intro: "Tools and upgrades for your printer.",
        crumbs: [{ name: "Shop", path: "/shop" }, { name: "Accessories", path: "/accessories" }],
        category: "accessory",
    },
    "/spare-parts": {
        title: "3D Printer Spare Parts Online in India | ProtoDesign",
        description: "Replacement and spare parts for 3D printer maintenance and repair, delivered across India.",
        h1: "3D printer spare parts",
        intro: "Replacement parts for maintenance and repair.",
        crumbs: [{ name: "Shop", path: "/shop" }, { name: "Spare parts", path: "/spare-parts" }],
        category: "spare_part",
    },
    "/contact": {
        title: "Contact ProtoDesign: 3D Printing in Indore, India",
        description: "Reach ProtoDesign by email at help@protodesignstudio.com or phone +91 8249581682. Based in Indore, Madhya Pradesh.",
        crumbs: [{ name: "Contact", path: "/contact" }],
    },
    "/shipping-policy": { title: "Shipping Policy | ProtoDesign", description: "Dispatch in 2–3 business days; delivery in 3–5 working days to metro cities and 5–7 to the rest of India." },
    "/return-policy": { title: "Return Policy | ProtoDesign", description: "Returns and exchanges within 7 days of purchase for eligible items." },
    "/refund-policy": { title: "Refund Policy | ProtoDesign", description: "How refunds work at ProtoDesign." },
    "/privacy-policy": { title: "Privacy Policy | ProtoDesign", description: "How ProtoDesign collects and uses your data." },
    "/terms-and-conditions": { title: "Terms and Conditions | ProtoDesign", description: "Terms for using protodesignstudio.com." },

    // Private or transactional: kept out of search results.
    "/auth": { title: "Sign in | ProtoDesign", description: "Sign in to ProtoDesign.", noindex: true },
    "/cart": { title: "Cart | ProtoDesign", description: "Your cart.", noindex: true },
    "/checkout": { title: "Checkout | ProtoDesign", description: "Checkout.", noindex: true },
    "/orders": { title: "Your orders | ProtoDesign", description: "Your orders.", noindex: true },
    "/profile": { title: "Your profile | ProtoDesign", description: "Your profile.", noindex: true },
    "/admin": { title: "Admin | ProtoDesign", description: "Admin.", noindex: true },
    "/bulk-upload": { title: "Bulk upload | ProtoDesign", description: "Admin bulk upload.", noindex: true },
    "/forgot-password": { title: "Reset password | ProtoDesign", description: "Reset your password.", noindex: true },
    "/reset-password": { title: "Reset password | ProtoDesign", description: "Reset your password.", noindex: true },
};

export const NOT_FOUND = { title: "Page not found | ProtoDesign", description: "This page does not exist.", noindex: true };

// --- Structured data (schema.org JSON-LD) ------------------------------------

export const organizationLd = () => ({
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: ORG.legalName,
    url: SITE_URL,
    logo: ORG.logo,
    email: ORG.email,
    telephone: ORG.telephone,
    address: { "@type": "PostalAddress", ...ORG.address },
    areaServed: { "@type": "Country", name: "India" },
});

export const websiteLd = () => ({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "en-IN",
    publisher: { "@id": `${SITE_URL}/#organization` },
});

/** @param {Crumb[]} crumbs */
export const breadcrumbLd = (crumbs) => ({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Home", path: "/" }, ...crumbs].map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.name,
        item: `${SITE_URL}${c.path}`,
    })),
});

export const quoteServiceLd = () => ({
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "3D printing service",
    name: "Custom 3D printing with instant quote",
    provider: { "@id": `${SITE_URL}/#organization` },
    areaServed: { "@type": "Country", name: "India" },
    url: `${SITE_URL}/custom`,
    description: PAGES["/custom"].description,
});

/**
 * @param {{ name: string, slug?: string, id: string, description?: string, short_description?: string,
 *           price: number | string, stock: number, image_url?: string | null, images?: string[], category?: string }} p
 * @param {string} categoryName
 * @param {string} categoryPath
 */
export const productLd = (p, categoryName, categoryPath) => {
    const url = productUrl(p);
    return [
        {
            "@context": "https://schema.org",
            "@type": "Product",
            name: plainText(p.name, 200),
            url,
            description: plainText(p.short_description || p.description || p.name, 5000),
            image: p.images?.length ? p.images : p.image_url ? [p.image_url] : undefined,
            sku: p.id,
            category: categoryName,
            // No aggregateRating: rating markup is only allowed for genuine reviews,
            // and review_count can include seeded placeholder reviews.
            offers: {
                "@type": "Offer",
                url,
                priceCurrency: "INR",
                price: Number(p.price).toFixed(2),
                availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                itemCondition: "https://schema.org/NewCondition",
                seller: { "@id": `${SITE_URL}/#organization` },
                shippingDetails: {
                    "@type": "OfferShippingDetails",
                    shippingDestination: { "@type": "DefinedRegion", addressCountry: "IN" },
                    deliveryTime: {
                        "@type": "ShippingDeliveryTime",
                        handlingTime: { "@type": "QuantitativeValue", minValue: 2, maxValue: 3, unitCode: "DAY" },
                        transitTime: { "@type": "QuantitativeValue", minValue: 3, maxValue: 10, unitCode: "DAY" },
                    },
                },
                hasMerchantReturnPolicy: {
                    "@type": "MerchantReturnPolicy",
                    applicableCountry: "IN",
                    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
                    merchantReturnDays: 7,
                    merchantReturnLink: `${SITE_URL}/return-policy`,
                },
            },
        },
        breadcrumbLd([{ name: "Shop", path: "/shop" }, { name: categoryName, path: categoryPath }, { name: plainText(p.name, 200), path: new URL(url).pathname }]),
    ];
};

// --- Helpers ------------------------------------------------------------------

/** @param {{ slug?: string, id: string }} p */
export const productUrl = (p) => `${SITE_URL}/product/${encodeURIComponent(p.slug || p.id)}`;

/** Category key -> [human name, listing path]. */
export const CATEGORY_PAGES = Object.fromEntries(
    Object.entries(PAGES)
        .filter(([, m]) => m.category)
        .map(([path, m]) => [/** @type {string} */ (m.category), [/** @type {string} */ (m.h1), path]]),
);

/** Strip markup and collapse whitespace, then trim to a word boundary. */
export function plainText(s = "", max = 160) {
    const t = String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

/** Product title for search: name, category hint and region, kept near 60 chars. */
export const productTitle = (/** @type {string} */ rawName, /** @type {string} */ _categoryName) => {
    const name = plainText(rawName, 200);
    for (const candidate of [`${name}: Buy Online in India | ${SITE_NAME}`, `${name} | Buy in India | ${SITE_NAME}`, `${name} | ${SITE_NAME}`]) {
        if (candidate.length <= 65) return candidate;
    }
    return `${plainText(name, 50)} | ${SITE_NAME}`;
};

export const productDescription = (/** @type {{ name: string, price: number | string, short_description?: string, description?: string }} */ p) => {
    const price = `₹${Math.round(Number(p.price)).toLocaleString("en-IN")}`;
    const body = plainText(p.short_description || p.description || "", 110);
    return plainText(`${plainText(p.name, 200)} at ${price}. ${body} Delivered across India.`, 160);
};
