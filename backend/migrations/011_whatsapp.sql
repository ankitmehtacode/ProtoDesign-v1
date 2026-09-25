-- 011_whatsapp.sql
-- WhatsApp Cloud API integration: contacts, consent, links to orders/quotes,
-- a message log (which doubles as the outbound queue), and an inbound webhook
-- event log used for idempotency. See docs/whatsapp-integration.md.
--
-- Apply as the table owner (neondb_owner in the Neon SQL editor). The GRANT
-- block at the end gives the app role access; without it every WhatsApp query
-- fails with "permission denied".
--
-- Additive only: no existing column loses data. Rollback (drops every WhatsApp
-- record; quotes created from WhatsApp keep working as ordinary quotes):
--   DROP TABLE IF EXISTS whatsapp_events, whatsapp_messages, whatsapp_links,
--                        whatsapp_consents, whatsapp_contacts;
--   ALTER TABLE quotes DROP COLUMN IF EXISTS source;
--   -- Only once no quote has a NULL email:
--   ALTER TABLE quotes ALTER COLUMN email SET NOT NULL;

-- A quote sent as a file in chat has a phone number but no email address.
ALTER TABLE quotes ALTER COLUMN email DROP NOT NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'web';

-- One row per WhatsApp user. wa_id is the number as WhatsApp reports it:
-- E.164 digits without the leading '+'.
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_id VARCHAR(20) NOT NULL UNIQUE CHECK (wa_id ~ '^[1-9][0-9]{7,14}$'),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    profile_name VARCHAR(255),
    -- Start of the free 24-hour customer service window.
    last_inbound_at TIMESTAMP,
    -- Set by STOP/UNSUBSCRIBE; cleared by START. Blocks proactive messages.
    opted_out_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_user ON whatsapp_contacts(user_id);

-- Consent history. A revoked consent is kept (revoked_at set), never deleted,
-- so it remains provable what the customer agreed to and when.
CREATE TABLE IF NOT EXISTS whatsapp_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
    consent_type VARCHAR(20) NOT NULL CHECK (consent_type IN ('service', 'marketing')),
    source VARCHAR(50) NOT NULL,
    consent_text TEXT NOT NULL,
    granted_at TIMESTAMP NOT NULL DEFAULT now(),
    revoked_at TIMESTAMP
);
-- At most one active consent of each type per contact.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_consents_active
    ON whatsapp_consents(contact_id, consent_type) WHERE revoked_at IS NULL;

-- Which orders/quotes a contact asked to follow. Created only from a signed
-- reference the customer sent from their own logged-in session.
CREATE TABLE IF NOT EXISTS whatsapp_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT now(),
    CHECK ((order_id IS NULL) <> (quote_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_links_order ON whatsapp_links(contact_id, order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_links_quote ON whatsapp_links(contact_id, quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_links_order ON whatsapp_links(order_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_links_quote ON whatsapp_links(quote_id);

-- Every message in either direction. Outbound rows are inserted as 'queued'
-- and sent by the worker, so a slow or failing Meta API never blocks an order,
-- payment or quote. body is cleared after WHATSAPP_BODY_RETENTION_DAYS.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
    wa_message_id VARCHAR(128) UNIQUE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type VARCHAR(20) NOT NULL,
    -- 'reply' answers the customer; 'notification' is a status update we start.
    kind VARCHAR(20) NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply', 'notification')),
    -- 'service' = replies/status updates; 'marketing' is never queued by this app.
    category VARCHAR(20) NOT NULL DEFAULT 'service' CHECK (category IN ('service', 'marketing')),
    template_name VARCHAR(100),
    -- Values for the paid template, used only if the free window has closed.
    template_params JSONB,
    -- True only when Meta will charge for it (template outside the free window).
    billable BOOLEAN NOT NULL DEFAULT false,
    body TEXT,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN
        ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'received')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code VARCHAR(50),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_contact ON whatsapp_messages(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON whatsapp_messages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_order ON whatsapp_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_quote ON whatsapp_messages(quote_id);

-- Webhook deliveries, one row per message/status inside a delivery. event_key
-- is unique, so Meta's retries and duplicate deliveries are processed once.
-- payload is cleared once processed (data minimisation).
CREATE TABLE IF NOT EXISTS whatsapp_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_key VARCHAR(200) NOT NULL UNIQUE,
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('message', 'status')),
    payload JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    -- Lease: a worker that dies mid-event releases it when this goes stale.
    claimed_at TIMESTAMP,
    last_error TEXT,
    received_at TIMESTAMP NOT NULL DEFAULT now(),
    processed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_events_pending ON whatsapp_events(received_at) WHERE processed_at IS NULL;

CREATE OR REPLACE TRIGGER trigger_update_whatsapp_contacts_updated_at BEFORE UPDATE ON whatsapp_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER trigger_update_whatsapp_messages_updated_at BEFORE UPDATE ON whatsapp_messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The app role exists in production only; skip quietly elsewhere (tests, local).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protodesign_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            whatsapp_contacts, whatsapp_consents, whatsapp_links, whatsapp_messages, whatsapp_events
            TO protodesign_user;
    END IF;
END $$;
