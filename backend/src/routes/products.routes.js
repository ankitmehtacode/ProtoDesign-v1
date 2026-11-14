import express from 'express';
import multer from 'multer';
import db from '../config/database.js';
import { storageService } from '../services/storage.service.js';
import { isUuid } from '../services/order.service.js';
import authMiddleware from '../middleware/auth.js';
import isAdmin from '../middleware/isAdmin.js';
import { requestSiteRebuild } from '../services/site.rebuild.js';
import { activeSale, festivalPrice } from '../services/festival.js';

// True when the reviewer has a delivered or completed order containing the
// product. Computed on read, so it stays correct as order statuses change.
const VERIFIED_PURCHASE_SQL = `EXISTS (
    SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE o.user_id = r.user_id AND oi.product_id = r.product_id
       AND o.status IN ('delivered', 'completed'))`;

// Recomputes the denormalised rating summary on products after any change to
// its reviews. Call inside a transaction that holds the product row lock, so
// concurrent review changes cannot overwrite each other's counts.
const refreshReviewStats = (t, productId) => t.none(
    `UPDATE products p SET average_rating = s.avg, review_count = s.count
       FROM (SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS avg, COUNT(*) AS count
               FROM reviews WHERE product_id = $1) s
      WHERE p.id = $1`, [productId]);

const router = express.Router();

// Multer now serves the CSV bulk import only. Product images and video are
// uploaded by the browser directly to Cloudinary via a signature from
// POST /upload-signature, so they never occupy a request body -- which is what
// keeps this route under Lambda's 6MB payload ceiling.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // a product CSV is text; 5MB is ample
});

// The random suffix avoids a uniqueness round-trip; collisions across 36^4
// suffixes for the same name are negligible at catalogue scale.
const generateUniqueSlug = (name) => {
    const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
    return `${base}-${Math.random().toString(36).substring(2, 6)}`;
};

// Helper function to parse CSV files
const parseCSV = (buffer) => {
    const text = buffer.toString();
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];
        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                currentCell += '"'; i++;
            } else insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
            currentRow.push(currentCell.trim()); currentCell = '';
        } else if ((char === '\n' || char === '\r') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            currentRow.push(currentCell.trim());
            if (currentRow.length > 0 && (currentRow.length > 1 || currentRow[0] !== '')) rows.push(currentRow);
            currentRow = []; currentCell = '';
        } else currentCell += char;
    }
    if (currentCell || currentRow.length > 0) { currentRow.push(currentCell.trim()); rows.push(currentRow); }
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.replace(/^"|"$/g, '').replace(/^\uFEFF/, '').toLowerCase().trim());
    return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => obj[h] = row[i] || '');
        return obj;
    });
};

const parseSpecs = (str) => {
    if (!str) return {};
    const specs = {};
    const items = str.split(';').map(s => s.trim()).filter(s => s);
    items.forEach(item => {
        let sep = item.indexOf(':');
        if (sep === -1) sep = item.indexOf(' ');
        if (sep === -1) { if(item.length > 0) specs[item] = "Yes"; }
        else {
            const key = item.substring(0, sep).trim();
            const val = item.substring(sep + 1).trim();
            if (key) specs[key] = val;
        }
    });
    return specs;
};

const formatImageUrl = (url) => {
    if (!url) return null;
    if (url.includes('drive.google.com')) {
        const matchView = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (matchView && matchView[1]) return `https://drive.google.com/uc?export=download&id=${matchView[1]}`;
        const matchOpen = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (matchOpen && matchOpen[1]) return `https://drive.google.com/uc?export=download&id=${matchOpen[1]}`;
    }
    return url;
};

