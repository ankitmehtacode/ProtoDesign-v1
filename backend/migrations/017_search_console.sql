-- 017_search_console.sql
-- Google Search Console numbers, copied daily: which searches showed the
-- shop's pages, how often, at what position, and how many people clicked.
-- Aggregate counts only -- Search Console never says who searched. See
-- docs/search-demand.md.
--
-- Requires 015_leads.sql (the admin view joins search pages to tracked
-- visitors). Apply as the table owner (neondb_owner in the Neon SQL editor).
--
-- Additive only. Rollback (drops the copied Search Console data, which the
-- next sync can fetch again for the last 118 days):
--   DROP TABLE IF EXISTS search_console_rows, search_console_days, search_console_syncs;

-- One query, one page, one day. Kept to 1000 rows a day and 120 days
-- (search-console.service.js), at most ~30 MB of Neon's 0.5 GB.
CREATE TABLE IF NOT EXISTS search_console_rows (
    day DATE NOT NULL,
    query VARCHAR(200) NOT NULL,
    -- The page's path; hosts (www or not) are merged.
    page VARCHAR(500) NOT NULL,
    clicks INTEGER NOT NULL CHECK (clicks >= 0),
    impressions INTEGER NOT NULL CHECK (impressions > 0),
    -- Average position, weighted by impressions.
    position REAL NOT NULL,
    PRIMARY KEY (day, query, page)
);

-- Search Console's own total per day, anonymised searches included, so the
-- admin's headline numbers match its reports. The newest day here is where
-- the next sync starts.
CREATE TABLE IF NOT EXISTS search_console_days (
    day DATE PRIMARY KEY,
    clicks INTEGER NOT NULL CHECK (clicks >= 0),
    impressions INTEGER NOT NULL CHECK (impressions > 0),
    position REAL NOT NULL
);

-- Every sync run, so a failing or stuck sync shows in the admin.
CREATE TABLE IF NOT EXISTS search_console_syncs (
    id SERIAL PRIMARY KEY,
    status VARCHAR(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed')),
    -- What the admin is shown: never a stack trace or internal error text.
    detail TEXT,
    first_day DATE,
    last_day DATE,
    rows_stored INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    finished_at TIMESTAMP
);
-- One sync at a time: two would delete and insert the same days.
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_console_syncs_running
    ON search_console_syncs ((true)) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_search_console_syncs_started ON search_console_syncs(started_at DESC);

-- The app role exists in production only; skip quietly elsewhere (tests, local).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protodesign_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON search_console_rows, search_console_days, search_console_syncs TO protodesign_user;
        GRANT USAGE, SELECT ON SEQUENCE search_console_syncs_id_seq TO protodesign_user;
    END IF;
END $$;
