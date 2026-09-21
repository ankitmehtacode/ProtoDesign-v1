import db from '../config/database.js';
import { phonePeService } from './phonepe.service.js';

/**
 * Order lifecycle: creation, payment settlement, cancellation.
 *
 * Every transition that touches money or stock lives here so each rule exists
 * exactly once. The invariants:
 *
 *  - Stock is debited when an order is created (that is the reservation) and
 *    credited back exactly once when the order moves to 'cancelled'. "Exactly
 *    once" is enforced by the guarded UPDATE in cancelOrder: only the caller
 *    whose UPDATE actually flips the row restores stock.
 *  - An order is only marked paid after PhonePe's own status API says
 *    COMPLETED for the exact amount we charged. Webhook bodies are never
 *    trusted for state.
 *  - 'cancelled' is terminal. Nothing here moves an order out of it.
 */

export const PENDING_STATUSES = ['pending', 'pending_payment'];
export const CANCELLABLE_STATUSES = [...PENDING_STATUSES, 'processing'];

// Same flat fee and GST rate as src/pages/Cart.tsx and Checkout.tsx. The server
// owns these: it must never accept a total or shipping fee from the client.
export const SHIPPING_FEE_PAISE = 5000;
export const GST_RATE = 0.18;

const ALLOWED_GATEWAYS = ['phonepe', 'cod'];
const MAX_LINE_ITEMS = 50;
const MAX_QUANTITY = 1000;

// A pending PhonePe order older than this is presumed abandoned, and its stock
// hold is eligible for release once PhonePe confirms it was not paid.
const STALE_HOLD_MINUTES = 15;
// Within this window a gateway "no such order" answer is not believed: the
// payment may simply not have been registered with PhonePe yet.
const GATEWAY_UNKNOWN_GRACE_MINUTES = 5;
const MAX_RECONCILE_PER_REQUEST = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const fromPaise = (paise) => (paise / 100).toFixed(2);

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

const logEvent = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const logFault = (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }));

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/**
 * Cancels an order and returns its reserved stock, atomically and at most once.
 *
 * @param {string} orderId
 * @param {object} [opts]
 * @param {string[]} [opts.from]   statuses the order may be cancelled from.
 *        A payment *failure* passes PENDING_STATUSES so that a late or replayed
 *        failure notice can never cancel an order that has since been paid.
 * @param {string} [opts.userId]   restrict to this owner (user-initiated cancel).
 * @param {string} [opts.paymentStatus]  new payment_status; unchanged when omitted.
 * @returns {Promise<boolean>} true if this call cancelled the order.
 */
export async function cancelOrder(orderId, { from = CANCELLABLE_STATUSES, userId = null, paymentStatus = null } = {}) {
    return db.tx(async (t) => {
        const flipped = await t.oneOrNone(
            `UPDATE orders
                SET status = 'cancelled',
                    payment_status = COALESCE($3, payment_status),
                    updated_at = NOW()
              WHERE id = $1
                AND status = ANY($2)
                AND ($4::uuid IS NULL OR user_id = $4::uuid)
          RETURNING id`,
            [orderId, from, paymentStatus, userId]
        );
        if (!flipped) return false;

        // Lock in a fixed order so this cannot deadlock with createOrder, which
        // also locks products in id order.
        await t.any(
            `SELECT id FROM products
              WHERE id IN (SELECT product_id FROM order_items WHERE order_id = $1)
              ORDER BY id FOR UPDATE`,
            [orderId]
        );
        await t.none(
            `UPDATE products p
                SET stock = COALESCE(p.stock, 0) + r.qty
               FROM (SELECT product_id, SUM(quantity)::int AS qty
                       FROM order_items WHERE order_id = $1 GROUP BY product_id) r
              WHERE p.id = r.product_id`,
            [orderId]
        );
        logEvent('order_cancelled', { orderId, paymentStatus });
        return true;
    });
}

// ---------------------------------------------------------------------------
// Payment settlement
// ---------------------------------------------------------------------------

/** @returns {'paid'|'failed'|'pending'} from a PhonePe status-API response. */
function classifyGatewayState(data) {
    const state = data?.state ?? data?.data?.state;
    const code = data?.code ?? data?.responseCode;
    if (state === 'COMPLETED' || state === 'SUCCESS' || code === 'PAYMENT_SUCCESS') return 'paid';
    if (['FAILED', 'CANCELLED', 'DECLINED'].includes(state)
        || ['PAYMENT_ERROR', 'PAYMENT_DECLINED', 'PAYMENT_CANCELLED'].includes(code)) return 'failed';
    return 'pending';
}

/**
 * Applies a payment outcome that came from PhonePe's status API (never from a
 * webhook body) to the order. Idempotent: replays and races are no-ops.
 *
 * @returns {Promise<'paid'|'cancelled'|'pending'|'noop'|'unknown_order'|'amount_mismatch'|'paid_after_cancel'>}
 */
