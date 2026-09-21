import express from 'express';
import db from '../config/database.js'; // Importing the pg-promise instance

const router = express.Router();

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

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url>
                <loc>${baseUrl}/</loc>
                <changefreq>daily</changefreq>
                <priority>1.0</priority>
            </url>
            <url>
                <loc>${baseUrl}/shop</loc>
                <changefreq>daily</changefreq>
                <priority>0.8</priority>
            </url>`;

        // Add dynamic product URLs
        products.forEach(product => {
            // Handle null updated_at by falling back to current date or a default
            const date = product.updated_at ? new Date(product.updated_at).toISOString() : new Date().toISOString();

            xml += `
            <url>
                <loc>${baseUrl}/product/${product.id}</loc>
                <lastmod>${date}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.7</priority>
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