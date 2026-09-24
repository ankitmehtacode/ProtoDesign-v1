// routes/cart.js

import express from 'express';
import db from '../config/database.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/cart - Get user's cart with product details
 */
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.userId;

        const cart = await db.oneOrNone(`
            SELECT
                c.id,
                c.user_id,
                c.created_at,
                c.updated_at,
                COALESCE(
                        json_agg(
                                json_build_object(
                                        'id', ci.id,
                                        'product_id', ci.product_id,
                                        'quantity', ci.quantity,
                                        'product', json_build_object(
                                                'id', p.id,
                                                'name', p.name,
                                                'price', p.price,
                                                'image_url', CASE
                                                                 WHEN p.image_data IS NOT NULL
                                                                     THEN 'data:image/jpeg;base64,' || encode(p.image_data, 'base64')
                                                                 ELSE p.image_url
                                                    END,
                                                'category', p.category,
                                                'stock', p.stock,
                                                'specifications', p.specifications
                                                   )
                                )
                                    ORDER BY ci.created_at
                        ) FILTER (WHERE ci.id IS NOT NULL),
                        '[]'::json
                ) as items
            FROM carts c
                     LEFT JOIN cart_items ci ON c.id = ci.cart_id
                     LEFT JOIN products p ON ci.product_id = p.id
            WHERE c.user_id = $1
            GROUP BY c.id, c.user_id, c.created_at, c.updated_at
        `, [userId]);

        res.json({
            success: true,
            data: cart || { items: [] }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/cart/items - Add item to cart
 */
router.post('/items', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { product_id, quantity = 1 } = req.body;

        if (!product_id) {
            return res.status(400).json({ error: 'product_id required' });
        }

        // Check if product exists and has stock
        const product = await db.oneOrNone(
            'SELECT id, stock FROM products WHERE id = $1',
            [product_id]
        );

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        if (product.stock < quantity) {
            return res.status(400).json({ error: 'Insufficient stock' });
        }

        // Ensure user has a cart
        let cart = await db.oneOrNone('SELECT id FROM carts WHERE user_id = $1', [userId]);
        if (!cart) {
            cart = await db.one('INSERT INTO carts (user_id) VALUES ($1) RETURNING id', [userId]);
        }

        // Upsert cart item
        await db.none(`
            INSERT INTO cart_items (cart_id, product_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (cart_id, product_id) 
            DO UPDATE SET 
                quantity = cart_items.quantity + EXCLUDED.quantity,
                updated_at = now()
        `, [cart.id, product_id, quantity]);

        res.status(201).json({
            success: true,
            message: 'Item added to cart'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/cart/items/:productId - Update cart item quantity
 */
router.put('/items/:productId', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { productId } = req.params;
        const { quantity } = req.body;

        if (quantity === undefined || quantity < 0) {
            return res.status(400).json({ error: 'Valid quantity required' });
        }

        const cart = await db.oneOrNone('SELECT id FROM carts WHERE user_id = $1', [userId]);
        if (!cart) {
            return res.status(404).json({ error: 'Cart not found' });
        }

        await db.none(
            'UPDATE cart_items SET quantity = $1, updated_at = now() WHERE cart_id = $2 AND product_id = $3',
            [quantity, cart.id, productId]
        );

        res.json({
            success: true,
            message: 'Cart item updated'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/cart/items/:productId - Remove item from cart
 */
router.delete('/items/:productId', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { productId } = req.params;

        const cart = await db.oneOrNone('SELECT id FROM carts WHERE user_id = $1', [userId]);
        if (!cart) {
            return res.status(404).json({ error: 'Cart not found' });
        }

        await db.none(
            'DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2',
            [cart.id, productId]
        );

        res.json({
            success: true,
            message: 'Item removed from cart'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/cart - Clear entire cart
 */
router.delete('/', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.userId;

        await db.none(
            'DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)',
            [userId]
        );

        await db.none('DELETE FROM carts WHERE user_id = $1', [userId]);

        res.json({
            success: true,
            message: 'Cart cleared'
        });
    } catch (error) {
        next(error);
    }
});

export default router;
