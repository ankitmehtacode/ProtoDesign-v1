-- 016_lead_tools.sql
-- The printer advisor and filament estimator, whose results a visitor can send
-- to their own WhatsApp with a signed code, and email alerts for a product
-- coming back in stock or dropping in price. See docs/lead-tracking.md.
--
-- Requires 015_leads.sql. Apply as the table owner (neondb_owner in the Neon
-- SQL editor); the GRANT block at the end gives the app role access.
--
-- Additive except the visitor_events name check, which gains two names.
-- Rollback (drops every tool result and alert subscription):
--   DROP TABLE IF EXISTS product_alerts, tool_results;
--   DELETE FROM visitor_events WHERE name IN ('tool_use', 'alert_signup');
--   ALTER TABLE visitor_events DROP CONSTRAINT visitor_events_name_check;
--   ALTER TABLE visitor_events ADD CONSTRAINT visitor_events_name_check CHECK (name IN
--       ('page_view', 'product_view', 'add_to_cart', 'quote_start', 'lead_submit'));

-- One run of a tool, computed by the server. The WhatsApp bot replies with
-- `result` only; nothing the browser sent is ever echoed back.
CREATE TABLE IF NOT EXISTS tool_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool VARCHAR(30) NOT NULL CHECK (tool IN ('printer_advisor', 'filament_estimator')),
    inputs JSONB NOT NULL,
    result JSONB NOT NULL,
    visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
    -- Set when the visitor sends the code from WhatsApp.
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    delivered_at TIMESTAMP,
    ip_hash VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tool_results_created ON tool_results(created_at);
CREATE INDEX IF NOT EXISTS idx_tool_results_lead ON tool_results(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tool_results_ip ON tool_results(ip_hash, created_at) WHERE ip_hash IS NOT NULL;

-- "Email me when it is back in stock / cheaper". baseline_price is what the
-- customer saw when subscribing; a price-drop alert fires below it. Double
-- opt-in: nothing but the confirmation is sent until confirmed_at is set, and
-- the lead is only recorded then, so a typed address proves itself first.
CREATE TABLE IF NOT EXISTS product_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    email VARCHAR(254) NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('back_in_stock', 'price_drop')),
    baseline_price NUMERIC(12, 2) NOT NULL,
    -- Unguessable, for the confirm and unsubscribe links in every email.
    token VARCHAR(64) NOT NULL UNIQUE,
    visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    consent_text TEXT NOT NULL,
    ip_hash VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    confirmation_sent_at TIMESTAMP,
    confirmed_at TIMESTAMP,
    -- A lease while the alert email is being sent; a stale one (the run was
    -- killed) is taken over. notified_at is set only once the send succeeded.
    claimed_at TIMESTAMP,
    attempts INTEGER NOT NULL DEFAULT 0,
    -- Given up after repeated send failures (a bad address).
    failed_at TIMESTAMP,
    notified_at TIMESTAMP,
    unsubscribed_at TIMESTAMP
);
-- One open alert of each kind per product per address.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_alerts_open
    ON product_alerts(product_id, lower(email), kind)
    WHERE notified_at IS NULL AND unsubscribed_at IS NULL AND failed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_alerts_pending
    ON product_alerts(product_id)
    WHERE confirmed_at IS NOT NULL AND notified_at IS NULL AND unsubscribed_at IS NULL AND failed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_alerts_email ON product_alerts(lower(email));
-- The daily email budget counts these.
CREATE INDEX IF NOT EXISTS idx_product_alerts_sent ON product_alerts(confirmation_sent_at);
CREATE INDEX IF NOT EXISTS idx_product_alerts_notified ON product_alerts(notified_at);
CREATE INDEX IF NOT EXISTS idx_product_alerts_ip ON product_alerts(ip_hash, created_at) WHERE ip_hash IS NOT NULL;

-- One transaction, so there is no moment without the check.
BEGIN;
ALTER TABLE visitor_events DROP CONSTRAINT IF EXISTS visitor_events_name_check;
ALTER TABLE visitor_events ADD CONSTRAINT visitor_events_name_check CHECK (name IN
    ('page_view', 'product_view', 'add_to_cart', 'quote_start', 'lead_submit', 'tool_use', 'alert_signup'));
COMMIT;

-- The app role exists in production only; skip quietly elsewhere (tests, local).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protodesign_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON tool_results, product_alerts TO protodesign_user;
    END IF;
END $$;