export async function settlePayment(orderId, gatewayData) {
    const outcome = classifyGatewayState(gatewayData);
    if (outcome === 'pending') return 'pending';

    const order = await db.oneOrNone('SELECT id, total_amount FROM orders WHERE id = $1', [orderId]);
    if (!order) {
        logFault('payment_unknown_order', { orderId });
        return 'unknown_order';
    }

    if (outcome === 'failed') {
        const cancelled = await cancelOrder(orderId, { from: PENDING_STATUSES, paymentStatus: 'failed' });
        return cancelled ? 'cancelled' : 'noop';
    }

    // outcome === 'paid': the amount PhonePe collected must equal what we charged.
    const expectedPaise = toPaise(order.total_amount);
    const collectedPaise = Number(gatewayData?.amount ?? gatewayData?.data?.amount);
    if (!Number.isInteger(collectedPaise) || collectedPaise !== expectedPaise) {
        logFault('payment_amount_mismatch', { orderId, expectedPaise, collectedPaise: collectedPaise || null });
        return 'amount_mismatch';
    }

    const settled = await db.oneOrNone(
        `UPDATE orders SET status = 'processing', payment_status = 'paid', updated_at = NOW()
          WHERE id = $1 AND status = ANY($2) RETURNING id`,
        [orderId, PENDING_STATUSES]
    );
    if (settled) {
        logEvent('order_paid', { orderId });
        return 'paid';
    }

    // Not pending any more. Cancelled + paid means we hold the customer's money
    // for an order we will not fulfil: record it so it is queryable, and shout.
    const late = await db.oneOrNone(
        `UPDATE orders SET payment_status = 'paid', updated_at = NOW()
          WHERE id = $1 AND status = 'cancelled' RETURNING id`,
        [orderId]
    );
    if (late) {
        logFault('payment_received_for_cancelled_order', { orderId, action: 'REFUND_REQUIRED' });
        return 'paid_after_cancel';
    }
    return 'noop'; // already processing/shipped/etc: a replayed notification
}

/**
 * Asks PhonePe for the truth about one pending order and settles it.
 * A gateway error leaves the order pending (and logs it): "could not check"
 * must never be interpreted as "not paid".
 *
 * @param {string} orderId
 * @param {object} [opts]
 * @param {boolean} [opts.includeCancelled] also check cancelled orders. The
 *        webhook sets this: a payment that completes after the customer
 *        cancelled must be detected (settlePayment flags it for refund), not
 *        skipped because the order is no longer pending.
 * @returns {Promise<string>} a settlePayment outcome, 'unverified', or 'skipped'.
 */
export async function reconcilePendingOrder(orderId, { includeCancelled = false } = {}) {
    const order = await db.oneOrNone(
        `SELECT id, status, payment_gateway,
                EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 AS age_minutes
           FROM orders WHERE id = $1`,
        [orderId]
    );
    const checkable = includeCancelled ? [...PENDING_STATUSES, 'cancelled'] : PENDING_STATUSES;
    if (!order || !checkable.includes(order.status) || order.payment_gateway?.toLowerCase() !== 'phonepe') {
        return 'skipped';
    }

    try {
        const data = await phonePeService.verifyPaymentStatus(orderId);
        return await settlePayment(orderId, data);
    } catch (err) {
        const httpStatus = err.response?.status;
        // PhonePe documents INVALID_MERCHANT_ORDER_ID as the body for an order it
        // has no record of, but not the HTTP status; production logs have shown
        // 400 and 404. Match on either. Believe it only once the order is old
        // enough that registration cannot still be pending.
        const unknownToGateway = err.response?.data?.code === 'INVALID_MERCHANT_ORDER_ID'
            || httpStatus === 404 || httpStatus === 400;
        if (unknownToGateway && Number(order.age_minutes) > GATEWAY_UNKNOWN_GRACE_MINUTES) {
            logEvent('payment_unknown_to_gateway', { orderId, httpStatus });
            const cancelled = await cancelOrder(orderId, { from: PENDING_STATUSES, paymentStatus: 'failed' });
            return cancelled ? 'cancelled' : 'noop';
        }
        logFault('payment_verify_failed', { orderId, httpStatus: httpStatus ?? null, code: err.code ?? null, error: err.message });
        return 'unverified';
    }
}

/** Reconciles a user's most recent pending PhonePe orders; returns orderId -> outcome. */
export async function reconcilePendingOrders(orderIds) {
    const batch = orderIds.slice(0, MAX_RECONCILE_PER_REQUEST);
    const outcomes = await Promise.all(batch.map((id) => reconcilePendingOrder(id)));
    return new Map(batch.map((id, i) => [id, outcomes[i]]));
}

/**
 * Releases stock held by abandoned checkouts of the given products, after
 * PhonePe confirms they were not paid. Called only when a shortage is about to
 * turn a customer away, so the gateway is queried when it matters, not on a
 * timer we do not have.
 *
 * @returns {Promise<number>} how many orders were cancelled.
 */
