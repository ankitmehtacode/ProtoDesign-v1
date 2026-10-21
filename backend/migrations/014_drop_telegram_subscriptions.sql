-- 014_drop_telegram_subscriptions.sql
-- Telegram carries shop alerts only (see docs/telegram-updates.md); customers
-- get their updates on WhatsApp and email. The subscription tables from
-- 013_telegram.sql are no longer read or written by any code.
--
-- Apply as the table owner (neondb_owner in the Neon SQL editor), and only
-- after the backend without customer Telegram updates is deployed.
--
-- Rollback: run 013_telegram.sql again. The tables only ever held chats that
-- pressed Start on the bot, which the alert-only bot does not need.

DROP TABLE IF EXISTS telegram_links, telegram_chats;
