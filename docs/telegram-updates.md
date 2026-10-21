# Telegram shop alerts

A Telegram bot sends the team an alert for every event that needs attention,
at no cost and with no 24-hour window. Customers are not served on Telegram:
their order and quote updates go out on WhatsApp
([`whatsapp-integration.md`](whatsapp-integration.md)) and email.

## 1. What alerts are sent

| Event | Where it fires |
|---|---|
| 🛒 New paid order (items, buyer, phone, email, city) | `settlePayment`, once PhonePe confirms the exact amount |
| 🛒 New cash-on-delivery order | `POST /api/orders` with `paymentGateway: 'cod'` |
| ⚠️ Payment failed | `settlePayment` and `reconcilePendingOrder` when they cancel an unpaid order |
| ♻️ Unpaid checkouts cancelled to free stock (one summary) | `releaseStaleHolds` |
| 🚨 Refund needed: paid after it was cancelled | `settlePayment` |
| 🧊 New quote request (file, price, contact) | `POST /api/quotes/request` |
| 🆕 New account, by email or Google | `authService.signup`, `authService.loginWithGoogle` |
| 👤 Sign-in, by email or Google; admin accounts are marked `ADMIN` | `authService.login`, `authService.loginWithGoogle` |
| 📱 WhatsApp alerts, including customer WhatsApp messages | `alertAdmin` in `whatsapp.worker.js`, which also emails them |

Each alert ends with a link to the matching admin tab. They go to every chat
in `TELEGRAM_ADMIN_CHAT_IDS`.

- **Inline sends, no queue.** Telegram answers in well under a second, so
  alerts are sent inside the request: one attempt, capped at 2 s. They run
  inside checkout and payment settlement, which share a 20 s Lambda timeout,
  so a slow Telegram drops an alert rather than delaying a payment. A
  sign-in waits for its alert in the same way, so it can take up to 2 s
  longer while Telegram is slow. Failures
  are logged as `telegram_send_failed` or `telegram_admin_alert_failed`.
- **The bot only talks to the team.** An admin chat that messages it gets
  "shop alerts are on". Anyone else gets one line saying the bot is for the
  team, plus their chat id; nothing they send reaches the shop.
- **Off by default.** Nothing is sent and the webhook answers 404 until
  `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are set. With no admin
  chat ids, nothing is sent either.

## 2. Create the bot
1. In Telegram, message **@BotFather**, send `/newbot`, and pick a name and a
   username ending in `bot`.
2. BotFather replies with the token. Treat it like a password: anyone with
   it can send as the bot. Put it straight into `infra/parameters.sh`.

## 3. Environment variables
| Parameter (`infra/parameters.sh`) | Lambda env | Value |
|---|---|---|
| `TelegramBotToken` | `TELEGRAM_BOT_TOKEN` | From BotFather. `NoEcho`. |
| `TelegramWebhookSecret` | `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 32`. `NoEcho`. Only `A-Z a-z 0-9 _ -` are allowed. |
| `TelegramAdminChatIds` | `TELEGRAM_ADMIN_CHAT_IDS` | Comma-separated chat ids that get alerts. |

To add someone: they send the bot any message, it replies with their chat
id, you add it to `TelegramAdminChatIds` and redeploy. A group's (negative)
id also works, once the bot is added to the group.

## 4. Deployment
1. Fill the `Telegram*` lines in `infra/parameters.sh` and deploy:
   ```
   cd infra && source parameters.sh && sam build && \
   sam deploy --profile protodesign --parameter-overrides "$PARAMETER_OVERRIDES"
   ```
2. Point Telegram at the webhook. Run this from `infra/` so the token comes
   from `parameters.sh` instead of your shell history. `<FunctionUrl>` is the
   stack's `ApiFunctionUrl` output **without its trailing slash** (the same
   value as `BackendUrl`); with the slash the URL becomes `…on.aws//api/…`,
   every update gets a 404, and only `getWebhookInfo` shows it:
   ```
   source parameters.sh && curl -s "https://api.telegram.org/bot${TelegramBotToken}/setWebhook" \
     --data-urlencode url="<FunctionUrl>/api/webhooks/telegram" \
     --data-urlencode secret_token="${TelegramWebhookSecret}" \
     --data-urlencode allowed_updates='["message"]' -d drop_pending_updates=true
   ```
   Check it with `getWebhookInfo`: `last_error_message` should be empty after
   you message the bot.
3. Message the bot, add the chat id it replies with to
   `TelegramAdminChatIds`, and redeploy. Message it again: it should answer
   "ProtoDesign shop alerts are on for this chat".

No migration is needed. `013_telegram.sql` created customer subscription
tables for an earlier design; `014_drop_telegram_subscriptions.sql` drops
them once the alert-only backend is deployed.

## 5. Testing
`cd backend && npx tsx --test test/telegram.test.mjs` runs the real Lambda
entry point against a temporary Postgres, with the Bot API stubbed. It covers
the webhook secret, group chats, the replies to admin and other chats, each
alert, exactly-once on a replayed payment, a hanging Telegram during
settlement, and no admin chats.

## 6. Rollback
- **Switch off, fastest:** clear `TelegramBotToken` and redeploy, then call
  `deleteWebhook`. Orders, quotes and payments are untouched.
- **Code:** redeploy the previous commit.

## 7. Security
- The webhook rejects any request without the exact secret (constant-time
  compare), and serves private chats only.
- The token never reaches the browser or the logs: send failures log the
  HTTP status and error code, never Telegram's description, which can echo
  the request URL. Chat ids are logged with only their last four digits.
- Alerts carry customer names, phones and emails, so add only team members'
  chats to `TelegramAdminChatIds`.