export async function releaseStaleHolds(productIds) {
    const stale = await db.any(
        `SELECT DISTINCT o.id
           FROM orders o JOIN order_items oi ON oi.order_id = o.id
          WHERE oi.product_id IN ($1:csv)
            AND o.status = ANY($2)
            AND LOWER(o.payment_gateway) = 'phonepe'
            AND o.created_at < NOW() - make_interval(mins => $3)
          LIMIT 20`,
        [productIds, PENDING_STATUSES, STALE_HOLD_MINUTES]
    );
    let released = 0;
    for (const { id } of stale) {
        if (await reconcilePendingOrder(id) === 'cancelled') released++;
    }
    if (released) logEvent('stale_holds_released', { released });
    return released;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Validates and merges cart lines: hostile input in, Map(productId -> quantity) out. */
function normalizeItems(items) {
    if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'No items in order');
    if (items.length > MAX_LINE_ITEMS) throw httpError(400, `An order can have at most ${MAX_LINE_ITEMS} line items`);

    const wanted = new Map();
    for (const item of items) {
        if (!isUuid(item?.product_id)) throw httpError(400, 'Invalid product id');
        const quantity = Number(item.quantity);
        // Rejecting (not defaulting) keeps negative and fractional quantities
        // from ever reaching the stock arithmetic.
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
            throw httpError(400, `Quantity must be a whole number between 1 and ${MAX_QUANTITY}`);
        }
        wanted.set(item.product_id, (wanted.get(item.product_id) || 0) + quantity);
    }
    return wanted;
}

async function insertOrderAndReserveStock({ userId, wanted, shippingAddress, gateway }) {
    // Ascending id order: concurrent orders lock shared products in the same
    // order, so they queue instead of deadlocking.
    const productIds = [...wanted.keys()].sort();

    return db.tx(async (t) => {
        const products = await t.any(
            'SELECT id, name, price, stock FROM products WHERE id IN ($1:csv)',
            [productIds]
        );
        const byId = new Map(products.map((p) => [p.id, p]));

        let subtotalPaise = 0;
        const lines = [];
        for (const productId of productIds) {
            const product = byId.get(productId);
            if (!product) throw httpError(404, 'One or more products no longer exist');
            const quantity = wanted.get(productId);
            const unitPaise = toPaise(product.price);
            subtotalPaise += unitPaise * quantity;
            lines.push({
                productId, name: product.name, quantity, unitPaise,
                // Shape consumed by emailService.sendOrderConfirmation.
                product_name: product.name, price: fromPaise(unitPaise)
            });
        }
        const gstPaise = Math.round(subtotalPaise * GST_RATE);
        const totalPaise = subtotalPaise + gstPaise + SHIPPING_FEE_PAISE;

        const order = await t.one(
            `INSERT INTO orders
                 (user_id, subtotal_amount, tax_amount, shipping_amount, total_amount, shipping_address, payment_gateway, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
             RETURNING *`,
            [userId, fromPaise(subtotalPaise), fromPaise(gstPaise), fromPaise(SHIPPING_FEE_PAISE),
                fromPaise(totalPaise), JSON.stringify(shippingAddress ?? null), gateway]
        );

        for (const line of lines) {
            // The guard in the WHERE clause is the oversell protection: two
            // buyers racing for the last unit cannot both pass it, whatever the
            // earlier SELECT saw.
            const reserved = await t.oneOrNone(
                'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id',
                [line.quantity, line.productId]
            );
            if (!reserved) {
                throw httpError(409, `Not enough stock for ${line.name}`, { code: 'OUT_OF_STOCK', productIds });
            }
            await t.none(
                `INSERT INTO order_items (order_id, product_id, quantity, price, line_total)
                 VALUES ($1, $2, $3, $4, $5)`,
                [order.id, line.productId, line.quantity, fromPaise(line.unitPaise), fromPaise(line.unitPaise * line.quantity)]
            );
        }

        return { order, totalPaise, lines };
    });
}

/**
 * Creates a pending order and reserves its stock.
 * Prices, GST, shipping and the total are computed here from the database; the
 * client supplies only product ids, quantities and an address.
 *
 * @returns {Promise<{order: object, totalPaise: number, lines: object[]}>}
 */
export async function createOrder({ userId, items, shippingAddress, paymentGateway }) {
    const wanted = normalizeItems(items);

    const gateway = String(paymentGateway || 'phonepe').toLowerCase();
    if (!ALLOWED_GATEWAYS.includes(gateway)) throw httpError(400, 'Unsupported payment gateway');

    const attempt = () => insertOrderAndReserveStock({ userId, wanted, shippingAddress, gateway });
    try {
        return await attempt();
    } catch (err) {
        if (err.code !== 'OUT_OF_STOCK') throw err;
        // Abandoned checkouts may be holding the stock this buyer needs.
        if (await releaseStaleHolds(err.productIds) === 0) throw err;
        return attempt();
    }
}
