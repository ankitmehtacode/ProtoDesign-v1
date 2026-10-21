-- 013_telegram.sql
-- Telegram order and quote updates: chats that started the bot, and which
-- orders/quotes each chat follows. See docs/telegram-updates.md.
--
-- Apply as the table owner (neondb_owner in the Neon SQL editor). The GRANT
-- block at the end gives the app role access; without it every Telegram query
-- fails with "permission denied".
--
-- Additive only. Rollback (drops every Telegram subscription):
--   DROP TABLE IF EXISTS telegram_links, telegram_chats;

-- One row per private chat with the bot. stopped_at is set by /stop and
-- cleared by /start; a chat that blocked the bot is stopped the same way.
CREATE TABLE IF NOT EXISTS telegram_chats (
    chat_id BIGINT PRIMARY KEY,
    first_name TEXT,
    stopped_at TIMESTAMP,
    last_forwarded_at TIMESTAMP, -- rate limit on messages forwarded to the shop
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- A chat follows an order or a quote after opening the signed /start link.
CREATE TABLE IF NOT EXISTS telegram_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id BIGINT NOT NULL REFERENCES telegram_chats(chat_id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT now(),
    CHECK ((order_id IS NULL) <> (quote_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_links_order ON telegram_links(chat_id, order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_links_quote ON telegram_links(chat_id, quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_links_order ON telegram_links(order_id);
CREATE INDEX IF NOT EXISTS idx_telegram_links_quote ON telegram_links(quote_id);

CREATE OR REPLACE TRIGGER trigger_update_telegram_chats_updated_at BEFORE UPDATE ON telegram_chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The app role exists in production only; skip quietly elsewhere (tests, local).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protodesign_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_chats, telegram_links TO protodesign_user;
    END IF;
END $$;
