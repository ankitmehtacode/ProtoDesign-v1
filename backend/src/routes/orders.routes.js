import express from 'express';
import db from '../config/database.js';
import authMiddleware from '../middleware/auth.js';
import isAdmin from '../middleware/isAdmin.js';
import { emailService } from '../services/email.service.js';
import { phonePeService } from '../services/phonepe.service.js';
import { notifyOrder } from '../services/whatsapp.service.js';
import { alertNewOrder, notifyAdmin } from '../services/telegram.service.js';
import {
    PENDING_STATUSES,
    CANCELLABLE_STATUSES,
    cancelOrder,
    createOrder,
    isUuid,
    reconcilePendingOrder,
    reconcilePendingOrders,
    refundOrder
} from '../services/order.service.js';
const router = express.Router();

const REFUND_REFUSALS = {
    not_found: 'Order not found',
    already_refunded: 'This order is already refunded.',
    unpaid: 'This order was never paid, so there is nothing to refund.',
    cash_not_collected: 'Cash on delivery has not been collected for this order, so there is nothing to refund.',
    not_refundable: 'This order cannot be refunded.',
};

// ==========================================
// 🚨 ADMIN ROUTE (MUST BE FIRST)
// ==========================================
router.get('/admin/all', authMiddleware, isAdmin, async (req, res, next) => {
    try {
        const orders = await db.any(`
            SELECT
                o.id, o.created_at, o.status,
                o.total_amount, o.subtotal_amount, o.tax_amount, o.shipping_amount, o.convenience_fee,
                o.shipping_address, o.user_id,
                o.payment_gateway, o.payment_method, o.payment_status,
                u.email as user_email, u.full_name as user_name,
                COALESCE(json_agg(
                                 json_build_object(
                                         'product_id', oi.product_id,
                                         'quantity', oi.quantity,
                                         'line_total', oi.line_total,
                                         'product', json_build_object(
                                                 'name', p.name,
                                                 'image_url', p.image_url
                                            )
                                 )
                         ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
            FROM orders o
                     JOIN users u ON o.user_id = u.id
                     LEFT JOIN order_items oi ON o.id = oi.order_id
                     LEFT JOIN products p ON oi.product_id = p.id
            GROUP BY o.id, u.id
            ORDER BY o.created_at DESC
        `);

        res.json({ success: true, data: orders });
    } catch (error) {
        next(error);
    }
});

// ==========================================
// STANDARD ROUTES
// ==========================================

