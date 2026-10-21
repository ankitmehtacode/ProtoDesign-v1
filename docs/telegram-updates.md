# Telegram order updates

A Telegram bot sends order and quote updates to customers, and shop alerts to
the team, at no cost. Unlike WhatsApp ([`whatsapp-integration.md`](whatsapp-integration.md)),
Telegram has no per-message charge and no 24-hour window: once a chat has
started the bot, the bot can message it at any time.

## 1. How it works

```
Customer taps "Get updates on Telegram" (Orders page, quote confirmation)
  └► GET /api/telegram/link (logged in, owner only) ─► https://t.me/<bot>?start=O-1A2B3C4D-K7Q2M9XD
       └► customer presses Start ─► Telegram ─► POST /api/webhooks/telegram
                                                  │ verify X-Telegram-Bot-Api-Secret-Token
                                                  └ verify the signed reference, INSERT telegram_links

Order/quote code ─► notify.js ─► WhatsApp queue + telegram.notifyOrder/notifyQuote ─► sendMessage
Payment settled / failed, new quote, WhatsApp admin alert ─► telegram.notifyAdmin ─► every admin chat
```

- **Who gets what.** Customers who linked an order or quote get the same
  events as WhatsApp (`ORDER_EVENTS`, `QUOTE_EVENTS` in `whatsapp.service.js`):
  payment confirmed, shipped, delivered, cancelled (by the shop, or because
  the payment failed); quote in review, paid, completed, not accepted. Admin
  chats get new paid and cash-on-delivery orders, failed payments, unpaid
  checkouts cancelled to free stock (one summary), new quotes, refunds needed,
  WhatsApp alerts, and every message a customer sends the bot.
- **Signed references.** The start payload is the same HMAC reference the
  WhatsApp link uses, signed with `JWT_SECRET`. Only the logged-in owner is
  shown it, so guessing an id prefix can't subscribe anyone to an order.
- **Inline sends, no queue.** Telegram answers in well under a second, so
  messages are sent inside the request: one attempt, capped at 2 s. These
  sends run inside checkout and payment settlement, which share a 20 s Lambda
  timeout, so a slow Telegram drops a message rather than delaying a payment.
  Every send logs and swallows its own failure: the order, payment or quote
  that triggered it has already succeeded. Failures show up in CloudWatch as
  `telegram_send_failed`, `telegram_notify_failed` or
  `telegram_admin_alert_failed`.
- **Bot commands.** `/start` (with or without a reference), `/status`,
  `/stop`. Any other text from a customer is forwarded to the admin chats.
  Admins answer with `/reply <chat id> <message>`. A chat can forward one
  message every 5 s; faster ones are refused with "please wait". A chat that blocks the bot
  is marked stopped and not tried again until it sends `/start`.
- **Off by default.** Nothing is sent, the webhook answers 404 and the
  buttons stay hidden until `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and
  `TELEGRAM_WEBHOOK_SECRET` are all set.

## 2. Create the bot
1. In Telegram, message **@BotFather**, send `/newbot`, and pick a name
   ("ProtoDesign Orders") and a username ending in `bot`.
2. BotFather replies with the token. Treat it like a password: anyone with
   it can send as the bot. Put it straight into `infra/parameters.sh`.
3. Optional: `/setdescription` and `/setuserpic` in BotFather, and
   `/setcommands` with:
   ```
   status - See your orders and quotes
   stop - Turn updates off
   ```

## 3. Environment variables
| Parameter (`infra/parameters.sh`) | Lambda env | Value |
|---|---|---|
| `TelegramBotToken` | `TELEGRAM_BOT_TOKEN` | From BotFather. `NoEcho`. |
| `TelegramBotUsername` | `TELEGRAM_BOT_USERNAME` | Without the `@`. |
| `TelegramWebhookSecret` | `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 32`. `NoEcho`. Only `A-Z a-z 0-9 _ -` are allowed. |
| `TelegramAdminChatIds` | `TELEGRAM_ADMIN_CHAT_IDS` | Comma-separated chat ids that get shop alerts. |

To find a chat id: deploy with the first three set, send `/start` to the bot
from the phone that should get alerts, and the bot replies with its chat id.
Add it to `TelegramAdminChatIds` and redeploy. A group's (negative) id also
works for alerts, but the bot only reads private chats, so `/reply` works
from a private admin chat only.

## 4. Deployment
Order matters: database first, then code, then Telegram.
1. Neon SQL editor, as the owner: run `backend/migrations/013_telegram.sql`.
   It includes the `GRANT` for `protodesign_user`.
2. Fill the `Telegram*` lines in `infra/parameters.sh` and deploy:
   ```
   cd infra && source parameters.sh && sam build && \
   sam deploy --profile protodesign --parameter-overrides "$PARAMETER_OVERRIDES"
   ```
3. Point Telegram at the webhook. Run this from `infra/` so the token comes
   from `parameters.sh` instead of your shell history. `<FunctionUrl>` is the
   stack's `ApiFunctionUrl` output **without its trailing slash** (the same
   value as `BackendUrl`); with the slash the URL becomes `…on.aws//api/…`,
   every update gets a 404, and only `getWebhookInfo` shows it:
   ```
   source parameters.sh && curl -s "https://api.telegram.org/bot${TelegramBotToken}/setWebhook" \
     -d url="<FunctionUrl>/api/webhooks/telegram" \
     -d secret_token="${TelegramWebhookSecret}" \
     -d allowed_updates='["message"]' -d drop_pending_updates=true
   ```
   Check it with `getWebhookInfo`: `last_error_message` should be empty after
   you send the bot `/start`.
4. Get your chat id (§3), add it to `TelegramAdminChatIds`, redeploy.
5. Push to `master` so Vercel builds the frontend. The buttons appear by
   themselves once `/api/telegram/status` reports `enabled: true`.

## 5. Testing
`cd backend && npx tsx --test test/telegram.test.mjs` runs the real Lambda
entry point against a temporary Postgres, with the Bot API stubbed. It covers
the signed link, `/start`, forged references, the webhook secret, group chats,
payment settlement (exactly one alert), failed payments, `/stop`, blocked
chats, `/status`, forwarding and `/reply`.

End to end, after deploying: tap "Get updates on Telegram" on one of your own
orders, press Start, and check the bot replies with the order's status. Then
change that order's status in the admin panel and check the update arrives.

## 6. Rollback
- **Switch off, fastest:** clear `TelegramBotToken` and redeploy. Every
  Telegram route answers 404, nothing is sent, the buttons hide, and orders,
  quotes and payments are untouched. Also run `deleteWebhook` so Telegram
  stops retrying.
- **Code:** redeploy the previous commit. The migration is additive, so older
  code runs against the new schema.
- **Schema:** see the rollback block at the top of `013_telegram.sql`. It
  drops every Telegram subscription.

## 7. Known limits
- **Redelivery.** The webhook answers 200 even when handling an update fails,
  so Telegram does not resend it. If the Lambda itself times out mid-update,
  Telegram resends, and a reply can go out twice. Updates are not
  de-duplicated by `update_id`; with 2 s sends this needs a stalled database.
- **Customer-made cancellations** and payments that fail to start send no
  Telegram message: the customer sees those on screen.

## 8. Security
- The webhook rejects any request without the exact secret (constant-time
  compare), and serves private chats only.
- The token never reaches the browser or the logs: the frontend only gets
  `t.me` links, and send failures log the HTTP status and error code, never
  Telegram's description, which can echo the request URL.
- Chat ids are logged with only their last four digits.
- Customer text is capped at 1000 characters and sent as plain text (no
  `parse_mode`), so it can't inject formatting or links into admin chats.
