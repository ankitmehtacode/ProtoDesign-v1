-- 018_lead_scoring.sql
-- A score for each open lead, with the reasons behind it, and when the shop
-- was last told it turned hot. Written hourly by lead-intel.service.js. See
-- docs/lead-intel.md.
--
-- Requires 015_leads.sql. Apply as the table owner (neondb_owner in the Neon
-- SQL editor); the app role already has access to `leads`.
--
-- Additive, plus the leads updated_at trigger learns to ignore score writes.
-- Rollback (drops the scores; the next run would recompute them):
--   CREATE OR REPLACE TRIGGER trigger_update_leads_updated_at BEFORE UPDATE ON leads
--       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
--   DROP INDEX IF EXISTS idx_leads_score;
--   ALTER TABLE leads DROP COLUMN IF EXISTS score, DROP COLUMN IF EXISTS score_reasons,
--       DROP COLUMN IF EXISTS scored_at, DROP COLUMN IF EXISTS hot_alerted_at;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS score SMALLINT CHECK (score BETWEEN 0 AND 100),
    -- [{ "label": "Added to cart", "points": 15 }, ...], largest first.
    ADD COLUMN IF NOT EXISTS score_reasons JSONB,
    -- When the score or its reasons last changed.
    ADD COLUMN IF NOT EXISTS scored_at TIMESTAMP,
    -- Set when a hot-lead alert went out; cleared once the lead cools down,
    -- so a lead that heats up again is alerted again.
    ADD COLUMN IF NOT EXISTS hot_alerted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC) WHERE score IS NOT NULL;

-- updated_at keeps meaning "someone or something changed the lead": the
-- hourly scoring alone does not move it.
CREATE OR REPLACE TRIGGER trigger_update_leads_updated_at BEFORE UPDATE ON leads
    FOR EACH ROW
    WHEN (to_jsonb(OLD) - ARRAY['score', 'score_reasons', 'scored_at', 'hot_alerted_at', 'updated_at']
          IS DISTINCT FROM to_jsonb(NEW) - ARRAY['score', 'score_reasons', 'scored_at', 'hot_alerted_at', 'updated_at'])
    EXECUTE FUNCTION update_updated_at_column();
