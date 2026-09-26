import express from 'express';
import multer from 'multer';
import db from '../config/database.js';
import { storageService } from '../services/storage.service.js';
import { isUuid } from '../services/order.service.js';
import authMiddleware from '../middleware/auth.js';
import isAdmin from '../middleware/isAdmin.js';
import { requestSiteRebuild } from '../services/site.rebuild.js';

// True when the reviewer has a delivered or completed order containing the
// product. Computed on read, so it stays correct as order statuses change.
const VERIFIED_PURCHASE_SQL = `EXISTS (
    SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE o.user_id = r.user_id AND oi.product_id = r.product_id
       AND o.status IN ('delivered', 'completed'))`;

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

        res.json(products);
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

        res.json(product);
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
        //    verified on read (VERIFIED_PURCHASE_SQL).
        const reviewed = await db.oneOrNone(
            'SELECT 1 FROM reviews WHERE product_id = $1 AND user_id = $2', [product.id, req.userId]);
        if (reviewed) {
            return res.status(409).json({ error: 'You have already reviewed this product' });
        }

        await db.none(
            'INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)',
            [product.id, req.userId, rating, comment]
        );

        // 3. Update Product Stats
        const stats = await db.one(
            'SELECT AVG(rating) as avg, COUNT(id) as count FROM reviews WHERE product_id = $1',
            [product.id]
        );
        await db.none(
            'UPDATE products SET average_rating = $1, review_count = $2 WHERE id = $3',
            [stats.avg || 0, stats.count, product.id]
        );

        res.json({ success: true });
    } catch (error) {
        console.error("Post Review Error:", error);
        res.status(500).json({ error: 'Failed to post review' });
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
                specifications, is_archived, images, videoUrl } = req.body || {};

        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        const imageUrls = sanitizeMediaUrls(images, { max: 10 });
        const [video] = sanitizeMediaUrls(videoUrl, { max: 1 });
        const subCategory = parseSubCategory(sub_category);

        const product = await db.one(
            `INSERT INTO products (name, slug, description, short_description, price, category, sub_category, stock, specifications, video_url, is_archived)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [name, generateUniqueSlug(name), description, short_description, price, category, subCategory, stock, specifications,
             video || null, is_archived === true || is_archived === 'true']
        );

        for (let i = 0; i < imageUrls.length; i++) {
            await db.none(
                'INSERT INTO product_images (product_id, image_url, display_order) VALUES ($1, $2, $3)',
                [product.id, imageUrls[i], i]
            );
            if (i === 0) await db.none('UPDATE products SET image_url = $1 WHERE id = $2', [imageUrls[i], product.id]);
        }

        await requestSiteRebuild('admin_product_create');
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
                specifications, imagesToDelete, is_archived, images, videoUrl, deleteVideo } = req.body || {};

        // A multipart body parses to {} here, so this is also what an outdated
        // client that still posts raw files would hit.
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        const imageUrls = sanitizeMediaUrls(images, { max: 10 });
        const [video] = sanitizeMediaUrls(videoUrl, { max: 1 });
        const idsToDelete = parseImageIds(imagesToDelete);
        const subCategory = parseSubCategory(sub_category);

        const existing = await db.oneOrNone('SELECT slug FROM products WHERE id = $1', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Product not found' });

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

        await requestSiteRebuild('admin_product_update');
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

// ==========================================
// ✅ FINAL REVIEW SEEDER
// Replace the existing seed-reviews route in products.routes.js
// ==========================================

router.post('/seed-reviews', authMiddleware, isAdmin, async (req, res) => {
    try {

        // ─── 1. NAMES ────────────────────────────────────────────────
        // Mix of: regular names, single names, reversed (last first),
        // middle names, online usernames, names with numbers
        const dummyNames = [
            // Regular first + last
            'Rahul Verma', 'Sneha Iyer', 'Priya Sharma', 'Rohit Joshi', 'Ananya Krishnan',
            'Varun Shukla', 'Pallavi Mishra', 'Nitin Bansal', 'Swati Agarwal', 'Aakash Jain',
            'Bharat Sawant', 'Komal Patil', 'Harshal Mane', 'Gauri Jadhav', 'Kedar Apte',
            'Vaibhav Khare', 'Pravin Rokade', 'Ramkumar Nair', 'Isha Bhargava', 'Ranjit Das',
            'Saurabh Khatri', 'Poonam Vyas', 'Garima Sinha', 'Yashraj Singh', 'Anushka Dey',
            'Omkar Gawade', 'Chinmay Kelkar', 'Rucha Salvi', 'Amruta Zende', 'Prasad Shirke',
            'Sanket Kale', 'Vrushali More', 'Madhav Sane', 'Sujata Kadam', 'Ninad Kulkarni',
            'Priyanka Joshi', 'Amey Bapat', 'Ashlesha Mahajan', 'Kunal Shinde', 'Shreya Bose',
            'Naveen Kumar', 'Deepa Menon', 'Shubham Tiwary', 'Prerna Bhosale', 'Sumati Pillai',

            // Single first names only
            'Kiran', 'Deepak', 'Sumit', 'Meera', 'Gaurav',
            'Pooja', 'Arjun', 'Ritika', 'Nidhi', 'Tarun',
            'Vishal', 'Anjali', 'Rajesh', 'Sonu', 'Rocky',

            // Last name first (South Indian / formal style)
            'Pillai Renuka', 'Venkat Chitra', 'Nambiar Praveen',
            'Rao Nalini', 'Naidu Ramesh', 'Patil Dinesh',
            'Lakshminarayan S', 'Venkatesh B', 'Anantharaman R',

            // With middle names
            'Amit Kumar Thakur', 'Snehal Raj Bhide', 'Rohan Dev Deshpande',
            'Vijay Anand Sharma', 'Mahesh Lal Gupta', 'Prerna Lata Bhosale',

            // Online / username style (no cringe, just random internet handles)
            'TechWithRaj', 'PrinterBhai3D', 'MakerMindIndia', 'GadgetGuru_Sonu', 'CraftsByKavya',
            'The3DGuy', 'FilamentFreak', 'LayerByLayer_RJ', 'NozzleNinja', 'JugaadEngineer',
            'DesignDekho', 'MakersHub_Mumbai', 'ResinRider', 'FDM_Fanatic', 'VoxelVikas',
            'SteelPrinter47', 'CyberKraft', 'PixelPrakash', 'ByteSized_Bro', 'TurboTushar',

            // Names with numbers (very common online)
            'Rahul2047', 'Maker_1994', 'Vikram3D', 'Ankit007', 'Rohan_1k',
            'PrintGod2024', 'Techy_Raj22', 'SolidParts_Suresh', 'MakerBoi_X', 'Filament_Fan',
        ];

        // Create / reuse users
        const userMap = {};
        for (const name of dummyNames) {
            const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 14);
            const email = `${slug}${Math.floor(Math.random() * 9000 + 1000)}@gmail.com`;
            let u = await db.oneOrNone('SELECT id FROM users WHERE email = $1', [email]);
            if (!u) {
                u = await db.one(
                    'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
                    [email, 'seed_hash_readonly', name]
                );
            }
            userMap[name] = u.id;
        }


        // ─── 2. REVIEW BANKS ─────────────────────────────────────────
        // 50 reviews per category.
        // Ratio: 20 × five-star | 25 × four-star | 5 × three-star
        // Tone: casual, varied length, natural grammar imperfections — NOT performative


        const printerReviews = [
            // ── 20 × 5 STAR ──
            { rating: 5, comment: "Bhai ekdum mast printer hai. pehli baar mein hi perfect print aaya. bilkul settings nahi badli" },
            { rating: 5, comment: "Been using this daily for 3 months straight. not a single failure. very impressive machine" },
            { rating: 5, comment: "Setup in 25 mins and benchy came out clean. what else do you want" },
            { rating: 5, comment: "Silent mode actually works. printing at 1am and nobody in house even knows" },
            { rating: 5, comment: "Auto leveling is a game changer yaar. mera purana printer toh har baar manually level karna padta tha" },
            { rating: 5, comment: "Used for final year project. dimensional accuracy was spot on. very happy with purchase" },
            { rating: 5, comment: "Packing was excellent. no damage at all. same day setup and printed within an hour of unboxing" },
            { rating: 5, comment: "Resume after power cut saved my 22 hour print. that feature alone is worth the price" },
            { rating: 5, comment: "ha printer khup mast ahe. mazya mulane ek YouTube video baghun set up kela. ekdum simple" },
            { rating: 5, comment: "best FDM at this price no doubt. consistent results every single time" },
            { rating: 5, comment: "RC car parts printing pe chal rha hai ye. accuracy is very good. exactly what I needed" },
            { rating: 5, comment: "ordered tuesday received thursday. setup same evening. already on 4th print. fast delivery from ProtoDesign" },
            { rating: 5, comment: "matte black prints dikahne mein injection moulded jaisa lagta hai. clients ko pata hi nahi chalta" },
            { rating: 5, comment: "running at college makerspace. students use it every day. zero maintenance issues in 3 months" },
            { rating: 5, comment: "Bed adhesion is unreal. ABS bhi warp nahi karta is bed pe. never seen this before" },
            { rating: 5, comment: "fast delivery and product exactly as described. very satisfied with ProtoDesign" },
            { rating: 5, comment: "aavyu tyare j samjhi gayo ke upgrade modiyu hatu. pehla walo printer ni yaad pan nathi aavti hve" },
            { rating: 5, comment: "heated bed heats up in under 4 mins. 0.1mm print quality is genuinely impressive" },
            { rating: 5, comment: "touchscreen UI is clean. much better than that old knob based nonsense" },
            { rating: 5, comment: "Bought for architecture models. precision is excellent. very good investment" },

            // ── 25 × 4 STAR ──
            { rating: 4, comment: "very good printer. little bed leveling needed at start but after that all prints came out clean" },
            { rating: 4, comment: "solid machine bhai. slicer thoda confusing hai but printer itself is excellent" },
            { rating: 4, comment: "print quality great hai. fan thodi noisy hai but koi problem nahi. would recommend" },
            { rating: 4, comment: "good build quality. metal frame is sturdy. took few prints to dial in settings but worth it" },
            { rating: 4, comment: "30+ models printed. not a single failure. minus one star for fan noise only" },
            { rating: 4, comment: "bed adhesion solid hai. prints cooldown ke baad cleanly peel off hote hain. no glue needed" },
            { rating: 4, comment: "performance se khush hoon. cable management thodi better ho sakti thi but prints are great" },
            { rating: 4, comment: "nothing feels cheap about this machine. instructions could be more detailed thats all" },
            { rating: 4, comment: "print speed is impressive. 0.2mm quality is very good. filament sensor could be better" },
            { rating: 4, comment: "Reliable printer. I print mostly functional parts. strength has been consistent" },
            { rating: 4, comment: "multicolour setup is more involved but results are worth the effort" },
            { rating: 4, comment: "3rd printer I've bought. smoothest setup so far. minor cosmtic marks on frame thats it" },
            { rating: 4, comment: "0.15mm quality is very good. overhangs better than my old machine. slight speed tradeoff" },
            { rating: 4, comment: "print quality justifies the price. consistent across all materials I tried" },
            { rating: 4, comment: "arrived well packed. setup guide decent. first print without any changes looked good" },
            { rating: 4, comment: "workshop ke liye perfect hai ye printer. glamorous nahi hai but kaam roz reliably karta hai" },
            { rating: 4, comment: "PETG and PLA dono achhe results de raha hai. ABS abhi try nahi kiya" },
            { rating: 4, comment: "two months. regular use. not a single problem. small dock for loud fans" },
            { rating: 4, comment: "does exactly what listing says. no surprises. solid purchase" },
            { rating: 4, comment: "ek hafte mein settings samajh aayi. tab se consistent results aa rahe hain" },
            { rating: 4, comment: "large build volume is genuinely useful. big single piece parts came out clean" },
            { rating: 4, comment: "shipping took extra day but thats minor. print quality is very good" },
            { rating: 4, comment: "not a toy. requires learning but rewards you once dialed in properly" },
            { rating: 4, comment: "very happy. one point off because sample spool included was almost empty when I opened it" },
            { rating: 4, comment: "PLA PETG flexible sab theek hai. ABS ke liye enclosure chahiye hoga" },

            // ── 5 × 3 STAR ──
            { rating: 3, comment: "Printer works but bed levling keeps drifting after every 4-5 prints. expected better at this price" },
            { rating: 3, comment: "machine theek hai but bundled slicer software ekdum confusing hai for beginners" },
            { rating: 3, comment: "Print quality average hai. seen better from similar priced machines" },
            { rating: 3, comment: "basic prints fine hain. 45 degree ke baad overhangs struggle karte hain even with supports" },
            { rating: 3, comment: "Okay printer. kaam karta hai. but itne reviews padh ke zyada expect kar liya tha" },
        ];

        const printablesReviews = [
            // ── 20 × 5 STAR ──
            { rating: 5, comment: "pehli baar mein hi print hua. tolerances perfect hain. exactly like the preview" },
            { rating: 5, comment: "Saved me hours of design work. exact geometry I needed. very clean file" },
            { rating: 5, comment: "teesri file hai yahan se kharidi. teeno excellent quality. no rework needed on any" },
            { rating: 5, comment: "gifted the print. everyone thought it was store bought. excellent design quality" },
            { rating: 5, comment: "caliper se check kiya. sab holes spot on. dimensional accuracy is very impressive" },
            { rating: 5, comment: "download karo slice karo print karo. ekdum preview jaisa aaya. exactly what I wanted" },
            { rating: 5, comment: "file ke saath print settings bhi the. that is rare and very helpful. good seller" },
            { rating: 5, comment: "workshop use ke liye print kiya ABS mein. fits perfectly. saved buying an expensive tool" },
            { rating: 5, comment: "khup fine detail ahe ya model la. 0.1mm la print kela presentation sathi. ekdum mast output" },
            { rating: 5, comment: "designer ne khud print karke dekha hoga selling se pehle. FDM ke liye perfectly optimised" },
            { rating: 5, comment: "mara go to store che printable files mate. quality hamesha consistent raheti che" },
            { rating: 5, comment: "Client project ke liye use kiya. unhe yakeen nahi hua ki ye desktop printer se nikla hai" },
            { rating: 5, comment: "Internship ke liye print kiya. dimensionally accurate and solid at 20% infill" },
            { rating: 5, comment: "Clean STL. no errors in slicer. wall thickness correct. snapped together perfectly" },
            { rating: 5, comment: "supports minimal the aur easily remove ho gaye. final print looks very professional" },
            { rating: 5, comment: "FDM ke liye optimised hai is file ko. doosri sites pe jo cheap files milti hain unse zyada behtar" },
            { rating: 5, comment: "PETG mein print kiya strength ke liye. fits perfectly. no adjustments needed at all" },
            { rating: 5, comment: "smart design. not over engineered not under designed. just right" },
            { rating: 5, comment: "multiple pieces. all fit together on first attempt. great tolerances. assembly was easy" },
            { rating: 5, comment: "2 hour print and result is something I'm actually poud to show people. great file" },

            // ── 25 × 4 STAR ──
            { rating: 4, comment: "good model. minimal supports. final print close to preview. happy with it" },
            { rating: 4, comment: "FDM ke liye achhe se optimised hai. surface finish clean aayi. support removal easy tha" },
            { rating: 4, comment: "clever design. PETG mein print kiya. works perfectly for the application" },
            { rating: 4, comment: "nice file. thoda support marks cleanup tha but kuch nahi. result excellent hai" },
            { rating: 4, comment: "solid design. proper tolerances. exactly as described. would buy here again" },
            { rating: 4, comment: "Good value. 2 hour print and result matches listing photo closely" },
            { rating: 4, comment: "Well designed for printability. creator ne khud test kiya hoga. details mein dikhta hai" },
            { rating: 4, comment: "Great file overall. very minor surface artifacts on one face. doesnt affect function though" },
            { rating: 4, comment: "parts fit well. one hole thoda tight tha. quick drill fix and done" },
            { rating: 4, comment: "15% infill mein bhi solid enough for my use. good design efficiency" },
            { rating: 4, comment: "Bambu slicer mein koi issue nahi. printed first try. one star off for no print instructions" },
            { rating: 4, comment: "clean geometry. no slicer issues. came out good. minor support marks on inside surface" },
            { rating: 4, comment: "good quality file. not perfect but no real complaints either" },
            { rating: 4, comment: "printed fine. scale accurate. dimensions matched listing. happy buyer" },
            { rating: 4, comment: "thoughtful design. printed cleanly first attempt. tiny cleanup and done" },
            { rating: 4, comment: "Not the most detailed but functionally exactly what I needed for the price" },
            { rating: 4, comment: "clean file. well structured. printed in under 3 hours. good quality result" },
            { rating: 4, comment: "nice design. walls proper thickness. infill recommendation in description was helpful" },
            { rating: 4, comment: "gifting project ke liye kharida. achha aaya. very minor seam line but nothing noticeable" },
            { rating: 4, comment: "fits use case exactly. not flashy just practical and well made" },
            { rating: 4, comment: "PETG aur PLA dono print kiye. both clean. no scaling needed" },
            { rating: 4, comment: "good file. practical design. prints easily. one of the better ones here" },
            { rating: 4, comment: "everything fit correctly. one star off because expected slightly more surface detail" },
            { rating: 4, comment: "solid printable. works as described. clean geometry. slicer had no issues" },
            { rating: 4, comment: "good design quality. minor edge cleanup after printing. overall result looks finished" },

            // ── 5 × 3 STAR ──
            { rating: 3, comment: "Tolerances thodi off thi. 101% rescale karna pada fit ke liye. should have been right" },
            { rating: 3, comment: "design okay hai but support placement made cleanup more involved than expected" },
            { rating: 3, comment: "File print hua fine. functionality hai but design thodi jagah unfinished lagti hai" },
            { rating: 3, comment: "decent enough. kaam kar diya. must buy nahi hai but fair for the price" },
            { rating: 3, comment: "FDM ke liye better optimise ho sakta tha. wall thickness borderline hai kuch areas mein" },
        ];

        const filamentReviews = [
            // ── 20 × 5 STAR ──
            { rating: 5, comment: "6 brands try kiye hain. ye wala best PLA hai abhi tak. zero stringing at normal settings" },
            { rating: 5, comment: "4 spools order kiye. sab ka quality aur colour identical. very impressive consistency" },
            { rating: 5, comment: "6 months daily printing. not a single clog or mid print failure. extremely reliable" },
            { rating: 5, comment: "matte black variant ekdum mast dikhta hai. injection moulded jaisa finish. using for client work" },
            { rating: 5, comment: "5 spools. all perfect. not one printing failure across the whole batch" },
            { rating: 5, comment: "carbon fiber variant is impressive. parts stiff hain aur surface texture premium lagta hai" },
            { rating: 5, comment: "silk gold colour dekh ke hi dil khush ho gaya. clients samajhte hain coated metal hai" },
            { rating: 5, comment: "PETG variant is strong. functional brackets printed. holding up under real load daily" },
            { rating: 5, comment: "ye ABS itna kam warp karta hai. finally ABS parts bana pa rha hoon bina frustration ke" },
            { rating: 5, comment: "nylon 4 ghante dry karke print kiya. ekdum smooth. nylon se itna achha result pehli baar" },
            { rating: 5, comment: "surface quality is excellent. 0.2mm pe layer lines barely visible. very smooth output" },
            { rating: 5, comment: "best budget filament I've found. will keep ordering from ProtoDesign as long as this quality continues" },
            { rating: 5, comment: "layer adhesion excellent hai. functional prints noticeably stronger than my previous brand" },
            { rating: 5, comment: "sealed pack mein se nikala toh bilkul dry tha. good quality control on every spool" },
            { rating: 5, comment: "miniatures ke liye use karta hoon. 0.1mm pe detail retention excellent hai. best for fine detail" },
            { rating: 5, comment: "rainbow pack ke colours vibrant hain. sab almost same temperature pe print hote hain. convenient" },
            { rating: 5, comment: "spools well wound hain. 4 spools mein ek bhi tangle nahi. exactly advertised temp range pe prints" },
            { rating: 5, comment: "3 months ago switched to this brand. have not gone back. consistency sabse best hai" },
            { rating: 5, comment: "first layer adhesion perfect every time. glass bed pe koi raft nahi chahiye. filament bachta hai" },
            { rating: 5, comment: "bulk discount plus consistent quality. exactly what I needed for production use" },

            // ── 25 × 4 STAR ──
            { rating: 4, comment: "good filament. diameter consistent throughout the spool. no clogging no tangling" },
            { rating: 4, comment: "solid value. prints cleanly. spool feeds smoothly. recommend karunga easily" },
            { rating: 4, comment: "thoda stringing tha pehle. retraction half mm adjust kiya toh theek ho gaya. quality good hai" },
            { rating: 4, comment: "good quality for price. thoda zyada stringing hai premium brands se but manageable" },
            { rating: 4, comment: "same order ke spools mein consistent quality. colours listing photos se match karte hain" },
            { rating: 4, comment: "exactly stated temp range pe print karta hai. no hot end issues. reliable brand" },
            { rating: 4, comment: "bridges pe minor stringing hai but ek second mein clean ho jaata hai. fine overall" },
            { rating: 4, comment: "prototyping aur presentation models ke liye very usable quality. good price to quality ratio" },
            { rating: 4, comment: "decent quality. PLA aur PETG dono achhe perform kiye. other materials abhi try nahi kiye" },
            { rating: 4, comment: "everyday printing ke liye good hai. fancy nahi hai but reliable and consistent enough" },
            { rating: 4, comment: "diameter consistency good hai. multiple points check kiya. all within very tight range" },
            { rating: 4, comment: "prints cleanly. colours close to accurate. one spool mein minor tangle tha. one star off" },
            { rating: 4, comment: "non critical prints ke liye use karta hoon. kaam karta hai theek se" },
            { rating: 4, comment: "good everyday filament. nothing flashy. existing settings pe kaam karta hai" },
            { rating: 4, comment: "friend ne recommend kiya tha. ab samajh aaya kyun. quality reliable hai aur price fair" },
            { rating: 4, comment: "8 spools ho gaye abhi tak. sab consistent. will continue ordering from ProtoDesign" },
            { rating: 4, comment: "PETG is bhrand ka achha behave karta hai. good interlayer adhesion and minimal warping" },
            { rating: 4, comment: "good value. colour options solid hain. print results clean aate hain" },
            { rating: 4, comment: "good quality control. filament dry hai pack se. prints without popping or hissing" },
            { rating: 4, comment: "layer adhesion good hai. parts previous brand se zyada strong hain" },
            { rating: 4, comment: "normal settings pe clean prints. minor temp tweaking needed. solid product" },
            { rating: 4, comment: "value pack ka deal acha hai. sab spools mein quality consistent rahi" },
            { rating: 4, comment: "no moisture issues. good surface finish. reliable feeding throughout the spool" },
            { rating: 4, comment: "mara everyday filament bani gayo che hve. reliable enough for most things. good price" },
            { rating: 4, comment: "happy with the purchase. matte finish options look very good on printed parts" },

            // ── 5 × 3 STAR ──
            { rating: 3, comment: "average filament. kaam karta hai but stringing zyada hai even after retraction tuning" },
            { rating: 3, comment: "diameter spool ke alag alag hisson mein thoda vary karta hai. detailed prints mein noticeable" },
            { rating: 3, comment: "basic prints ke liye decent hai. kuch important print karna ho toh dusra brand use karta hoon" },
            { rating: 3, comment: "just okay. similar price pe better results mile hain doosre brands se" },
            { rating: 3, comment: "kaam karta hai but kuch khaas nahi. next order mein kuch aur try karunga" },
        ];

        const resinReviews = [
            // ── 20 × 5 STAR ──
            { rating: 5, comment: "is price range mein itna sharp print pehle kabhi nahi dekha. miniature details unbelievable hain" },
            { rating: 5, comment: "smell kam hai doosre brands ke comparison mein. cures fast aur surface very smooth hai" },
            { rating: 5, comment: "dental models ke liye use kar raha hoon. accuracy excellent hai. very impressed for the price" },
            { rating: 5, comment: "ABS like variant is phenomenal bhai. strong slightly flexible. perfect for functional resin parts" },
            { rating: 5, comment: "jewellery casting patterns ke liye use kiya. burnout clean tha. detail retention excellent" },
            { rating: 5, comment: "water washable genuinely better hai. IPA ka jhanjhat khatam. quality matches standard resin" },
            { rating: 5, comment: "transparent resin crystal clear aata hai curing ke baad. light pipe project ke liye perfect tha" },
            { rating: 5, comment: "brand switch kiya. success rate 70% se 90%+ ho gayi. bahut bada fark hai" },
            { rating: 5, comment: "miniatures ke liye best resin at this price. no contest. bulk mein order karunga ab se" },
            { rating: 5, comment: "FEP wear bahut kam hai is resin se. 3 months printing aur FEP abhi bhi new jaisa lagta hai" },
            { rating: 5, comment: "printer aur resin ek saath ProtoDesign se order kiya. dono same day aaye. smooth experience" },
            { rating: 5, comment: "grey engineering resin is smooth walls deto. design review aur presentation models ke liye best" },
            { rating: 5, comment: "3 baar order kiya. quality consistent rahi hamesha. reliable brand hai ye" },
            { rating: 5, comment: "Photon Mono pe default settings pe first try mein perfect print. koi tuning nahi karna pada" },
            { rating: 5, comment: "1KG bottle good value hai. quality bottle ke end tak consistent rahi. no degradation" },
            { rating: 5, comment: "post cure ke baad dimensional accuracy bahut achhi hai. engineering parts correctly measure hote hain" },
            { rating: 5, comment: "fine detail work ke liye best resin I've used. is price pe koi competition nahi" },
            { rating: 5, comment: "cure time exactly as stated. exposure variations ke liye forgiving hai. easy to work with" },
            { rating: 5, comment: "zero delamination issues. excellent adhesion layer after layer. no print failures" },
            { rating: 5, comment: "printer ni native resolution pe detail retention unreal che. drek surface texture saras print thay che" },

            // ── 25 × 4 STAR ──
            { rating: 4, comment: "good resin. FEP life improved since switching to this. less suction effect noticed" },
            { rating: 4, comment: "nice consistency. shake well and use. Elegoo Saturn pe default settings pe achha print aaya" },
            { rating: 4, comment: "good product. packaging sealed properly. no leakage. print quality solid" },
            { rating: 4, comment: "solid resin for the price. good layer resolution. not overly brittle after proper curing" },
            { rating: 4, comment: "layer adhesion strong hai. abhi tak koi delamination nahi hua" },
            { rating: 4, comment: "minis ke liye very good. detail clearly aata hai. smell thoda zyada tha expected se. one star off" },
            { rating: 4, comment: "reliable resin. meri current settings pe bina zyada adjustment ke print ho jaata hai" },
            { rating: 4, comment: "good detail resolution. medium complexity models ke liye achha kaam karta hai" },
            { rating: 4, comment: "quality se khush hoon. dimensional accuracy good hai meri most prints ke liye" },
            { rating: 4, comment: "solid everyday resin. nothing extraordinary but consistent and reliable. good price" },
            { rating: 4, comment: "water washable variant works well. standard se thoda brittle hai but very convenient" },
            { rating: 4, comment: "curing ke baad colour accuracy good hai. grey is true neutral grey, not off white. very useful" },
            { rating: 4, comment: "different orders mein consistent quality. quality control achha lagta hai. reliable to stock up" },
            { rating: 4, comment: "Anycubic Photon pe use kiya. cleanly prints without much dialing in. good compatibility" },
            { rating: 4, comment: "good mechanical properties. budget alternatives se kam brittle hai" },
            { rating: 4, comment: "prototyping ke liye excellent hai. clean finish aur fast cure makes iteration quick" },
            { rating: 4, comment: "fine detail bahut achha print hota hai. is price pe one of the better resins I've tried" },
            { rating: 4, comment: "surface finish smooth hai. proper post processing ke baad parts professional dikhte hain" },
            { rating: 4, comment: "general purpose printing ke liye good hai. wide range of models handle karta hai" },
            { rating: 4, comment: "clear variant mein good transparency after UV curing. perfect optical clarity nahi hai but very good" },
            { rating: 4, comment: "display models aur light functional use ke liye strong enough. good balance for price" },
            { rating: 4, comment: "constant parameter chasing ke bina good results milte hain. easy to use" },
            { rating: 4, comment: "kaafi bottles ho gayi hain. quality consistent rahi hamesha. main resin ban gaya hai mera" },
            { rating: 4, comment: "good layer adhesion. minor elephant footing on first layers but manageable" },
            { rating: 4, comment: "default se thoda kam exposure pe bahut achha result aata hai. overall good resin" },

            // ── 5 × 3 STAR ──
            { rating: 3, comment: "decent resin but datasheet mein jo exposure settings thi wo off thi. bahut experimenting karna pada" },
            { rating: 3, comment: "average quality. layer lines previous brand se zyada visible hain. nothing special" },
            { rating: 3, comment: "okay product but price premium justify nahi hota. cheaper alternatives bhi same print dete hain" },
            { rating: 3, comment: "kaam karta hai. but itne achhe reviews ke baad zyada umeed thi. middle of the road hai" },
            { rating: 3, comment: "print quality acceptable hai but description se zyada expect kar liya tha. alternatives dekhna padega" },
        ];

        const accessoryReviews = [
            // ── 20 × 5 STAR ──
            { rating: 5, comment: "quality clearly better hai random alternatives se jo pehle try kiye the. works perfectly" },
            { rating: 5, comment: "ye upgrade lagane ke baad print quality mein immediately fark dikha. pehle kyun nahi liya" },
            { rating: 5, comment: "aisa accessory hai jo lagane ke baad sochte ho ke bina kaise kaam karte the. instant improvement" },
            { rating: 5, comment: "weeks se jo problem aa rahi thi wo solve ho gayi. ab perfectly kaam kar raha hai" },
            { rating: 5, comment: "printer performance visibly improved after installation. same setup wale sabko recommend karunga" },
            { rating: 5, comment: "excellent build quality. cheap copy nahi hai ye. several months ho gaye. still working perfectly" },
            { rating: 5, comment: "har 3D printing setup mein ye hona chahiye. process bahut smooth ho jaata hai isse" },
            { rating: 5, comment: "4 months. zero issues. ProtoDesign pe proper quality milti hai knockoffs nahi" },
            { rating: 5, comment: "chota purchase tha but workflow mein bahut bada practical difference aaya" },
            { rating: 5, comment: "printer is much better since I installed this. well worth the money" },
            { rating: 5, comment: "install easy tha aur improvement immediate tha. koi adjustment nahi karna pada. great product" },
            { rating: 5, comment: "friend ne recommend kiya tha jo same printer use karta hai. exactly as described" },
            { rating: 5, comment: "ProtoDesign accessories multiple times li hain. quality hamesha consistent rahi. trust this store" },
            { rating: 5, comment: "noticeable quality upgrade for the price. nothing feels cheap about it. very satisfied" },
            { rating: 5, comment: "pehli baar mein hi fit ho gaya perfectly. na oversized na undersized. exactly right" },
            { rating: 5, comment: "3 months daily use. zero issues. will order again when this one eventually wears out" },
            { rating: 5, comment: "functional aur well made. ek kaam karta hai aur sahi karta hai" },
            { rating: 5, comment: "15 minute install. performance improvement was immediate and obvious. very happy" },
            { rating: 5, comment: "good design. robust enough for regular use. quality component jaisa feel hota hai" },
            { rating: 5, comment: "exactly what was described in listing. no surprises. right product right quality right price" },

            // ── 25 × 4 STAR ──
            { rating: 4, comment: "good quality. fits exactly as described. does what it should. happy overall" },
            { rating: 4, comment: "solid build. 2 months flawlessly. no signs of wear at all" },
            { rating: 4, comment: "easily installs. works as expected. minor cosmetic difference from OEM but functionally fine" },
            { rating: 4, comment: "securely packed. no damage. works exactly as expected" },
            { rating: 4, comment: "exactly what it claims. compatible with my setup. good value for what it does" },
            { rating: 4, comment: "same function as OEM at lower price. will order again when needed" },
            { rating: 4, comment: "compatible as listed. quality comparable to what came with printer originally" },
            { rating: 4, comment: "actually works as advertised. fast shipping and good packaging. happy purchase" },
            { rating: 4, comment: "works reliably. chhote cosmetic marks shipping se but nothing functional" },
            { rating: 4, comment: "marginal improvement but consistent. no complaints at this price point" },
            { rating: 4, comment: "fit correct first time. no modifications needed. works as it should" },
            { rating: 4, comment: "6 weeks use. no signs of degradation. good quality materials used" },
            { rating: 4, comment: "kaam achha karta hai. flashy nahi hai but practical aur properly made. good purchase" },
            { rating: 4, comment: "easy install. good compatibility. minor difference from original but functionally identical" },
            { rating: 4, comment: "price fair hai quality ke liye. works reliably. happy with it" },
            { rating: 4, comment: "works as described. packaging minimal but protective. arrived in good condition" },
            { rating: 4, comment: "solid accessory. does what its supposed to. straightforward install. satisfied" },
            { rating: 4, comment: "daily use ke liye good product. holds up well. installation instructions thodi vague thi" },
            { rating: 4, comment: "reliable. day one se koi issue nahi aaya. that's all I want" },
            { rating: 4, comment: "good compatibility with my printer model. works exactly as described" },
            { rating: 4, comment: "quality is there. does its job without any fuss. reasonable price. would buy again" },
            { rating: 4, comment: "not cheapest but quality clearly better than the budget alternatives" },
            { rating: 4, comment: "install kiya, kaam kiya, no issues. that's all I want from an accessory honestly" },
            { rating: 4, comment: "minor improvement but consistent one. printer more reliably running since I installed this" },
            { rating: 4, comment: "well made. proper fitment. one specific aspect of printing noticeably improved" },

            // ── 5 × 3 STAR ──
            { rating: 3, comment: "kaam karta hai but instructions helpful nahi thi. install mein bahut time laga unnecessarily" },
            { rating: 3, comment: "marginal improvement at best. reviews padh ke zyada expect kar liya tha shayad" },
            { rating: 3, comment: "listed compatible hai mera printer model ke liye but fit slightly off hai. functional but not ideal" },
            { rating: 3, comment: "theek hai. reviews se zyada impact expect kiya tha. decent but not essential" },
            { rating: 3, comment: "average quality. kaam karta hai. similar products se kuch alag nahi hai isme" },
        ];

        const sparePartReviews = [
            // ── 20 × 5 STAR ──
            { rating: 5, comment: "sahi part, sahi price. fit perfect tha. printer wapas normal chal raha hai. very happy" },
            { rating: 5, comment: "exact replacement needed tha. 15 minute install. printer back to full performance" },
            { rating: 5, comment: "ProtoDesign pe stock tha jab locally kuch nahi mila. bahut time bacha liya" },
            { rating: 5, comment: "thermistor accurate hai. swap ke baad temperature immediately stabilise ho gayi" },
            { rating: 5, comment: "worn drive gear replace kiya. underextrusion aur slipping bilkul khatam. works perfectly" },
            { rating: 5, comment: "nozzle quality excellent hai. install ke baad se clean prints aur consistent flow" },
            { rating: 5, comment: "printer bach gaya. part as described tha. simple swap. printer like new again" },
            { rating: 5, comment: "OEM quality replacement at fair price. fit and finish identical to original" },
            { rating: 5, comment: "heat block replace kiya. thermal runaway issue fix ho gaya. proper quality material for price" },
            { rating: 5, comment: "exactly the part I needed. listed correctly for my printer model. arrived fast" },
            { rating: 5, comment: "high quality belt. tension better than original. prints visibly cleaner now" },
            { rating: 5, comment: "PTFE tube sahi inner diameter ka hai. hot end connection pe koi gap nahi. great fit" },
            { rating: 5, comment: "genuine quality part. cheap copy nahi hai. months of daily use aur still going strong" },
            { rating: 5, comment: "perfectly matched my printer model. no modifications. just installed and printed" },
            { rating: 5, comment: "spare parts pe fast delivery. printer 24 hours se kam mein wapas chal gaya. excellent" },
            { rating: 5, comment: "heater cartridge exactly right wattage pe kaam karta hai. temps immediately normal ho gaye" },
            { rating: 5, comment: "nozzle pe correct thread hai. pehli baar replacement perfectly fit hua bina kisi issue ke" },
            { rating: 5, comment: "extruder arm replace kiya. filament grip noticeably better hai ab. slipping bilkul nahi" },
            { rating: 5, comment: "cooling fan replacement is quieter than original and cools just as effectively. win win" },
            { rating: 5, comment: "good quality spare. 2 months daily use since swap. not a single issue" },

            // ── 25 × 4 STAR ──
            { rating: 4, comment: "good quality spare part. installed without issues. printer working normally again" },
            { rating: 4, comment: "listed ke according compatible hai. quality original jaisi lagti hai. good deal" },
            { rating: 4, comment: "kaam karta hai. OEM se thoda alag dikhta hai but functionally identical" },
            { rating: 4, comment: "decent replacement. immediately worked after install. minor cosmtic difference from stock" },
            { rating: 4, comment: "part well packaged aaya. fit correctly. printer printing normally again" },
            { rating: 4, comment: "good spare part for the price. works as expected. shipping was prompt" },
            { rating: 4, comment: "functional replacement. not quite OEM quality but solid option for the price" },
            { rating: 4, comment: "part aane ke ek ghante mein printer wapas chal gaya. part fit correct tha first try" },
            { rating: 4, comment: "reliable part. 6 weeks daily use. no issues so far" },
            { rating: 4, comment: "correct specs for my printer. works correctly. no installation guide tha that's the only thing" },
            { rating: 4, comment: "good value replacement. original ke jaisa performance significantly lower cost pe" },
            { rating: 4, comment: "part quality good hai. few minutes mein swap kiya. printer back to normal" },
            { rating: 4, comment: "right part on time. installed cleanly. printer running properly again" },
            { rating: 4, comment: "solid build quality for a spare part. cheap nahi lagta. should last reasonable time" },
            { rating: 4, comment: "exact match for my printer. 20 minutes install. everything working correctly" },
            { rating: 4, comment: "reliable spare. replaced part daily use mein hai abhi. no issues so far" },
            { rating: 4, comment: "good replacement nozzle. worn one change karne ke baad print quality noticeably improved" },
            { rating: 4, comment: "part fits and functions correctly. packaging good tha. delivery on time" },
            { rating: 4, comment: "good quality for the price. ProtoDesign se hi spare parts lunga aage bhi" },
            { rating: 4, comment: "quick delivery. correct part. printer back in service. no complaints" },
            { rating: 4, comment: "decent spare. works correctly. one star off because no instructions included" },
            { rating: 4, comment: "compatible as described. installed without modification. printer functions normally" },
            { rating: 4, comment: "good spare. not OEM but same performance. price better than buying from manufacturer" },
            { rating: 4, comment: "quickly arrived. fit correct. reliably working since installation" },
            { rating: 4, comment: "solid replacement part. good quality. printer performance back to what it was" },

            // ── 5 × 3 STAR ──
            { rating: 3, comment: "part kaam karta hai but original se thoda loose fit hai. functional but not ideal" },
            { rating: 3, comment: "kaam karta hai. quality acceptable hai but OEM ke level ka nahi hai" },
            { rating: 3, comment: "late aaya aur packaging minimal tha. part itself works fine but service average tha" },
            { rating: 3, comment: "replacement way me kaam karta hai but material quality printer ke saath aaye part se thodi si lower end pe hai. Overall not bad, will be a returning customer" },
            { rating: 3, comment: "Functional but 5 months mein wear visible hai. Not sure how long this one will last. Hope around 1 and half year chal jaye" },
        ];


        // ─── 3. HUMANIZE — subtle, ~30% of reviews ───────────────────
        function humanize(text) {
            if (Math.random() > 0.30) return text;
            let r = text;
            // Drop trailing period (~25%)
            if (Math.random() < 0.25 && r.endsWith('.')) r = r.slice(0, -1);
            // Lowercase first char (~15%)
            if (Math.random() < 0.15) r = r.charAt(0).toLowerCase() + r.slice(1);
            return r;
        }


        // ─── 4. SEED ─────────────────────────────────────────────────
        const products = await db.any(
            'SELECT id, category FROM products WHERE is_archived = false OR is_archived IS NULL'
        );

        const usedComments = new Set();
        const userReviewCount = {};
        for (const name of dummyNames) userReviewCount[name] = 0;

        let addedCount = 0;

        for (const p of products) {
            const numReviews = Math.floor(Math.random() * 3) + 3; // 3–5 per product

            let bank;
            const cat = (p.category || '').toLowerCase();
            if (cat === '3d_printer')       bank = [...printerReviews];
            else if (cat === '3dprintables') bank = [...printablesReviews];
            else if (cat === 'filament')     bank = [...filamentReviews];
            else if (cat === 'resin')        bank = [...resinReviews];
            else if (cat === 'spare_part')   bank = [...sparePartReviews];
            else                             bank = [...accessoryReviews]; // accessory + fallback

            bank.sort(() => 0.5 - Math.random());

            const eligibleNames = dummyNames
                .filter(n => userReviewCount[n] < 2)
                .sort(() => 0.5 - Math.random());

            let reviewsAdded = 0;

            for (const name of eligibleNames) {
                if (reviewsAdded >= numReviews) break;
                if (bank.length === 0) break;

                const uid = userMap[name];
                const already = await db.oneOrNone(
                    'SELECT id FROM reviews WHERE product_id = $1 AND user_id = $2',
                    [p.id, uid]
                );
                if (already) continue;

                // Pick a comment not yet used globally
                let reviewData = null;
                for (let i = 0; i < bank.length; i++) {
                    if (!usedComments.has(bank[i].comment)) {
                        reviewData = bank[i];
                        bank.splice(i, 1);
                        break;
                    }
                }
                if (!reviewData) continue;

                const finalComment = humanize(reviewData.comment);
                usedComments.add(reviewData.comment);

                const daysAgo = Math.floor(Math.random() * 75) + 1;
                const reviewDate = new Date();
                reviewDate.setDate(reviewDate.getDate() - daysAgo);

                await db.none(
                    'INSERT INTO reviews (product_id, user_id, rating, comment, created_at) VALUES ($1, $2, $3, $4, $5)',
                    [p.id, uid, reviewData.rating, finalComment, reviewDate]
                );

                userReviewCount[name]++;
                reviewsAdded++;
                addedCount++;
            }

            // Update product rating aggregate
            const stats = await db.one(
                'SELECT ROUND(AVG(rating)::numeric, 2) as avg, COUNT(id) as count FROM reviews WHERE product_id = $1',
                [p.id]
            );
            await db.none(
                'UPDATE products SET average_rating = $1, review_count = $2 WHERE id = $3',
                [parseFloat(stats.avg) || 0, parseInt(stats.count), p.id]
            );
        }

        res.json({
            success: true,
            message: `Successfully injected ${addedCount} reviews across ${products.length} products.`
        });

    } catch (error) {
        console.error('Seeder Error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
