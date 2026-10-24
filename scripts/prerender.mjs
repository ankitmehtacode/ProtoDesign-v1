// Build-time prerendering of search metadata and a crawlable text summary.
//
// Runs after `vite build`. For every route in src/seo/site.js and every live
// product, writes dist/<route>.html with that page's title, description,
// canonical URL, Open Graph tags, JSON-LD and a short HTML summary inside
// #root. React replaces the summary when it mounts; crawlers that do not run
// JavaScript (link previews, most AI crawlers, Google's first pass) read it.
//
// vercel.json serves these with cleanUrls; anything else falls to 404.html.
//
//   node scripts/prerender.mjs            (API from VITE_API_URL)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServer } from "vite";
import { FAQ, faqLd, printerPriceFaq } from "../src/seo/faq.js";
import {
    CATEGORY_PAGES, DEFAULT_IMAGE, NOT_FOUND, ORG, PAGES, SITE_NAME, SITE_URL,
    PRINTER_CATEGORY, breadcrumbLd, comparableSpecs, festivalRegularPrice, itemListLd, organizationLd,
    plainText, productBrand, productDescription, productLd, productTitle, productUrl, quoteServiceLd,
    istDay, saleLastDay, specMap, websiteLd,
} from "../src/seo/site.js";

const DIST = new URL("../dist/", import.meta.url).pathname;
const API = (process.env.VITE_API_URL || "").replace(/\/$/, "");

const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// JSON-LD must not be able to close its own <script> tag.
const ldTag = (obj) => `<script data-rh="true" type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

function head({ title, description, canonical, image = DEFAULT_IMAGE, type = "website", noindex = false, ld = [] }) {
    return [
        `<title>${esc(title)}</title>`,
        `<meta data-rh="true" name="description" content="${esc(description)}" />`,
        noindex
            ? `<meta data-rh="true" name="robots" content="noindex, follow" />`
            : canonical ? `<link data-rh="true" rel="canonical" href="${esc(canonical)}" />` : "",
        `<meta data-rh="true" property="og:title" content="${esc(title)}" />`,
        `<meta data-rh="true" property="og:description" content="${esc(description)}" />`,
        canonical ? `<meta data-rh="true" property="og:url" content="${esc(canonical)}" />` : "",
        `<meta data-rh="true" property="og:image" content="${esc(image)}" />`,
        `<meta data-rh="true" property="og:type" content="${type}" />`,
        `<meta data-rh="true" name="twitter:title" content="${esc(title)}" />`,
        `<meta data-rh="true" name="twitter:description" content="${esc(description)}" />`,
        `<meta data-rh="true" name="twitter:image" content="${esc(image)}" />`,
        ...ld.map(ldTag),
    ].filter(Boolean).join("\n    ");
}

// Classes below all exist elsewhere in src, so Tailwind keeps them in the CSS.
const shell = (inner) => `<main class="container mx-auto px-4 pb-16 pt-28">${inner}</main>`;
const nav = () => {
    const links = [["/", "Home"], ["/custom", "Custom 3D printing"], ["/shop", "Shop"],
        ...Object.values(CATEGORY_PAGES).map(([name, path]) => [path, name])];
    return `<nav aria-label="Site"><ul class="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">${links
        .map(([href, label]) => `<li><a href="${href}">${esc(label)}</a></li>`).join("")}</ul></nav>`;
};
// Same rule as the home page's deals: the product name is the reliable signal.
const IS_PRINTER = /\bprinter\b/i;
const inr = (n) => `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;

function pageBody(meta, products = [], extra = "") {
    if (!meta.h1) return "";
    const list = products.length
        ? `<ul class="mt-8 space-y-2">${products
            .map((p) => `<li><a href="${new URL(productUrl(p)).pathname}">${esc(plainText(p.name, 200))}</a>: ${esc(priceText(p))}${p.stock > 0 ? "" : " (sold out)"}</li>`)
            .join("")}</ul>`
        : "";
    return shell(`${nav()}<h1 class="mt-8 font-display text-3xl font-bold">${esc(meta.heading ?? meta.h1)}</h1><p class="mt-3 max-w-xl text-muted-foreground">${esc(meta.intro ?? meta.description)}</p>${list}${extra}`);
}

