-- The reference ("was") price shown struck through beside the selling price.
-- NULL means no deal. The storefront shows a deal only when this is above
-- price, so it is deliberately not a CHECK: an admin raising the price must
-- end the deal on screen, not fail the save.
--
-- Rollback:
--   ALTER TABLE products DROP COLUMN compare_at_price;
ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price DECIMAL(10,2) DEFAULT NULL;