/**
 * GET /api/orders
 * Get logged-in user's orders. Pending PhonePe orders are re-checked with the
 * gateway first, so the list reflects a payment made moments ago even if the
 * webhook has not arrived.
 */
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const orders = await db.any(`
            SELECT
                o.id, o.created_at, o.status,
                o.total_amount, o.subtotal_amount, o.tax_amount, o.shipping_amount, o.convenience_fee,
                o.shipping_address, o.payment_gateway, o.payment_method,
                COALESCE(json_agg(
                                 json_build_object(
                                         'product_id', oi.product_id,
                                         'quantity', oi.quantity,
                                         'price', oi.price,
                                         'line_total', oi.line_total,
                                         'product_name', p.name,
                                         'product_image', p.image_url
                                 )
                         ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
            FROM orders o
                     LEFT JOIN order_items oi ON o.id = oi.order_id
                     LEFT JOIN products p ON oi.product_id = p.id
            WHERE o.user_id = $1
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `, [req.userId]);

        const pendingIds = orders
            .filter((o) => PENDING_STATUSES.includes(o.status) && o.payment_gateway?.toLowerCase() === 'phonepe')
            .map((o) => o.id);

        if (pendingIds.length > 0) {
            await reconcilePendingOrders(pendingIds);
            // Re-read rather than infer from the outcome: a webhook may have
            // settled the order while we were talking to the gateway.
            const fresh = await db.any('SELECT id, status FROM orders WHERE id IN ($1:csv)', [pendingIds]);
            const statusById = new Map(fresh.map((o) => [o.id, o.status]));
            for (const order of orders) {
                if (statusById.has(order.id)) order.status = statusById.get(order.id);
            }
        }

        res.json({ success: true, data: orders });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/orders/:id
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(404).json({ error: 'Order not found' });

        const order = await db.oneOrNone(
            `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
            [id, req.userId]
        );
        if (!order) return res.status(404).json({ error: 'Order not found' });
        res.json({ success: true, data: order });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/orders
 * The client sends product ids, quantities and an address. Prices, GST,
 * shipping and the total are computed server-side by the order service.
 */
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        const { items, shippingAddress, paymentGateway, paymentMethod, expectedSubtotal } = req.body ?? {};

        if (!items || !items.length) return res.status(400).json({ error: 'No items in order' });
        if (!shippingAddress || typeof shippingAddress !== 'object' || Array.isArray(shippingAddress)) {
            return res.status(400).json({ error: 'Shipping address is required' });
        }

        const { order, totalPaise, lines, giftsShort } = await createOrder({
            userId: req.userId,
            items,
            shippingAddress,
            paymentGateway,
            paymentMethod,
            expectedSubtotal
        });
        if (giftsShort.length) {
            await notifyAdmin(`🎁 Order #${order.id.slice(0, 8).toUpperCase()}: ${giftsShort.map((g) => `${g.quantity} × ${g.label}`).join(', ')} `
                + 'was out of stock, so it is not on the order. If the order is paid, send one with it.');
        }

        if (order.payment_gateway === 'phonepe') {
            try {
                const redirectUrl = await phonePeService.initiatePayment(
                    order.id,
                    totalPaise / 100,
                    req.userId,
                    shippingAddress.phone || '9999999999',
                    order.payment_method
                );
                return res.status(201).json({ success: true, orderId: order.id, redirectUrl });
            } catch (err) {
                console.error(JSON.stringify({ event: 'payment_initiation_failed', orderId: order.id, error: err.message }));
                // No payment will ever happen for this order: give the stock back
                // now. If this also fails the order stays pending, and the stale
                // hold path releases it once PhonePe reports it unknown.
                try {
                    await cancelOrder(order.id, { from: PENDING_STATUSES, paymentStatus: 'failed' });
                } catch (releaseErr) {
                    console.error(JSON.stringify({ event: 'stock_release_failed', orderId: order.id, error: releaseErr.message }));
                }
                return res.status(400).json({ success: false, error: "Payment Initiation Failed: " + (err.message || "Unknown Error") });
            }
        }

        // Awaited deliberately: Lambda freezes the execution environment as soon as
        // the response is returned, so a promise left dangling here would never
        // settle. A failed email must not fail the order, but it must be visible.
        await alertNewOrder(order.id, { cod: true });
        const buyer = await db.oneOrNone('SELECT email, full_name FROM users WHERE id = $1', [req.userId]);
        if (buyer) {
            try {
                await emailService.sendOrderConfirmation(buyer.email, order.id, (totalPaise / 100).toFixed(2), lines);
            } catch (emailErr) {
                console.error(JSON.stringify({
                    event: 'email_failed',
                    type: 'order_confirmation',
                    orderId: order.id,
                    error: emailErr.message
                }));
            }
        }

        res.status(201).json({ message: 'Order placed successfully', orderId: order.id });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/orders/payment/callback  (PhonePe webhook)
 *
 * The body is treated as a hint about *which* order changed, never as
 * evidence of *what* happened: state and amount come from PhonePe's status API
 * (see settlePayment). Forging this request can therefore at worst make us ask
 * PhonePe about an order, which is harmless.
 */
