-- products.slug is read and written by products.routes.js and the sitemap but
-- was added to production by hand and never captured here. IF NOT EXISTS makes
-- this a no-op on that database.
--
-- Rollback (only on a database this migration actually changed):
--   ALTER TABLE products DROP COLUMN slug;
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug TEXT;
