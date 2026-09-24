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

export default router;
