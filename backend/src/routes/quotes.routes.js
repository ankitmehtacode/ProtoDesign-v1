import express from 'express';
import nodemailer from 'nodemailer';
import db from '../config/database.js';
import { storageService } from '../services/storage.service.js';
import authMiddleware from '../middleware/auth.js';
import isAdmin from '../middleware/isAdmin.js';
import { notifyQuote } from '../services/whatsapp.service.js';

const router = express.Router();

// No multer here any more. Models are uploaded by the browser straight to S3
// using a presigned URL minted by POST /upload-url; this route only ever sees
// the resulting object key, which keeps every request well under Lambda's 6MB
// payload ceiling.

// 2. Email Configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ✅ GET MY QUOTES
router.get('/my', authMiddleware, async (req, res) => {
    try {
        // Fetch by user_id
        const quotes = await db.any('SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC', [req.userId]);
        res.json(quotes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Step 1 of the upload flow: mint a presigned PUT so the browser can send the
 * model directly to S3. Validation of type and size happens here, at signing
 * time, so an oversized or unsupported file is rejected before any bytes move.
 */
router.post('/upload-url', authMiddleware, async (req, res, next) => {
    try {
        const { filename, contentType, contentLength } = req.body || {};
        const result = await storageService.createModelUploadUrl({
            userId: req.userId,
            filename,
            contentType,
            contentLength
        });
        res.json(result);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

/**
 * Step 2: record the quote. The client sends the key it was given, never a URL
 * and never file bytes.
 */
router.post('/request', authMiddleware, async (req, res, next) => {
    try {
        const { email, phone, notes, specifications, fileKey, fileName } = req.body || {};

        if (!fileKey || !fileName) {
            return res.status(400).json({ error: 'fileKey and fileName are required' });
        }

        // The key is namespaced by user at signing time; re-check it here so a
        // caller cannot attach someone else's model to their own quote.
        if (!String(fileKey).startsWith(`quotes/models/${req.userId}/`)) {
            return res.status(403).json({ error: 'That file does not belong to you' });
        }

        // Confirm the object exists rather than trusting the client's word that
        // the upload succeeded -- otherwise a quote can reference nothing.
        const stat = await storageService.statModel(fileKey);
        if (!stat) {
            return res.status(400).json({ error: 'Upload not found. Please upload the file again.' });
        }

        const file = { originalname: fileName, size: stat.contentLength };
        const fileUrl = fileKey;

        // 2. Parse Specifications
        let specs = {};
        try {
            specs = typeof specifications === 'string' ? JSON.parse(specifications) : specifications;
        } catch (e) {
            console.error("Spec Parse Error", e);
            specs = {};
        }

        const estPrice = specs.estimatedPrice || 0;
        const modelStats = specs.originalStats || {};
        const printDims = specs.printDimensions || {};

        // 3. Insert into DB (LINK TO LOGGED IN USER: req.userId)
        const quote = await db.one(`
            INSERT INTO quotes (user_id, email, phone, file_url, file_name, specifications, estimated_price, admin_notes, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING id
        `, [req.userId, email, phone, fileUrl, file.originalname, specs, estPrice, notes]);

        // 4. Prepare Email Content (The "Dark Theme" Format)
        const adminHtml = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto; border-radius: 8px; overflow: hidden; background-color: #0f172a; color: #e2e8f0;">
                
                <div style="background-color: #1e293b; padding: 20px; text-align: center; border-bottom: 2px solid #3b82f6;">
                    <h2 style="color: #ffffff; margin: 0;">New 3D Printing Request</h2>
                </div>
                
                <div style="padding: 25px;">
                    
                    <div style="background: #1e293b; padding: 15px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #3b82f6;">
                        <h3 style="margin-top: 0; color: #93c5fd; font-size: 16px; margin-bottom: 10px;">👤 Customer Details</h3>
                        <p style="margin: 5px 0; color: #cbd5e1;"><strong>User ID:</strong> ${req.userId}</p>
                        <p style="margin: 5px 0; color: #cbd5e1;"><strong>Email:</strong> <a href="mailto:${email}" style="color: #60a5fa;">${email}</a></p>
                        <p style="margin: 5px 0; color: #cbd5e1;"><strong>Phone:</strong> ${phone}</p>
                    </div>

                    <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                        
                        <div style="flex: 1; background: #172554; padding: 15px; border-radius: 6px; border: 1px solid #1e3a8a;">
                            <h3 style="margin-top: 0; color: #60a5fa; font-size: 15px; margin-bottom: 10px;">⚙️ Settings</h3>
                            <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px; color: #e2e8f0;">
                                <li style="margin-bottom: 6px;"><strong>Material:</strong> ${specs.material}</li>
                                <li style="margin-bottom: 6px;"><strong>Quality:</strong> ${specs.quality}</li>
                                <li style="margin-bottom: 6px;"><strong>Infill:</strong> ${specs.infill}</li>
                                <li style="margin-bottom: 6px;"><strong>Scale:</strong> ${specs.scale || '100%'}</li>
                            </ul>
                        </div>
                        
                        <div style="flex: 1; background: #27272a; padding: 15px; border-radius: 6px; border: 1px solid #3f3f46;">
                            <h3 style="margin-top: 0; color: #fb923c; font-size: 15px; margin-bottom: 10px;">📊 Model Analysis</h3>
                            <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px; color: #e2e8f0;">
                                <li style="margin-bottom: 6px;"><strong>Volume:</strong> ${modelStats.volume?.toFixed(2) || 0} cm³</li>
                                <li style="margin-bottom: 6px;"><strong>Weight:</strong> ${specs.estimatedWeight || 'N/A'}</li>
                                <li style="margin-bottom: 6px;"><strong>Polygons:</strong> ${specs.polygonCount ? specs.polygonCount.toLocaleString() : 'N/A'}</li>
                                <li style="margin-bottom: 6px;"><strong>Rotation:</strong> ${specs.rotation || '0,0,0'}</li>
                            </ul>
                        </div>
                    </div>

                    <div style="background: #1e293b; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                        <h3 style="margin-top: 0; color: #facc15; font-size: 16px; margin-bottom: 5px;">✏️ Final Dimensions</h3>
                        <p style="font-family: monospace; font-size: 16px; margin: 0; color: #ffffff;">
                            ${printDims.x} x ${printDims.y} x ${printDims.z} cm
                        </p>
                    </div>

                    <div style="border: 1px dashed #475569; padding: 15px; border-radius: 6px; margin-bottom: 25px;">
                         <h3 style="margin-top: 0; color: #94a3b8; font-size: 15px; margin-bottom: 5px;">📝 Customer Notes</h3>
                         <p style="font-style: italic; color: #cbd5e1; margin: 0;">"${notes || "None provided"}"</p>
                    </div>

                    <div style="text-align: center; padding-top: 10px;">
                        <div style="display: inline-block; padding: 12px 25px; background-color: #334155; border-radius: 50px;">
                            <span style="font-weight: bold; color: #94a3b8; margin-right: 15px;">Est. Time: ${specs.estimatedTime}</span>
                            <span style="font-weight: bold; color: #ffffff; font-size: 18px;">Total: ₹${specs.estimatedPrice}</span>
                        </div>
                    </div>
                </div>
                
                <div style="background-color: #1e293b; padding: 12px; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #334155;">
                    <a href="${fileUrl}" style="color: #60a5fa; text-decoration: none; font-weight: bold;">Download ${file.originalname}</a> • ${(file.size / 1024 / 1024).toFixed(2)} MB
                </div>
            </div>
        `;

        // ----------------------------------------------------
        // 5. Send Admin Email
        // ----------------------------------------------------
        const adminMail = transporter.sendMail({
            from: `"ProtoDesign System" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, // Send to Admin
            subject: `New Request: ${file.originalname} - ₹${specs.estimatedPrice}`,
            html: adminHtml
            // The model is no longer attached: the server never receives the
            // bytes. It is retrieved on demand from the admin dashboard via
            // GET /api/quotes/:id/download, which issues a short-lived URL.
        }).catch(err => console.error(JSON.stringify({
            event: 'email_failed', type: 'quote_admin', file: file.originalname, error: err.message
        })));


        // ----------------------------------------------------
        // 6. Send Customer Confirmation Email
        // ----------------------------------------------------
        const customerHtml = `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2563eb;">🚀 We received your request!</h2>
                <p>Hi there,</p>
                <p>Thank you for submitting your model <strong>${file.originalname}</strong>.</p>
                
                <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Estimated Price:</strong> ₹${specs.estimatedPrice}</p>
                    <p><strong>Next Steps:</strong> Our engineers are reviewing the file for printability. We will contact you soon.</p>
                </div>

                <p>Best regards,<br><strong>The ProtoDesign Team</strong></p>
            </div>
        `;

        // ✅ Removed 'await' so UI doesn't freeze
        const customerMail = transporter.sendMail({
            from: `"ProtoDesign" <${process.env.EMAIL_USER}>`,
            to: email, 
            subject: `Order Received: ${file.originalname}`,
            html: customerHtml
        }).catch(err => console.error(JSON.stringify({
            event: 'email_failed', type: 'quote_customer', to: email, error: err.message
        })));

        // Both sends are awaited together rather than left dangling. Lambda freezes
        // the environment the moment the response returns, so a background promise
        // here simply never completes. allSettled keeps a mail failure from failing
        // the quote itself, while the .catch handlers above keep it observable.
        await Promise.allSettled([adminMail, customerMail]);

        // quoteId lets the page offer "Get updates on WhatsApp" for this quote.
        res.json({ success: true, message: "Quote requested successfully", quoteId: quote.id });

    } catch (error) {
        console.error('Quote Process Error:', error);
        res.status(500).json({ error: 'Failed to process quote' });
    }
});

/**
 * Issue a short-lived download URL for a stored model.
 *
 * The bucket is private -- customer models are proprietary designs -- so access
 * is granted per request to the quote's owner or an admin, rather than by making
 * objects publicly readable.
 */
router.get('/:id/download', authMiddleware, async (req, res, next) => {
    try {
        const quote = await db.oneOrNone(
            'SELECT id, user_id, file_url, file_name FROM quotes WHERE id = $1',
            [req.params.id]
        );
        if (!quote) return res.status(404).json({ error: 'Quote not found' });

        const owns = quote.user_id === req.userId;
        if (!owns) {
            const adminRow = await db.oneOrNone(
                'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
                [req.userId, 'admin']
            );
            if (!adminRow) return res.status(403).json({ error: 'Not permitted' });
        }

        const url = await storageService.createModelDownloadUrl(quote.file_url, quote.file_name);
        res.json({ url, expiresIn: 300 });
    } catch (error) {
        next(error);
    }
});

// ADMIN ROUTES
// These previously had NO authentication: any unauthenticated caller could list
// every customer's email, phone, model and specifications, and change any
// quote's status. Both now require an admin.
router.get('/admin/all', authMiddleware, isAdmin, async (req, res) => {
    try {
        const quotes = await db.any('SELECT * FROM quotes ORDER BY created_at DESC');
        res.json(quotes);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/:id/status', authMiddleware, isAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const updated = await db.oneOrNone(
            'UPDATE quotes SET status = $1 WHERE id = $2 AND status IS DISTINCT FROM $1 RETURNING id',
            [status, req.params.id]
        );
        // Only a real change notifies; re-saving the same status does not.
        if (updated) await notifyQuote(updated.id, status);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

export default router;
