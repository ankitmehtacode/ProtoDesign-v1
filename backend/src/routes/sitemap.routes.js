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

router.get('/sitemap.xml', async (req, res) => {
    try {
        // FIX: Use db.any() which is the correct pg-promise method for multiple rows
        // It returns the array of products directly.
        const products = await db.any('SELECT id, updated_at FROM products WHERE is_archived = false');

        // Was hardcoded to a domain that was never actually deployed to.
        // FRONTEND_URL is already a required env var for the PhonePe redirect
        // (see phonepe.service.js), so it is reused here rather than adding a
        // second place to configure the same fact.
        const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/$/, '');

        // ✅ Inject the Google Image Sitemap XML namespace
        let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
                xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
            <url>
                <loc>${baseUrl}/</loc>
                <changefreq>daily</changefreq>
                <priority>1.0</priority>
            </url>
            <url>
                <loc>${baseUrl}/shop</loc>
                <changefreq>daily</changefreq>
                <priority>0.9</priority>
            </url>
            <url>
                <loc>${baseUrl}/custom</loc>
                <changefreq>weekly</changefreq>
                <priority>0.9</priority>
            </url>
            <url><loc>${baseUrl}/printers</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
            <url><loc>${baseUrl}/printables</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
            <url><loc>${baseUrl}/filaments</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
            <url><loc>${baseUrl}/resins</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
            <url><loc>${baseUrl}/accessories</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
            <url><loc>${baseUrl}/spare-parts</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`;

        // Dynamic Product Pages with Image Data
        products.forEach(product => {
            const date = product.updated_at ? new Date(product.updated_at).toISOString() : new Date().toISOString();
            const productIdentifier = product.slug || product.id;
            const productUrl = `${baseUrl}/product/${escapeXml(productIdentifier)}`;

            // Ensure image URL is absolute
            let imgUrl = product.image_url;
            if (imgUrl && !imgUrl.startsWith('http')) {
                imgUrl = `${baseUrl}${imgUrl}`;
            }

            xml += `
            <url>
                <loc>${productUrl}</loc>
                <lastmod>${date}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.7</priority>`;
            
            // ✅ Feed images to Google Images crawler
            if (imgUrl) {
                xml += `
                <image:image>
                    <image:loc>${escapeXml(imgUrl)}</image:loc>
                    <image:title>${escapeXml(product.name)}</image:title>
                    <image:caption>Buy ${escapeXml(product.name)} at ProtoDesign</image:caption>
                </image:image>`;
            }

            xml += `
            </url>`;
        });

        xml += `</urlset>`;

        res.header('Content-Type', 'application/xml');
        res.send(xml);

    } catch (error) {
        console.error("Sitemap Error:", error);
        res.status(500).send('Error generating sitemap');
    }
});

export default router;
