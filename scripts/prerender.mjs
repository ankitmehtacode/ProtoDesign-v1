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
import { FAQ, faqLd } from "../src/seo/faq.js";
import {
    CATEGORY_PAGES, DEFAULT_IMAGE, NOT_FOUND, ORG, PAGES, SITE_NAME, SITE_URL,
    breadcrumbLd, organizationLd, plainText, productDescription, productLd,
    productTitle, productUrl, quoteServiceLd, specMap, websiteLd,
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
const inr = (n) => `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;

function pageBody(meta, products = [], extra = "") {
    if (!meta.h1) return "";
    const list = products.length
        ? `<ul class="mt-8 space-y-2">${products
            .map((p) => `<li><a href="${new URL(productUrl(p)).pathname}">${esc(plainText(p.name, 200))}</a>: ${inr(p.price)}${p.stock > 0 ? "" : " (sold out)"}</li>`)
            .join("")}</ul>`
        : "";
    return shell(`${nav()}<h1 class="mt-8 font-display text-3xl font-bold">${esc(meta.h1)}</h1><p class="mt-3 max-w-xl text-muted-foreground">${esc(meta.intro ?? meta.description)}</p>${list}${extra}`);
}

function productBody(p, categoryName, categoryPath) {
    const desc = plainText(p.description || p.short_description || "", 1200);
    return shell(`${nav()}<p class="mt-8 text-sm text-muted-foreground"><a href="${categoryPath}">${esc(categoryName)}</a></p>` +
        `<h1 class="mt-2 font-display text-3xl font-bold">${esc(plainText(p.name, 200))}</h1>` +
        `<p class="mt-3 text-lg">${inr(p.price)} · ${p.stock <= 0 ? "Sold out" : specMap(p.specifications).Fulfilment === "Made to order" ? "Made to order" : "In stock"} · Delivered across India</p>` +
        (desc ? `<p class="mt-4 max-w-xl text-muted-foreground">${esc(desc)}</p>` : ""));
}

function render(template, headHtml, bodyHtml) {
    const [before, rest] = template.split("<!--seo:start-->");
    const [, after] = rest.split("<!--seo:end-->");
    if (after === undefined) throw new Error("index.html is missing the <!--seo:start/end--> markers");
    return `${before}${headHtml}${after}`.replace("<!--seo:body-->", bodyHtml);
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

const template = await readFile(join(DIST, "index.html"), "utf8");

// Renders real app components (legal pages, FAQ) to HTML at build time, so the
// static page matches what visitors see. Vite compiles the TSX and resolves "@/".
const ROOT = new URL("../", import.meta.url).pathname;
const vite = await createServer({ root: ROOT, appType: "custom", logLevel: "error", server: { middlewareMode: true, hmr: false } });
const { renderPage, renderFaq } = await vite.ssrLoadModule("/src/seo/ssr.tsx");

let products = [];
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
    await write(route, render(template,
        head({ title: meta.title, description: meta.description, canonical: `${SITE_URL}${route}`, noindex: meta.noindex, ld }),
        meta.noindex ? "" : renderedBody(route) ?? pageBody(meta, inCategory, route === "/custom" ? renderFaq() : "")));
    count++;
}

for (const p of products) {
    const [categoryName, categoryPath] = CATEGORY_PAGES[p.category] ?? ["Shop", "/shop"];
    const url = productUrl(p);
    await write(new URL(url).pathname, render(template,
        head({
            title: productTitle(p.name, categoryName),
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

await writeFile(join(DIST, "llms.txt"), llmsTxt(products));
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
function llmsTxt(list) {
    const a = ORG.address;
    const md = (s) => String(s).replace(/\s+/g, " ").trim();
    const indexable = Object.entries(PAGES).filter(([, m]) => !m.noindex);
    const byCategory = Object.entries(CATEGORY_PAGES).map(([key, [name, path]]) => {
        const items = list.filter((p) => p.category === key);
        return items.length ? [`### ${name} (${SITE_URL}${path})`, ...items.map((p) => `- [${md(plainText(p.name, 120))}](${productUrl(p)}): ${inr(p.price)}, GST included`), ""] : [];
    }).flat();
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
        "## Frequently asked questions",
        ...FAQ.flatMap(({ q, a: ans }) => [`### ${q}`, ans, ""]),
        "## Products",
        ...byCategory,
    ].join("\n") + "\n";
}
