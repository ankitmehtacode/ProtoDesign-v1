-- 019_ads.sql
-- Google Ads, only with separate opt-in consent (docs/google-ads.md):
--   * ad measurement: a visitor who arrived from a Google ad may let the shop
--     tell Google Ads when that click led to an enquiry or order;
--   * Customer Match: a lead may let the shop add their (hashed) contact
--     details to a Google Ads audience.
-- Neither is implied by analytics or enquiry consent.
--
-- Requires 015_leads.sql. Apply as the table owner (neondb_owner in the Neon
-- SQL editor).
--
-- Additive only. Rollback (drops every ads consent; nothing is uploaded after):
--   DROP TABLE IF EXISTS ads_feed_fetches;
--   ALTER TABLE leads DROP COLUMN IF EXISTS ads_consent_text, DROP COLUMN IF EXISTS ads_consented_at;
--   ALTER TABLE visitors DROP COLUMN IF EXISTS ads_consent_at, DROP COLUMN IF EXISTS ads_consent_version,
--       DROP COLUMN IF EXISTS gclid_at;

-- The visitor's newest ad click (gclid, existing) and when it happened; and
-- whether they allowed ad measurement for it, under which wording
-- (ADS_CONSENT_TEXTS in leads.service.js). NULL consent means no or withdrawn.
ALTER TABLE visitors
    ADD COLUMN IF NOT EXISTS gclid_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS ads_consent_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS ads_consent_version VARCHAR(40);

-- The exact wording agreed to, as leads.consent_text, and when.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS ads_consent_text TEXT,
    ADD COLUMN IF NOT EXISTS ads_consented_at TIMESTAMP;

-- Each time Google Ads (or anyone with the secret) fetched the conversions
-- feed, so the admin can see the scheduled import is really running.
CREATE TABLE IF NOT EXISTS ads_feed_fetches (
    id SERIAL PRIMARY KEY,
    fetched_at TIMESTAMP NOT NULL DEFAULT now(),
    conversions INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ads_feed_fetches_at ON ads_feed_fetches(fetched_at DESC);

-- The app role exists in production only; skip quietly elsewhere (tests, local).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protodesign_user') THEN
        GRANT SELECT, INSERT, DELETE ON ads_feed_fetches TO protodesign_user;
        GRANT USAGE, SELECT ON SEQUENCE ads_feed_fetches_id_seq TO protodesign_user;
    END IF;
END $$;