router.post('/payment/callback', async (req, res) => {
    try {
        const auth = phonePeService.verifyCallbackAuth(req.headers.authorization);
        if (auth.configured && !auth.valid) {
            console.warn(JSON.stringify({ event: 'payment_callback_rejected', reason: 'bad_authorization' }));
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!auth.configured) {
            // Still safe (state is re-verified), but the operator should know the
            // webhook header check is off. See PHONEPE_WEBHOOK_* in .env.example.
            console.warn(JSON.stringify({ event: 'payment_callback_auth_unconfigured' }));
        }

        let notification = req.body ?? {};
        if (typeof notification.response === 'string') {
            try {
                notification = JSON.parse(Buffer.from(notification.response, 'base64').toString('utf-8'));
            } catch (e) {
                console.warn(JSON.stringify({ event: 'payment_callback_rejected', reason: 'undecodable_body' }));
                return res.status(400).json({ error: 'Invalid callback' });
            }
        }

        // PhonePe v2 nests the order under `payload`; older shapes use `data` or the root.
        const source = notification.payload ?? notification.data ?? notification;
        const merchantOrderId = source.merchantOrderId ?? source.merchantTransactionId ?? notification.orderId;

        if (!isUuid(merchantOrderId)) {
            return res.status(400).json({ error: 'Missing or invalid order id' });
        }

        const outcome = await reconcilePendingOrder(merchantOrderId, { includeCancelled: true });
        if (outcome === 'unverified') {
            // Could not reach PhonePe. 5xx makes PhonePe retry the webhook.
            return res.status(503).json({ error: 'Payment verification unavailable' });
        }
        res.json({ status: 'ok' });
    } catch (error) {
        console.error(JSON.stringify({ event: 'payment_callback_error', error: error.message }));
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * PUT /api/orders/:id  (admin)
 * 'cancelled' goes through cancelOrder so reserved stock is returned, and is
 * terminal except for 'refunded': a cancelled order cannot be revived (its
 * stock has been released), but a paid one can be paid back. 'refunded' goes
 * through refundOrder, only for an order the shop was paid for, and emails the
 * customer when the money will arrive. `customerEmailed` in the answer says
 * whether that email went out (null when the status sends none).
 */
router.put('/:id', authMiddleware, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, restock } = req.body ?? {};
        const validStatuses = ['pending', 'pending_payment', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded'];

        if (!isUuid(id)) return res.status(404).json({ error: 'Order not found' });
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status` });
        }

        const current = await db.oneOrNone('SELECT status FROM orders WHERE id = $1', [id]);
        if (!current) return res.status(404).json({ error: 'Order not found' });
        if (current.status === 'refunded') {
            return res.status(409).json({ error: status === 'refunded' ? REFUND_REFUSALS.already_refunded : 'A refunded order cannot be changed' });
        }
        if (current.status === 'cancelled' && status !== 'refunded') {
            return res.status(409).json({ error: 'A cancelled order can only be marked refunded' });
        }

        if (status === 'refunded') {
            const { order: refunded, refused } = await refundOrder(id, { restock: restock === true });
            if (refused) return res.status(refused === 'not_found' ? 404 : 409).json({ error: REFUND_REFUSALS[refused] });
            const user = await db.oneOrNone('SELECT email, full_name FROM users WHERE id = $1', [refunded.user_id]);
            let customerEmailed = false;
            if (user?.email) {
                try {
                    await emailService.sendRefundEmail(user.email, user.full_name, refunded);
                    customerEmailed = true;
                } catch (err) {
                    console.error(JSON.stringify({ event: 'email_failed', type: 'order_refunded', orderId: id, error: err.message }));
                }
            } else {
                console.error(JSON.stringify({ event: 'email_failed', type: 'order_refunded', orderId: id, error: 'no customer email' }));
            }
            return res.json({ message: 'Order refunded', data: refunded, customerEmailed });
        }

        if (status === 'cancelled') {
            if (!(await cancelOrder(id))) {
                return res.status(409).json({ error: `An order that is ${current.status} cannot be cancelled` });
            }
        } else {
            // Another tab may have cancelled or refunded it since it was read:
            // then nothing changes and the customer must not be told otherwise.
            const updated = await db.oneOrNone(
                `UPDATE orders SET status = $1 WHERE id = $2 AND status NOT IN ('cancelled', 'refunded') RETURNING id`, [status, id]);
            if (!updated) return res.status(409).json({ error: 'The order was cancelled or refunded meanwhile. Reload it.' });
        }

        const order = await db.one('SELECT * FROM orders WHERE id = $1', [id]);

        if (['shipped', 'delivered', 'cancelled'].includes(status)) {
            await notifyOrder(order.id, status);
            const user = await db.oneOrNone('SELECT email, full_name FROM users WHERE id = $1', [order.user_id]);
            if (user) {
                try {
                    await emailService.sendOrderStatusEmail(user.email, user.full_name, order.id, status);
                } catch (err) {
                    console.error(JSON.stringify({
                        event: 'email_failed',
                        type: 'order_status',
                        orderId: order.id,
                        status,
                        error: err.message
                    }));
                }
            }
        }
        res.json({ message: 'Order updated successfully', data: order });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/orders/:id/cancel
 * Matches on the order id and owner, in a single guarded UPDATE.
 */
router.post('/:id/cancel', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(404).json({ error: 'Order not found' });

        if (await cancelOrder(id, { userId: req.userId })) {
            return res.json({ success: true, message: 'Order cancelled successfully' });
        }

        const order = await db.oneOrNone('SELECT status FROM orders WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        res.status(400).json({ error: 'Order cannot be cancelled at this stage' });
    } catch (error) {
        console.error('Cancel order error:', error);
        next(error);
    }
});

/**
 * PUT /api/orders/:id/address
 */
router.put('/:id/address', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { address } = req.body ?? {};

        if (!address || typeof address !== 'object' || Array.isArray(address)) {
            return res.status(400).json({ error: 'Address data required' });
        }
        if (!isUuid(id)) return res.status(404).json({ error: 'Order not found' });

        const updated = await db.oneOrNone(
            `UPDATE orders SET shipping_address = $1, updated_at = NOW()
              WHERE id = $2 AND user_id = $3 AND status = ANY($4)
          RETURNING id`,
            [JSON.stringify(address), id, req.userId, CANCELLABLE_STATUSES]
        );
        if (updated) return res.json({ success: true, message: 'Address updated successfully' });

        const order = await db.oneOrNone('SELECT status FROM orders WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        res.status(400).json({ error: 'Cannot update address for shipped orders' });
    } catch (error) {
        console.error('Update address error:', error);
        next(error);
    }
});

export default router;