/** "₹37,144 (Navratri Sale until 20 Oct; regular price ₹39,099)", or the plain price. */
function priceText(p) {
    const regular = festivalRegularPrice(p);
    return regular ? `${inr(p.price)} (${p.festival.name} until ${saleLastDay(p.festival.ends_at)}; regular price ${inr(regular)})` : inr(p.price);
}

const stockText = (p) => p.stock <= 0 ? "Sold out" : specMap(p.specifications).Fulfilment === "Made to order" ? "Made to order" : "In stock";

// Keys the product page hides from its spec list (ProductDetail.tsx).
const HIDDEN_SPECS = new Set(["allow_cod_override"]);

/** Every specification, exactly as the product page's spec list shows it. */
const allSpecs = (specs) => Object.entries(specMap(specs)).filter(([k, v]) => k && v && !HIDDEN_SPECS.has(k));

/**
 * The product page's "You may also like": up to 10 others from the category,
 * in the API's order, as links.
 */
function relatedLinks(p) {
    const related = products.filter((o) => o.category === p.category && o.id !== p.id).slice(0, 10);
    return related.length
        ? `<h2 class="mt-8 text-xl font-bold">You may also like</h2><ul class="mt-3 space-y-1 text-sm">${related
            .map((o) => `<li><a href="${new URL(productUrl(o)).pathname}">${esc(plainText(o.name, 200))}</a>: ${esc(inr(o.price))}</li>`)
            .join("")}</ul>`
        : "";
}

function productBody(p, categoryName, categoryPath) {
    const desc = plainText(p.description || p.short_description || "", 1200);
    const printer = p.category === PRINTER_CATEGORY;
    const specs = allSpecs(p.specifications);
    return shell(`${nav()}<p class="mt-8 text-sm text-muted-foreground"><a href="${categoryPath}">${esc(categoryName)}</a></p>` +
        `<h1 class="mt-2 font-display text-3xl font-bold">${esc(plainText(p.name, 200))}</h1>` +
        `<p class="mt-3 text-lg">${esc(priceText(p))} · GST included · ${stockText(p)} · ${printer ? "Free shipping across India" : "Delivered across India"}</p>` +
        (specs.length ? `<ul class="mt-4 space-y-1 text-sm">${specs.map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("")}</ul>` : "") +
        (desc ? `<p class="mt-4 max-w-xl text-muted-foreground">${esc(desc)}</p>` : "") +
        relatedLinks(p));
}

function render(template, headHtml, bodyHtml) {
    const [before, rest] = template.split("<!--seo:start-->");
    const [, after] = rest.split("<!--seo:end-->");
    if (after === undefined) throw new Error("index.html is missing the <!--seo:start/end--> markers");
    // data-prerender hides the summary from people while the app loads (rule in index.html).
    const body = bodyHtml ? `<div data-prerender>${bodyHtml}</div>` : "";
    return `${before}${headHtml}${after}`.replace("<!--seo:body-->", body);
}

