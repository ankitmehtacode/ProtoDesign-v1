-- 021_remove_seeded_reviews.sql
-- Removes the placeholder reviews written by the old POST /products/seed-reviews
-- route (deleted from the code with this migration). They were invented text
-- under invented names, shown to shoppers as customer reviews. Reviews posted
-- by real accounts are not touched.
--
-- Seeded reviews are the ones whose author is a seeded account: those accounts
-- were created with password_hash = 'seed_hash_readonly' and cannot sign in.
-- The accounts themselves are left alone: deleting a user cascades to orders.
--
-- Run the SELECT first and read the count. Apply as the table owner
-- (neondb_owner in the Neon SQL editor). No code depends on this.
--
--   SELECT count(*) FROM reviews r JOIN users u ON u.id = r.user_id
--    WHERE u.password_hash = 'seed_hash_readonly';
--
-- Rollback (the deleted rows are kept in reviews_seeded_backup):
--   INSERT INTO reviews SELECT * FROM reviews_seeded_backup;
--   then rerun the UPDATE products statement below.
-- Drop reviews_seeded_backup once you are sure.

BEGIN;

CREATE TABLE reviews_seeded_backup AS
SELECT r.* FROM reviews r JOIN users u ON u.id = r.user_id
 WHERE u.password_hash = 'seed_hash_readonly';

DELETE FROM reviews WHERE id IN (SELECT id FROM reviews_seeded_backup);

-- The same figures refreshReviewStats keeps (products.routes.js).
UPDATE products p
   SET average_rating = COALESCE(s.avg, 0), review_count = COALESCE(s.count, 0)
  FROM products q
  LEFT JOIN (SELECT product_id, ROUND(AVG(rating)::numeric, 2) AS avg, COUNT(*) AS count
               FROM reviews GROUP BY product_id) s ON s.product_id = q.id
 WHERE p.id = q.id
   AND q.id IN (SELECT product_id FROM reviews_seeded_backup);

COMMIT;
