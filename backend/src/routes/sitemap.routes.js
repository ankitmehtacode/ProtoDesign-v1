import express from 'express';
import db from '../config/database.js';

const router = express.Router();

// Helper to escape XML special characters like &
const escapeXml = (unsafe) => {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

// Indexable pages that do not come from the database. Keep in step with
// src/seo/site.js (the pages the frontend prerenders without noindex).
const STATIC_PATHS = [
    '/', '/custom', '/shop', '/printers', '/printables', '/filaments', '/resins',
    '/accessories', '/spare-parts', '/contact', '/shipping-policy', '/return-policy',
    '/refund-policy', '/privacy-policy', '/terms-and-conditions',
];

router.get('/sitemap.xml', async (req, res) => {
    try {
        // slug and image_url were never selected before, so every product was
        // listed under its raw id (a duplicate of its slug URL) with no image.
        const products = await db.any(
            'SELECT id, slug, name, image_url, updated_at FROM products WHERE is_archived = false ORDER BY updated_at DESC NULLS LAST'
        );

        const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/$/, '');
        const newest = products[0]?.updated_at ? new Date(products[0].updated_at).toISOString() : null;

        // Google ignores changefreq and priority; lastmod is the signal it uses,
        // so it is only emitted where it is real.
        const urls = STATIC_PATHS.map((path) => {
            const catalogue = path === '/shop' || path === '/' ? newest : null;
            return `  <url><loc>${baseUrl}${path === '/' ? '/' : path}</loc>${catalogue ? `<lastmod>${catalogue}</lastmod>` : ''}</url>`;
        });

        for (const product of products) {
            const loc = `${baseUrl}/product/${encodeURIComponent(product.slug || product.id)}`;
            const lastmod = product.updated_at ? `<lastmod>${new Date(product.updated_at).toISOString()}</lastmod>` : '';
            const image = product.image_url && product.image_url.startsWith('http')
                ? `<image:image><image:loc>${escapeXml(product.image_url)}</image:loc></image:image>`
                : '';
            urls.push(`  <url><loc>${escapeXml(loc)}</loc>${lastmod}${image}</url>`);
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>`;

        res.header('Content-Type', 'application/xml');
        res.header('Cache-Control', 'public, max-age=3600');
        res.send(xml);
    } catch (error) {
        console.error(JSON.stringify({ event: 'sitemap_failed', error: error.message }));
        res.status(500).send('Error generating sitemap');
    }
});

// ─── Google Merchant Center product feed ─────────────────────────────────────
// RSS 2.0 with the g: namespace, per Google's product data specification.
// Prices and availability come from the same rows the product pages render, so
// the feed and each page's Product structured data always agree.

const PRINTER_CATEGORY = '3d_printer';
// Mirrors ONLINE_SHIPPING_PAISE in order.service.js: printers ship free.
const SHIPPING_INR = { [PRINTER_CATEGORY]: '0.00', default: '199.00' };
const PRODUCT_TYPES = {
    '3d_printer': '3D Printers', filament: '3D Printer Filament', resin: '3D Printer Resin',
    '3dprintables': '3D Printed Products', accessory: '3D Printer Accessories', spare_part: '3D Printer Spare Parts',
};

/** Plain text safe for XML 1.0: no tags, no control characters, bounded. */
const feedText = (value, max) => String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const specMap = (specs) => {
    if (!specs || typeof specs !== 'object') return {};
    const entries = Array.isArray(specs) ? specs.map(s => [s?.key, s?.value]) : Object.entries(specs);
    return Object.fromEntries(entries.filter(([k, v]) => typeof k === 'string' && v != null).map(([k, v]) => [k, String(v)]));
};

const tag = (name, value) => (value === undefined || value === null || value === '' ? '' : `<${name}>${escapeXml(String(value))}</${name}>`);

router.get('/feeds/google-products.xml', async (req, res) => {
    try {
        const products = await db.any(`
            SELECT p.id, p.slug, p.name, p.description, p.short_description, p.price, p.stock, p.category,
                   p.image_url, p.specifications,
                   COALESCE(array_agg(pi.image_url ORDER BY pi.display_order) FILTER (WHERE pi.image_url IS NOT NULL), '{}') AS images
              FROM products p
              LEFT JOIN product_images pi ON pi.product_id = p.id
             WHERE (p.is_archived = false OR p.is_archived IS NULL) AND p.price > 0
             GROUP BY p.id
             ORDER BY p.created_at DESC NULLS LAST`);

        const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/$/, '');
        const items = [];
        for (const p of products) {
            const images = [...new Set([...p.images, p.image_url].filter(u => typeof u === 'string' && u.startsWith('https://')))];
            // Google rejects items without an image; leaving them out is clearer than a disapproval.
            if (images.length === 0) continue;

            const specs = specMap(p.specifications);
            const title = feedText(p.name, 150);
            const description = feedText(p.description || p.short_description || p.name, 5000);
            if (!title || !description) continue;

            const grams = parseFloat(specs['Approx. weight'] ?? '');
            items.push('<item>' + [
                tag('g:id', p.id),
                tag('title', title),
                tag('description', description),
                tag('link', `${baseUrl}/product/${encodeURIComponent(p.slug || p.id)}`),
                tag('g:image_link', images[0]),
                ...images.slice(1, 11).map(u => tag('g:additional_image_link', u)),
                tag('g:price', `${Number(p.price).toFixed(2)} INR`),
                tag('g:availability', p.stock > 0 ? 'in_stock' : 'out_of_stock'),
                tag('g:condition', 'new'),
                tag('g:brand', specs.Brand || 'ProtoDesign'),
                tag('g:identifier_exists', 'no'),
                tag('g:product_type', PRODUCT_TYPES[p.category] ?? 'Other'),
                tag('g:material', specs.Material),
                grams > 0 ? tag('g:shipping_weight', `${grams} g`) : '',
                `<g:shipping>${tag('g:country', 'IN')}${tag('g:price', `${SHIPPING_INR[p.category] ?? SHIPPING_INR.default} INR`)}</g:shipping>`,
            ].join('') + '</item>');
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>ProtoDesign</title>
<link>${escapeXml(baseUrl)}</link>
<description>ProtoDesign product catalogue</description>
${items.join('\n')}
</channel>
</rss>`;

        res.header('Content-Type', 'application/xml; charset=utf-8');
        res.header('Cache-Control', 'public, max-age=3600');
        res.send(xml);
    } catch (error) {
        console.error(JSON.stringify({ event: 'product_feed_failed', error: error.message }));
        res.status(500).send('Error generating product feed');
    }
});

export default router;