async function write(route, html) {
    const file = route === "/" ? join(DIST, "index.html") : join(DIST, `${route.replace(/^\//, "")}.html`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
}

async function fetchProducts() {
    if (!API) {
        console.warn("[prerender] VITE_API_URL is not set: product pages will be client-rendered only.");
        return [];
    }
    const res = await fetch(`${API}/products`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`GET ${API}/products -> ${res.status}`);
    const body = await res.json();
    const list = Array.isArray(body) ? body : body.data ?? [];
    return list
        .filter((p) => !p.is_archived)
        .map((p) => ({
            ...p,
            images: [...(p.product_images ?? [])]
                .sort((a, b) => a.display_order - b.display_order)
                .map((i) => i.image_url)
                .filter((u) => typeof u === "string" && u.startsWith("http")),
        }));
}

/** The running and next festival sale, from the schedule checkout charges by. */
async function fetchFestival() {
    if (!API) return null;
    const res = await fetch(`${API}/festival`, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) return null; // a backend without the festival schedule
    if (!res.ok) throw new Error(`GET ${API}/festival -> ${res.status}`);
    return res.json();
}

const template = await readFile(join(DIST, "index.html"), "utf8");

// Renders real app components (legal pages, FAQ) to HTML at build time, so the
// static page matches what visitors see. Vite compiles the TSX and resolves "@/".
const ROOT = new URL("../", import.meta.url).pathname;
const vite = await createServer({ root: ROOT, appType: "custom", logLevel: "error", server: { middlewareMode: true, hmr: false } });
const { renderPage, renderFaq } = await vite.ssrLoadModule("/src/seo/ssr.tsx");

let products = [];
let festival = null;
try {
    festival = await fetchFestival();
} catch (error) {
    // llms.txt then just omits the sale schedule; prices still come from /products.
    console.error(`[prerender] festival schedule unavailable: ${error.message}`);
}
try {
    products = await fetchProducts();
} catch (error) {
    // A catalogue outage should not block a deploy: product pages still work
    // client-side. Loud in the build log so it is not missed.
    console.error(`[prerender] products unavailable, skipping product pages: ${error.message}`);
}

let count = 0;
for (const [route, meta] of Object.entries(PAGES)) {
    const ld = [];
    if (!meta.noindex) {
        if (route === "/") ld.push(organizationLd(), websiteLd());
        if (meta.crumbs) ld.push(breadcrumbLd(meta.crumbs));
        if (meta.service) ld.push(quoteServiceLd(), faqLd());
    }
    const inCategory = meta.category ? products.filter((p) => p.category === meta.category)
        : route === "/shop" ? products : [];
    if (!meta.noindex && meta.category && inCategory.length) ld.push(itemListLd(inCategory));
    // The printer price questions /printers shows under its grid (CategoryPage.tsx).
    const priceFaq = meta.category === PRINTER_CATEGORY ? printerPriceFaq(inCategory) : [];
    if (!meta.noindex && priceFaq.length) ld.push(faqLd(priceFaq, route));
    const extra = route === "/custom" ? renderFaq()
        : priceFaq.length ? renderFaq(route, { items: priceFaq, heading: "3D printer prices in India: common questions" }) : "";
    await write(route, render(template,
        head({ title: meta.title, description: meta.description, canonical: `${SITE_URL}${route}`, noindex: meta.noindex, ld }),
        meta.noindex ? "" : renderedBody(route) ?? pageBody(meta, inCategory, extra)));
    count++;
}

for (const p of products) {
    const [categoryName, categoryPath] = CATEGORY_PAGES[p.category] ?? ["Shop", "/shop"];
    const url = productUrl(p);
    await write(new URL(url).pathname, render(template,
        head({
            title: productTitle(p.name, categoryName, p),
            description: productDescription(p),
            canonical: url,
            image: p.images[0] ?? p.image_url ?? DEFAULT_IMAGE,
            type: "product",
            ld: productLd(p, categoryName, categoryPath),
        }),
        productBody(p, categoryName, categoryPath)));
    count++;
}

// Fallback for products added since the last build: neutral tags, the app fills them in.
await write("/_app", render(template, head({ title: SITE_NAME, description: PAGES["/"].description, canonical: "" }), ""));
await write("/404", render(template, head({ ...NOT_FOUND, canonical: "" }), ""));

await writeFile(join(DIST, "llms.txt"), llmsTxt(products, festival));
await vite.close();

console.log(`[prerender] wrote ${count} pages (${products.length} products) + _app.html, 404.html, llms.txt`);

/** A route's real component, rendered, under the site nav; null when it has none. */
function renderedBody(route) {
    const html = renderPage(route);
    return html === null ? null : `<div class="container mx-auto px-4 pt-28">${nav()}</div>${html}`;
}

/**
 * /llms.txt (llmstxt.org): a plain-Markdown brief for AI assistants and agents,
 * built from the same data as the pages so it never goes stale.
 */
function llmsTxt(list, festival) {
    const a = ORG.address;
    const md = (s) => String(s).replace(/\s+/g, " ").trim();
    const indexable = Object.entries(PAGES).filter(([, m]) => !m.noindex);
    // Printers cheapest first with brand and key specs: the shape of a price comparison.
    const printerLine = (p) => {
        const facts = [productBrand(p), ...comparableSpecs(p.specifications).filter(([k]) => k === "Technology" || k === "Build volume").map(([k, v]) => `${k.toLowerCase()} ${v}`)]
            .filter(Boolean).join(", ");
        return `- [${md(plainText(p.name, 120))}](${productUrl(p)}): ${priceText(p)}, GST included, free shipping. ${stockText(p)}.${facts ? ` ${md(facts)}.` : ""}`;
    };
    const byCategory = Object.entries(CATEGORY_PAGES).map(([key, [name, path]]) => {
        const items = list.filter((p) => p.category === key);
        if (!items.length) return [];
        if (key === PRINTER_CATEGORY) {
            // The category also holds scanners, engravers and wash stations; listing
            // them among the printers would make them read as the cheapest printers.
            const cheapestFirst = [...items].sort((x, y) => Number(x.price) - Number(y.price));
            const printers = cheapestFirst.filter((p) => IS_PRINTER.test(p.name));
            const others = cheapestFirst.filter((p) => !IS_PRINTER.test(p.name));
            return [`### ${name} (${SITE_URL}${path})`, ...printers.map(printerLine), "",
                ...(others.length ? ["### Scanners, laser engravers and resin wash & cure stations (also ship free)", ...others.map(printerLine), ""] : [])];
        }
        return [`### ${name} (${SITE_URL}${path})`, ...items.map((p) => `- [${md(plainText(p.name, 120))}](${productUrl(p)}): ${priceText(p)}, GST included`), ""];
    }).flat();
    const sales = [festival?.active, festival?.next].filter(Boolean).map((s) =>
        `- ${s.name}: ${s.percent_off === null ? s.headline : `${s.percent_off}% off every 3D printer`}, ${istDay(s.starts_at)} to ${saleLastDay(s.ends_at)} (IST).`);
    return [
        `# ${SITE_NAME}`,
        "",
        `> ${md(ORG.description)}`,
        "",
        `- Operator: ${ORG.legalName}, CIN ${ORG.cin}, GSTIN ${ORG.gstin}`,
        `- Address: ${a.streetAddress}, ${a.addressLocality}, ${a.addressRegion} ${a.postalCode}, India`,
        `- Contact: ${ORG.email}, ${ORG.telephone}`,
        `- Grievance officer: ${ORG.grievanceOfficer}, ${ORG.telephone}, ${ORG.email}`,
        `- Social: ${ORG.sameAs.join(", ")}`,
        "",
        "## Pages",
        ...indexable.map(([path, m]) => `- [${md(m.h1 ?? m.title)}](${SITE_URL}${path === "/" ? "/" : path}): ${md(m.description)}`),
        "",
        "## Buying a 3D printer from ProtoDesign",
        "- Listed prices include 18% GST. A GST invoice is issued by " + ORG.legalName + ` (GSTIN ${ORG.gstin}).`,
        "- Every order containing a 3D printer ships free anywhere in India. Other orders pay ₹199 shipping.",
        "- Payment online through PhonePe. Cash on delivery is not available for orders containing a 3D printer.",
        `- Dispatched in 2–3 business days; delivered in 3–5 working days to metro cities and 5–7 elsewhere (${SITE_URL}/shipping-policy).`,
        `- Returns within 7 days of delivery for items that arrive defective, damaged or not as described (${SITE_URL}/return-policy).`,
        ...(sales.length ? ["", "### Festival sales", ...sales, "The printer prices below include the sale that is running."] : []),
        "",
        "## Frequently asked questions",
        ...FAQ.flatMap(({ q, a: ans }) => [`### ${q}`, ans, ""]),
        "## Products",
        ...byCategory,
    ].join("\n") + "\n";
}
