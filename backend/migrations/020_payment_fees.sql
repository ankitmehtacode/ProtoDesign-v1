-- 020_payment_fees.sql
-- How an online order is paid (UPI, debit card or credit card) and the
-- convenience fee charged for it; UPI has none. Set by order.service.js
-- createOrder, which also tells PhonePe to offer only the chosen method.
-- total_amount = subtotal_amount + shipping_amount + convenience_fee.
--
-- Apply as the table owner (neondb_owner in the Neon SQL editor) BEFORE
-- deploying the code that writes these columns; the app role already has
-- access to `orders`.
--
-- Additive only. Rollback (deploy the previous code first):
--   ALTER TABLE orders DROP COLUMN IF EXISTS payment_method, DROP COLUMN IF EXISTS convenience_fee;

ALTER TABLE orders
    -- 'upi', 'net_banking', 'debit_card', 'credit_card' or 'cod'; NULL for orders placed before this.
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
    ADD COLUMN IF NOT EXISTS convenience_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
