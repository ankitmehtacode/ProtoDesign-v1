import express from 'express';
import authMiddleware from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

// ==========================================
// 👤 PROFILE ROUTES
// ==========================================

router.get('/profile', authMiddleware, async (req, res, next) => {
    try {
        const user = await db.oneOrNone(
            `SELECT u.id, u.email, u.full_name, u.phone_number, u.avatar_url, r.role
             FROM users u
                      LEFT JOIN user_roles r ON u.id = r.user_id
             WHERE u.id = $1`,
            [req.userId]
        );
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) { next(err); }
});

router.put('/profile', authMiddleware, async (req, res, next) => {
    try {
        const { fullName, phoneNumber, avatarUrl } = req.body;
        const user = await db.one(
            `UPDATE users
             SET full_name = COALESCE($1, full_name),
                 phone_number = COALESCE($2, phone_number),
                 avatar_url = COALESCE($3, avatar_url)
             WHERE id = $4
                 RETURNING id, email, full_name, phone_number, avatar_url`,
            [
                fullName !== undefined ? fullName : null,
                phoneNumber !== undefined ? phoneNumber : null,
                avatarUrl !== undefined ? avatarUrl : null,
                req.userId
            ]
        );
        res.json(user);
    } catch (err) { next(err); }
});

// ==========================================
// 🏠 ADDRESS ROUTES
// ==========================================

router.get('/addresses', authMiddleware, async (req, res, next) => {
    try {
        const addresses = await db.any('SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC', [req.userId]);
        res.json(addresses);
    } catch (err) { next(err); }
});

router.post('/addresses', authMiddleware, async (req, res, next) => {
    try {
        const { city, state, pincode, isDefault, label, email } = req.body;
        const fullName = req.body.fullName || req.body.full_name;
        const phone = req.body.phone || req.body.phoneNumber;
        const addressLine1 = req.body.addressLine1 || req.body.address_line1;

        if (isDefault) {
            await db.none('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.userId]);
        }

        const newAddr = await db.one(
            `INSERT INTO user_addresses (user_id, full_name, phone, email, address_line1, city, state, pincode, is_default, label)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [req.userId, fullName, phone, email, addressLine1, city, state, pincode, isDefault || false, label || 'Home']
        );
        res.status(201).json(newAddr);
    } catch (err) { next(err); }
});

router.put('/addresses/:id', authMiddleware, async (req, res, next) => {
    try {
        const { city, state, pincode, isDefault, label, email } = req.body;
        const fullName = req.body.fullName || req.body.full_name;
        const phone = req.body.phone || req.body.phoneNumber;
        const addressLine1 = req.body.addressLine1 || req.body.address_line1;

        if (isDefault) {
            await db.none('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.userId]);
        }

        const updated = await db.one(
            `UPDATE user_addresses
             SET full_name=$1, phone=$2, email=$3, address_line1=$4, city=$5, state=$6, pincode=$7, is_default=$8, label=$9, updated_at=NOW()
             WHERE id=$10 AND user_id=$11
                 RETURNING *`,
            [fullName, phone, email, addressLine1, city, state, pincode, isDefault || false, label || 'Home', req.params.id, req.userId]
        );
        res.json(updated);
    } catch (err) { next(err); }
});

router.delete('/addresses/:id', authMiddleware, async (req, res, next) => {
    try {
        await db.none('DELETE FROM user_addresses WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        res.json({ message: 'Address deleted' });
    } catch (err) { next(err); }
});

// ==========================================
// 📦 SAVED MODELS
// ==========================================
router.get('/models', authMiddleware, async (req, res, next) => {
    try {
        const models = await db.any('SELECT * FROM saved_models WHERE user_id = $1 ORDER BY created_at DESC', [req.userId]);
        res.json(models);
    } catch (err) { next(err); }
});

export default router;
