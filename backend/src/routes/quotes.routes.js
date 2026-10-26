import express from 'express';
import nodemailer from 'nodemailer';
import db from '../config/database.js';
import { storageService } from '../services/storage.service.js';
import authMiddleware from '../middleware/auth.js';
import optionalAuthMiddleware from '../middleware/optionalAuth.js';
import isAdmin from '../middleware/isAdmin.js';
import { getConfig as whatsAppConfig, notifyQuote, updatesUrl } from '../services/whatsapp.service.js';
import { alertNewQuote } from '../services/telegram.service.js';
import { quoteAdminEmail, quoteContact, quoteCustomerEmail } from '../services/quote.email.js';
import { GUEST_OWNER, guestQuoteRefusal, lockGuestQuotes, signGuestUpload, verifyGuestUpload } from '../services/guest-quote.js';

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
 *
 * Signed-in customers upload under their own folder. A guest must give an email
 * and phone first (services/guest-quote.js): nothing is uploaded for a visitor
 * the team could not reply to.
 */
router.post('/upload-url', optionalAuthMiddleware, async (req, res, next) => {
    try {
        const { filename, contentType, contentLength } = req.body || {};
        let contact = null;
        if (!req.userId) {
            // Honeypot: a field people never see. No upload URL for bots.
            if (req.body?.website) {
                console.warn(JSON.stringify({ event: 'quote_honeypot_hit' }));
                return res.status(400).json({ error: 'Please try again.' });
            }
            contact = quoteContact(req.body, null);
            if (contact.problem) return res.status(400).json({ error: contact.problem });
            const refusal = await guestQuoteRefusal(db, contact.email);
            if (refusal) return res.status(429).json({ error: refusal });
        }
        const result = await storageService.createModelUploadUrl({
            userId: req.userId || GUEST_OWNER,
            filename,
            contentType,
            contentLength
        });
        if (contact) {
            result.guestToken = signGuestUpload({ key: result.key, email: contact.email, phone: contact.phone, fileName: filename });
            console.log(JSON.stringify({ event: 'guest_upload_url', key: result.key }));
        }
        res.json(result);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

/**
 * Step 2: record the quote. The client sends the key it was given, never a URL
 * and never file bytes. A guest also sends the token that came with the upload
 * URL, which carries the contact they gave before uploading.
 */
router.post('/request', optionalAuthMiddleware, async (req, res, next) => {
    try {
        const { notes, specifications, fileKey, guestToken } = req.body || {};
        let { fileName } = req.body || {};

        if (!fileKey || !fileName) {
            return res.status(400).json({ error: 'fileKey and fileName are required' });
        }

        let contact;
        if (req.userId) {
            // The key is namespaced by user at signing time; re-check it here so a
            // caller cannot attach someone else's model to their own quote.
            if (!String(fileKey).startsWith(`quotes/models/${req.userId}/`)) {
                return res.status(403).json({ error: 'That file does not belong to you' });
            }

            // A quote nobody can be contacted about is no use to the team.
            const account = await db.oneOrNone('SELECT email, full_name, phone_number FROM users WHERE id = $1', [req.userId]);
            contact = quoteContact(req.body, account);
            if (contact.problem) return res.status(400).json({ error: contact.problem });
        } else {
            contact = verifyGuestUpload(guestToken, fileKey);
            if (!contact) return res.status(403).json({ error: 'This upload has expired. Please upload the file again.' });
            // The name the upload was signed for: it goes into emails.
            fileName = contact.fileName;
        }

        // Confirm the object exists rather than trusting the client's word that
        // the upload succeeded -- otherwise a quote can reference nothing.
        const stat = await storageService.statModel(fileKey);
        if (!stat) {
            return res.status(400).json({ error: 'Upload not found. Please upload the file again.' });
        }

        let specs = {};
        try {
            specs = (typeof specifications === 'string' ? JSON.parse(specifications) : specifications) || {};
        } catch (e) {
            console.error("Spec Parse Error", e);
            specs = {};
        }

        const insertQuote = (t) => t.one(`
            INSERT INTO quotes (user_id, email, phone, file_url, file_name, specifications, estimated_price, admin_notes, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING id
        `, [req.userId || null, contact.email, contact.phone, fileKey, fileName, specs, Number(specs.estimatedPrice) || 0, notes]);

        // A guest upload makes one quote, and the caps are checked again under a
        // lock: the cap may have been reached while the model uploaded, and a
        // replayed token must not slip parallel requests past the count.
        let quote;
        if (req.userId) {
            quote = await insertQuote(db);
        } else {
            const outcome = await db.tx(async (t) => {
                await lockGuestQuotes(t);
                if (await t.oneOrNone('SELECT 1 FROM quotes WHERE file_url = $1', [fileKey])) {
                    return { status: 409, error: 'This quote has already been sent.' };
                }
                const refusal = await guestQuoteRefusal(t, contact.email);
                if (refusal) return { status: 429, error: refusal };
                return { quote: await insertQuote(t) };
            });
            if (!outcome.quote) return res.status(outcome.status).json({ error: outcome.error });
            quote = outcome.quote;
        }

        // The model is not attached: the server never receives the bytes. The
        // email links to the admin dashboard, which downloads it on demand via
        // GET /api/quotes/:id/download.
        const adminUrl = `${(process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/$/, '')}/admin?tab=quotes`;
        const adminEmail = quoteAdminEmail({ quoteId: quote.id, contact, fileName, fileSize: stat.contentLength, specs, notes, adminUrl });
        const adminMail = transporter.sendMail({
            from: `"ProtoDesign System" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            replyTo: contact.email,
            ...adminEmail,
        }).catch(err => console.error(JSON.stringify({
            event: 'email_failed', type: 'quote_admin', quoteId: quote.id, error: err.message
        })));

        const customerMail = transporter.sendMail({
            from: `"ProtoDesign" <${process.env.EMAIL_USER}>`,
            to: contact.email,
            ...quoteCustomerEmail({ contact, specs }),
        }).catch(err => console.error(JSON.stringify({
            event: 'email_failed', type: 'quote_customer', quoteId: quote.id, error: err.message
        })));

        // Both sends are awaited together rather than left dangling. Lambda freezes
        // the environment the moment the response returns, so a background promise
        // here simply never completes. allSettled keeps a mail failure from failing
        // the quote itself, while the .catch handlers above keep it observable.
        await Promise.allSettled([adminMail, customerMail,
            alertNewQuote({ quoteId: quote.id, fileName, price: specs.estimatedPrice, contact })]);

        // quoteId lets the page offer "Get updates on WhatsApp" for this quote. A
        // guest cannot call GET /whatsapp/link (it checks ownership by account),
        // so their link comes with this answer.
        const wa = whatsAppConfig();
        res.json({
            success: true, message: "Quote requested successfully", quoteId: quote.id, email: contact.email,
            ...(!req.userId && wa.enabled ? { whatsAppUrl: updatesUrl(wa, 'quote', quote.id) } : {}),
        });

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