// ==========================================
// SYNCED BULK UPLOAD ROUTE
// ==========================================
router.post('/bulk', authMiddleware, isAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

        const products = parseCSV(req.file.buffer);
        const results = { success: 0, failed: 0, errors: [] };

        for (const p of products) {
            const rawPrice = p.price ? p.price.toString().replace(/[^0-9.]/g, '') : "";
            const rawStock = p.stock ? p.stock.toString().replace(/[^0-9]/g, '') : "0";

            if (!p.name || !rawPrice) continue;

            try {
                const specs = parseSpecs(p.specifications || "");
                // ✅ FIX: Stringify specs to prevent text[] casting crash
                const specsString = JSON.stringify(specs);
                const cat = p.category ? p.category.toLowerCase().replace(/ /g, '_') : 'uncategorized';
                
                const slug = await generateUniqueSlug(p.name);

                const product = await db.one(
                    `INSERT INTO products (
                        name, slug, price, stock, category, sub_category,
                        short_description, description, specifications
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING id`,
                    [p.name, slug, parseFloat(rawPrice), parseInt(rawStock), cat, p.sub_category || '', p.short_description || '', p.description || '', specsString]
                );

                if (p.images) {
                    const urls = p.images.split(/[\n\r\s,;]+/).map(u => u.trim()).filter(Boolean);
                    for (let i = 0; i < urls.length; i++) {
                        const directUrl = formatImageUrl(urls[i]);
                        try {
                            const cloudUrl = await storageService.uploadFromUrl(directUrl, 'products', p.name);
                            await db.none('INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3)', [product.id, cloudUrl, i]);
                            if (i === 0) await db.none('UPDATE products SET image_url = $1 WHERE id = $2', [cloudUrl, product.id]);
                        } catch (imgErr) {
                            console.error(`Failed image for ${p.name}:`, imgErr.message);
                        }
                    }
                }
                results.success++;
            } catch (err) {
                results.failed++;
                results.errors.push(`Failed ${p.name}: ${err.message}`);
            }
        }
        if (results.success > 0) await requestSiteRebuild('admin_product_bulk');
        res.json({ message: 'Bulk processing complete', results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// PUBLIC ROUTES
// ==========================================

router.get('/', async (req, res) => {
    try {
        const { category, sub_category, search, show_archived } = req.query;
        let query = 'SELECT * FROM products WHERE 1=1';
        let params = [];
        let paramCount = 1;

        if (show_archived !== 'true') query += ` AND (is_archived = false OR is_archived IS NULL)`;
        if (category && category !== 'all') {
            query += ` AND category = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        if (search) {
            query += ` AND (name ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }
        query += ' ORDER BY created_at DESC';

        const products = await db.any(query, params);

        // Was one query per product (verified live: 36 sequential round trips for
        // today's 35 products, growing linearly with the catalog). Replaced with a
        // single batched query for every product's images, grouped in JS -- 2 total
        // round trips regardless of how many products match.
        if (products.length > 0) {
            const productIds = products.map(p => p.id);
            const allImages = await db.any(
                'SELECT * FROM product_images WHERE product_id IN ($1:csv) ORDER BY product_id, display_order ASC',
                [productIds]
            );
            const imagesByProduct = new Map();
            for (const image of allImages) {
                if (!imagesByProduct.has(image.product_id)) imagesByProduct.set(image.product_id, []);
                imagesByProduct.get(image.product_id).push(image);
            }
            for (const product of products) {
                product.product_images = imagesByProduct.get(product.id) || [];
            }
        }

        res.json(products.map((p) => festivalPrice(p)));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const param = req.params.id;
        
        // ✅ 160 IQ ROUTING: Determine if param is UUID or Slug to prevent DB casting crashes
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const isUUID = uuidRegex.test(param);

        const query = isUUID 
            ? 'SELECT * FROM products WHERE id = $1' 
            : 'SELECT * FROM products WHERE slug = $1';

        const product = await db.oneOrNone(query, [param]);
        
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const images = await db.any('SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC', [product.id]);
        product.product_images = images;

        const reviews = await db.any(`
            SELECT r.*, COALESCE(u.full_name, 'Anonymous') as user, ${VERIFIED_PURCHASE_SQL} AS verified_purchase
            FROM reviews r LEFT JOIN users u ON r.user_id = u.id
            WHERE r.product_id = $1 ORDER BY r.created_at DESC
        `, [product.id]);
        product.reviews = reviews;

        res.json(festivalPrice(product));
    } catch (error) {
        console.error("Fetch Product Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// CUSTOMER ACTIONS (LIKES & REVIEWS)
// ==========================================
router.post('/:id/like', authMiddleware, async (req, res) => {
    try {
        await db.none('UPDATE products SET likes_count = likes_count + 1 WHERE id::text = $1 OR slug = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/:id/like', authMiddleware, async (req, res) => {
    try {
        await db.none('UPDATE products SET likes_count = GREATEST(likes_count - 1, 0) WHERE id::text = $1 OR slug = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/:id/reviews', authMiddleware, async (req, res) => {
    try {
        const param = req.params.id;

        // 1. Safe Routing Check
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const isUUID = uuidRegex.test(param);

        const query = isUUID
            ? 'SELECT id FROM products WHERE id = $1'
            : 'SELECT id FROM products WHERE slug = $1';

        const product = await db.oneOrNone(query, [param]);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const { rating, comment } = req.body ?? {};
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
        }
        if (comment != null && (typeof comment !== 'string' || comment.length > 2000)) {
            return res.status(400).json({ error: 'Comment must be text of at most 2000 characters' });
        }

        // 2. Any signed-in user may review, once per product. Buyers are marked
        //    verified on read (VERIFIED_PURCHASE_SQL). Locking the product row
        //    serialises review changes per product, so the duplicate check and
        //    the stats refresh both see every committed review.
        const posted = await db.tx(async t => {
            await t.one('SELECT id FROM products WHERE id = $1 FOR UPDATE', [product.id]);
            const reviewed = await t.oneOrNone(
                'SELECT 1 FROM reviews WHERE product_id = $1 AND user_id = $2', [product.id, req.userId]);
            if (reviewed) return false;

            await t.none(
                'INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)',
                [product.id, req.userId, rating, comment]
            );
            await refreshReviewStats(t, product.id);
            return true;
        });
        if (!posted) {
            return res.status(409).json({ error: 'You have already reviewed this product' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Post Review Error:", error);
        res.status(500).json({ error: 'Failed to post review' });
    }
});

// Admin-only moderation. Customers
// cannot delete reviews, including their own.
router.delete('/:id/reviews/:reviewId', authMiddleware, isAdmin, async (req, res) => {
    const { reviewId } = req.params;
    if (!isUuid(reviewId)) return res.status(404).json({ error: 'Review not found' });

    try {
        const deleted = await db.tx(async t => {
            const review = await t.oneOrNone(
                `SELECT r.id, r.product_id FROM reviews r
                   JOIN products p ON p.id = r.product_id
                  WHERE r.id = $1 AND (p.id::text = $2 OR p.slug = $2)
                  FOR UPDATE OF r, p`,
                [reviewId, req.params.id]);
            if (!review) return false;

            await t.none('DELETE FROM reviews WHERE id = $1', [review.id]);
            await refreshReviewStats(t, review.product_id);
            return true;
        });

        if (!deleted) return res.status(404).json({ error: 'Review not found' });
        console.log(JSON.stringify({ event: 'review_deleted', reviewId, adminId: req.userId }));
        res.json({ success: true });
    } catch (error) {
        console.error(JSON.stringify({ event: 'review_delete_failed', reviewId, error: error.message }));
        res.status(500).json({ error: 'Failed to delete review' });
    }
});

router.get('/:id/reviews', async (req, res) => {
    try {
        const param = req.params.id;

        // Use the same UUID check to prevent Postgres casting errors
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const isUUID = uuidRegex.test(param);

        const query = isUUID
            ? 'SELECT id FROM products WHERE id = $1'
            : 'SELECT id FROM products WHERE slug = $1';

        const product = await db.oneOrNone(query, [param]);

        if (!product) return res.status(404).json({ error: 'Product not found' });

        const reviews = await db.any(`
            SELECT r.*, COALESCE(u.full_name, 'Anonymous') as user, ${VERIFIED_PURCHASE_SQL} AS verified_purchase
            FROM reviews r LEFT JOIN users u ON r.user_id = u.id
            WHERE r.product_id = $1 ORDER BY r.created_at DESC
        `, [product.id]);

        res.json(reviews);
    } catch (error) {
        console.error("Fetch Reviews Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ADMIN ROUTES

// Only Cloudinary URLs are accepted back from the client. Without this an admin
// could store an arbitrary attacker-controlled URL as a product image.
const CLOUDINARY_URL = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\//;

const sanitizeMediaUrls = (value, { max }) => {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    if (list.length > max) {
        throw Object.assign(new Error(`At most ${max} files allowed`), { status: 400 });
    }
    for (const url of list) {
        if (typeof url !== 'string' || !CLOUDINARY_URL.test(url)) {
            throw Object.assign(new Error(`Rejected media URL: ${String(url).slice(0, 80)}`), { status: 400 });
        }
    }
    return list;
};

// Blank means "no sub-category" and is stored as NULL, the column default.
const parseSubCategory = (value) => {
    if (value == null) return null;
    if (typeof value !== 'string') {
        throw Object.assign(new Error('sub_category must be a string'), { status: 400 });
    }
    return value.trim() || null;
};

// The struck-through "was" price. undefined leaves it untouched (older clients
// do not send it); null or '' ends the deal.
const parseCompareAtPrice = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
        throw Object.assign(new Error('compare_at_price must be a positive number'), { status: 400 });
    }
    return n;
};

/**
 * Mint Cloudinary upload credentials for the browser. Scoped to a folder and
 * short-lived; admin-only because only admins add product media.
 */
router.post('/upload-signature', authMiddleware, isAdmin, async (req, res, next) => {
    try {
        const kind = req.body?.kind === 'video' ? 'products/videos' : 'products';
        res.json(storageService.createMediaUploadSignature({ folder: kind }));
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

router.post('/', authMiddleware, isAdmin, async (req, res, next) => {
    try {
        const { name, description, short_description, price, category, sub_category, stock,
                specifications, is_archived, images, videoUrl, compare_at_price } = req.body || {};

        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        const imageUrls = sanitizeMediaUrls(images, { max: 10 });
        const [video] = sanitizeMediaUrls(videoUrl, { max: 1 });
        const subCategory = parseSubCategory(sub_category);
        const compareAtPrice = parseCompareAtPrice(compare_at_price) ?? null;

        const product = await db.one(
            `INSERT INTO products (name, slug, description, short_description, price, category, sub_category, stock, specifications, video_url, is_archived, compare_at_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [name, generateUniqueSlug(name), description, short_description, price, category, subCategory, stock, specifications,
             video || null, is_archived === true || is_archived === 'true', compareAtPrice]
        );

        for (let i = 0; i < imageUrls.length; i++) {
            await db.none(
                'INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3)',
                [product.id, imageUrls[i], i]
            );
            if (i === 0) await db.none('UPDATE products SET image_url = $1 WHERE id = $2', [imageUrls[i], product.id]);
        }

        await requestSiteRebuild('admin_product_create', { paths: [`/product/${product.slug}`] });
        res.status(201).json(product);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

// Accepts an array or its JSON-string form; anything that is not a UUID is
// rejected up front rather than reaching Postgres as a 500.
const parseImageIds = (value) => {
    let list = value ?? [];
    if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch { list = null; }
    }
    if (!Array.isArray(list) || !list.every(isUuid)) {
        throw Object.assign(new Error('imagesToDelete must be an array of image ids'), { status: 400 });
    }
    return list;
};

router.put('/:id', authMiddleware, isAdmin, async (req, res, next) => {
    try {
        if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Product not found' });

        const { name, description, short_description, price, category, sub_category, stock,
                specifications, imagesToDelete, is_archived, images, videoUrl, deleteVideo, compare_at_price } = req.body || {};

        // A multipart body parses to {} here, so this is also what an outdated
        // client that still posts raw files would hit.
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        const imageUrls = sanitizeMediaUrls(images, { max: 10 });
        const [video] = sanitizeMediaUrls(videoUrl, { max: 1 });
        const idsToDelete = parseImageIds(imagesToDelete);
        const subCategory = parseSubCategory(sub_category);
        const compareAtPrice = parseCompareAtPrice(compare_at_price);

        const existing = await db.oneOrNone('SELECT id, slug, price, category FROM products WHERE id = $1', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Product not found' });

        // An editor loaded before list_price existed shows the festival price as
        // the price; saving it would make the discount permanent. That exact
        // drop, during a sale, is refused until the page is reloaded.
        const sale = activeSale();
        if (sale && Number(price) !== Number(existing.price)
            && Number(price) === Number(festivalPrice(existing).price)) {
            return res.status(409).json({ error: 'This editor shows festival sale prices. Reload the admin page, then save again.' });
        }

        // A slug is the product's public URL, so it is minted once and kept
        // across renames; changing it would break shared links and the sitemap.
        const slug = existing.slug || generateUniqueSlug(name);

        // One transaction: a failed image insert must not leave the product
        // half-updated with its old images already deleted.
        await db.tx(async (t) => {
            await t.none(
                `UPDATE products
                 SET name=$1, description=$2, short_description=$3, price=$4, category=$5, sub_category=$6, stock=$7,
                     specifications=$8, is_archived=$9, slug=$10, updated_at=NOW()
                 WHERE id=$11`,
                [name, description, short_description, price, category, subCategory, stock, specifications,
                 is_archived === true || is_archived === 'true', slug, req.params.id]
            );

            if (compareAtPrice !== undefined) {
                await t.none('UPDATE products SET compare_at_price = $1 WHERE id = $2', [compareAtPrice, req.params.id]);
            }

            if (video) {
                await t.none('UPDATE products SET video_url = $1 WHERE id = $2', [video, req.params.id]);
            } else if (deleteVideo === true) {
                await t.none('UPDATE products SET video_url = NULL WHERE id = $1', [req.params.id]);
            }

            // Scoped to this product so an id belonging to another product is ignored.
            if (idsToDelete.length > 0) {
                await t.none('DELETE FROM product_images WHERE product_id = $1 AND id IN ($2:csv)', [req.params.id, idsToDelete]);
            }

            if (imageUrls.length > 0) {
                const { m } = await t.one('SELECT COALESCE(MAX(display_order), -1) AS m FROM product_images WHERE product_id = $1', [req.params.id]);
                let nextOrder = m + 1;
                for (const url of imageUrls) {
                    await t.none('INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3)', [req.params.id, url, nextOrder++]);
                }
            }

            // Keep the denormalised cover in sync, including clearing it when every image was removed.
            await t.none(
                `UPDATE products SET image_url = (
                     SELECT image_url FROM product_images WHERE product_id = $1 ORDER BY display_order ASC LIMIT 1
                 ) WHERE id = $1`,
                [req.params.id]
            );
        });

        await requestSiteRebuild('admin_product_update', { paths: [`/product/${slug}`] });
        res.json({ message: "Product updated successfully" });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

router.delete('/:id', authMiddleware, isAdmin, async (req, res) => {
    try {
        if (req.query.permanent === 'true') {
            await db.none('DELETE FROM product_images WHERE product_id = $1', [req.params.id]);
            await db.none('DELETE FROM reviews WHERE product_id = $1', [req.params.id]);
            await db.none('DELETE FROM products WHERE id = $1', [req.params.id]);
            await requestSiteRebuild('admin_product_delete');
            res.json({ message: 'Deleted permanently' });
        } else {
            await db.none('UPDATE products SET is_archived = true WHERE id = $1', [req.params.id]);
            await requestSiteRebuild('admin_product_archive');
            res.json({ message: 'Archived' });
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/:id/restore', authMiddleware, isAdmin, async (req, res) => {
    try {
        await db.none('UPDATE products SET is_archived = false WHERE id = $1', [req.params.id]);
        await requestSiteRebuild('admin_product_restore');
        res.json({ message: 'Restored' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

export default router;
