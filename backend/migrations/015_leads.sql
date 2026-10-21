-- 015_leads.sql
-- Lead capture and first-party visit tracking: anonymous visitors (only after
-- the visitor accepts analytics), what they did, and the people who asked to
-- be contacted. See docs/lead-tracking.md.
--
-- Apply as the table owner (neondb_owner in the Neon SQL editor). The GRANT
-- block at the end gives the app role access; without it every tracking and
-- lead query fails with "permission denied".
--
-- Additive only. Rollback (drops every visitor, event and lead):
--   DROP TABLE IF EXISTS visitor_events, visitors, leads;

-- A person who asked to be contacted. Matched on phone first, then email, so a
-- repeat submission updates the same lead instead of creating a duplicate.
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120),
    -- E.164 digits without '+', as whatsapp_contacts.wa_id stores them.
    phone VARCHAR(15) CHECK (phone ~ '^[1-9][0-9]{9,14}$'),
    email VARCHAR(254),
    interest VARCHAR(20) NOT NULL CHECK (interest IN ('printer', 'filament', 'resin', 'service', 'other')),
    message TEXT,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    -- Which form captured it, e.g. 'product_page'.
    form VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')),
    admin_notes TEXT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- The exact wording the person agreed to, so consent stays provable.
    consent_text TEXT NOT NULL,
    consented_at TIMESTAMP NOT NULL DEFAULT now(),
    -- First touch, copied from the visitor when the lead was captured.
    source VARCHAR(100),
    medium VARCHAR(100),
    campaign VARCHAR(150),
    term VARCHAR(150),
    gclid VARCHAR(200),
    referrer_host VARCHAR(255),
    landing_path VARCHAR(500),
    -- Salted hash of the submitting IP that changes daily: enough to cap
    -- submissions per network per day, useless for identifying anyone later.
    ip_hash VARCHAR(64),
    submissions INTEGER NOT NULL DEFAULT 1,
    last_submitted_at TIMESTAMP NOT NULL DEFAULT now(),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_phone ON leads(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_ip ON leads(ip_hash, created_at) WHERE ip_hash IS NOT NULL;

-- One browser that accepted analytics. id is generated in the browser and
-- kept in localStorage; it identifies nobody until a lead or login links it.
CREATE TABLE IF NOT EXISTS visitors (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    source VARCHAR(100),
    medium VARCHAR(100),
    campaign VARCHAR(150),
    term VARCHAR(150),
    gclid VARCHAR(200),
    referrer_host VARCHAR(255),
    landing_path VARCHAR(500),
    ip_hash VARCHAR(64), -- as leads.ip_hash
    first_seen_at TIMESTAMP NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visitors_lead ON visitors(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitors_user ON visitors(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_visitors_ip ON visitors(ip_hash, first_seen_at) WHERE ip_hash IS NOT NULL;

-- What a visitor did. Anonymous visitors' rows go after 30 days and everyone's
-- after 180 (leads.service.js pruneTracking) -- Neon's free tier stops all
-- writes at 0.5 GB, so this table must not grow without bound.
CREATE TABLE IF NOT EXISTS visitor_events (
    id BIGSERIAL PRIMARY KEY,
    visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    name VARCHAR(30) NOT NULL CHECK (name IN
        ('page_view', 'product_view', 'add_to_cart', 'quote_start', 'lead_submit')),
    path VARCHAR(500),
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visitor_events_visitor ON visitor_events(visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_visitor_events_created ON visitor_events(created_at);

CREATE OR REPLACE TRIGGER trigger_update_leads_updated_at BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The app role exists in production only; skip quietly elsewhere (tests, local).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protodesign_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON leads, visitors, visitor_events TO protodesign_user;
        GRANT USAGE, SELECT ON SEQUENCE visitor_events_id_seq TO protodesign_user;
    END IF;
END $$;
