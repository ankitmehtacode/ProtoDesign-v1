# WhatsApp integration

Meta's official WhatsApp Cloud API, called directly from the existing Lambda
backend. No BSP (Twilio, WATI, Interakt, …), no unofficial libraries, no new
paid AWS resources. Repository findings that shaped this design are in
[`whatsapp-integration-audit.md`](whatsapp-integration-audit.md).

## 1. Architecture

```
Customer's WhatsApp ──(Meta)──► POST /api/webhooks/whatsapp   (same Lambda, same Function URL)
                                   │ verify X-Hub-Signature-256
                                   │ INSERT whatsapp_events ... ON CONFLICT DO NOTHING   (idempotency)
                                   │ async self-invoke ───────────────┐
                                   ▼ 200 at once                      ▼
                                                           Lambda (worker invocation)
                                                           whatsapp.worker.js
                                                             ├ inbound: contact, consent, commands,
                                                             │  links, model files → S3 + quotes row
                                                             ├ statuses: sent/delivered/read/failed
                                                             └ outbound queue → Graph API (free window check)

Order/quote/payment code ─► notifyOrder / notifyQuote ─► INSERT whatsapp_messages (queued) ─► kick worker
                             (never throws, never calls Meta inline)
```

- **Async without new infrastructure:** the webhook stores events and invokes
  its own function with `InvocationType: 'Event'`. `app.ts` sends that event
  shape to `runWorker()` and everything else to Express. A Function URL
  request can never produce that shape, and a direct invoke needs IAM.
- **Queue = table:** outbound messages are `whatsapp_messages` rows
  (`queued → sending → sent → delivered → read`, or `failed` / `skipped`).
  Work is claimed with `FOR UPDATE SKIP LOCKED` plus a 2-minute lease, so
  concurrent or crashed workers neither double-process nor lose work.
- **Retries:** a retryable Graph error (5xx, throttling, network, expired
  token) puts the message back in the queue, with one extra minute of backoff
  per attempt, up to 5 attempts. Retries run on the worker's next start, which
  any webhook or new notification triggers. There is no timer, on purpose.

## 2. Meta setup
1. At developers.facebook.com, create an app of type **Business** and add the
   **WhatsApp** product. This creates, or links, a WhatsApp Business Account (WABA).
2. In **App settings → Basic**, copy the **App Secret** into `MetaAppSecret`.
3. Create a **System User** in Business Settings, give it the app and the
   WABA, and generate a **permanent token** with `whatsapp_business_messaging`
   and `whatsapp_business_management`. That token is `WhatsAppAccessToken`.
   The 24-hour token on the API Setup page is for trying things out only.

## 3. WABA
Business verification in Meta Business Manager is free. Without it, you can
start at most 250 business-initiated conversations per 24 hours, which is not
a constraint in free-only mode.

## 4. Phone number
- Meta gives you a **test number** that can message up to 5 numbers you
  register as testers. Use it with `WHATSAPP_MODE=live`, a non-production
  `NODE_ENV` and `WhatsAppTestRecipients`.
- **Production number:** a number registered to the Cloud API generally
  stops working in the regular WhatsApp or WhatsApp Business app. Meta has
  been rolling out a "coexistence" option for the Business app; check whether
  it is available for your number before moving +91 8249581682. Otherwise use
  a separate number.
- Copy the number's **Phone number ID** into `WhatsAppPhoneNumberId`, and the
  number itself, digits with country code, into `WhatsAppBusinessNumber`.

## 5. Environment variables
Server-side only. They are SAM `NoEcho` parameters where secret, set as Lambda
environment variables, with values in the gitignored `infra/parameters.sh`. No
`VITE_*` variable holds any of them.

| Variable | Required | Meaning |
|---|---|---|
| `WHATSAPP_MODE` | – | `off` (default), `mock` (no calls to Meta), `live` |
| `WHATSAPP_ACCESS_TOKEN` | live | System-user token |
| `WHATSAPP_PHONE_NUMBER_ID` | live | Sender's phone number id |
| `WHATSAPP_BUSINESS_NUMBER` | mock/live | Number customers message, e.g. `918249581682` |
| `WHATSAPP_VERIFY_TOKEN` | mock/live | Any long random string, also entered in Meta |
| `META_APP_SECRET` | mock/live | Verifies webhook signatures |
| `WHATSAPP_API_VERSION` | – | Graph version, default `v23.0` |
| `WHATSAPP_PAID_TEMPLATES` | – | `false` (default) = never billed. See §14 |
| `WHATSAPP_TEMPLATE_ORDER_UPDATE`, `WHATSAPP_TEMPLATE_QUOTE_UPDATE` | paid mode | Approved template names |
| `WHATSAPP_TEMPLATE_LANGUAGE` | – | Default `en` |
| `WHATSAPP_TEST_RECIPIENTS` | non-prod live | Comma-separated numbers that may be messaged outside production |
| `WHATSAPP_BODY_RETENTION_DAYS` | – | Message text kept for this many days, default 90 |

`WHATSAPP_BUSINESS_ACCOUNT_ID` from the original brief is **not** added,
because nothing in this integration reads it. Add it if template management
is ever automated.

If `WHATSAPP_MODE` is not `off` and a required variable is missing, WhatsApp
stays disabled and `whatsapp_misconfigured` is logged with the variable
**names**. The admin panel shows the same list.

## 6. Webhook configuration
In the app's **WhatsApp → Configuration**:
- Callback URL: `<Function URL>/api/webhooks/whatsapp`. The Function URL is
  in the stack outputs and in `BackendUrl`.
- Verify token: the value of `WhatsAppVerifyToken`.
- Subscribe to the **messages** field. That covers inbound messages and
  delivery statuses.

## 7. Templates (paid mode only)
Free-only mode needs no templates. For paid mode, create two **Utility**
templates, each with two body variables: `{{1}}` is the reference (for example
`#1A2B3C4D`) and `{{2}}` is the status (for example `Shipped`).

- `order_update`: "Update on your ProtoDesign order {{1}}: {{2}}. Reply here if you have any questions."
- `quote_update`: "Update on your ProtoDesign quote {{1}}: {{2}}. Reply here if you have any questions."

Put the approved names in the `WhatsAppTemplate*` parameters.

## 8. Local development
```
WHATSAPP_MODE=mock WHATSAPP_BUSINESS_NUMBER=919999999999 \
WHATSAPP_VERIFY_TOKEN=dev META_APP_SECRET=dev npm run dev      # in backend/
```
Mock mode records outbound messages as `sent`, with a `mock.` id, and never
calls Meta. To post a signed webhook by hand:
```
BODY='{"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"x"},"messages":[{"from":"919876543210","id":"wamid.local1","timestamp":"'$(date +%s)'","type":"text","text":{"body":"STATUS"}}]}}]}]}'
curl -X POST localhost:3001/api/webhooks/whatsapp -H 'content-type: application/json' \
  -H "x-hub-signature-256: sha256=$(printf %s "$BODY" | openssl dgst -sha256 -hmac dev -hex | awk '{print $2}')" -d "$BODY"
```

## 9. Testing
`cd backend && npm test` runs everything. `test/whatsapp.test.mjs` has 32
cases against a real temporary Postgres, with Meta, SMTP, S3 and PhonePe
stubbed. They cover webhook verification, bad, missing and wrong-secret
signatures, duplicate deliveries, inbound messages, delivered/read/failed
statuses, the quote and payment flows, Graph outages, opt-out and back in,
refused marketing, malformed numbers, missing configuration, the
non-production guard, mock mode, and the free-window rule.

## 10. Deployment
Order matters: database first, then code, then Meta.
1. Neon SQL editor, as the owner: run `backend/migrations/011_whatsapp.sql`.
   It includes the `GRANT` for `protodesign_user`.
2. Fill the `WhatsApp*` lines in `infra/parameters.sh`. Start with
   `WhatsAppMode=off` to ship the code dark.
3. Deploy:
   ```
   cd infra && source parameters.sh && sam build && \
   sam deploy --profile protodesign --parameter-overrides "$PARAMETER_OVERRIDES"
   ```
4. Set `WhatsAppMode=live`, redeploy, then save the webhook in Meta (§6).
   Saving the webhook calls `GET /api/webhooks/whatsapp`, which only answers
   once the mode is on.
5. Push to `master` so Vercel builds the frontend. The buttons appear by
   themselves once `/api/whatsapp/status` reports `enabled: true`.

## 11. Rollback
- **Switch off, fastest:** set `WhatsAppMode=off` and redeploy. Every
  WhatsApp route answers "not enabled", nothing is queued, the frontend hides
  the buttons, and orders, quotes and payments are untouched.
- **Code:** redeploy the previous commit. The migration is additive, so older
  code runs against the new schema.
- **Schema:** see the rollback block at the top of `011_whatsapp.sql`. It
  drops every WhatsApp record. Quotes created from WhatsApp stay as ordinary
  quotes.

## 12. Troubleshooting
All logs are structured JSON in CloudWatch `/aws/lambda/protodesign-api`.
Filter by `event`:

| Symptom | Look for |
|---|---|
| Meta cannot verify the webhook | `whatsapp_webhook_verify_rejected`. Mode off → 404; token mismatch → 403 |
| Messages arrive, nothing happens | `whatsapp_webhook_rejected` (bad signature: wrong `META_APP_SECRET`), `whatsapp_kick_failed` (IAM), `whatsapp_event_failed` |
| Every send fails | `whatsapp_auth_failed`: the token expired or was revoked. Replace `WhatsAppAccessToken` |
| A message shows `skipped` | `error_code`: `window_closed` (free-only rule), `opted_out`, `no_service_consent`, `non_production_recipient`, `disabled` |
| `failed` with 131030 | Test number: the recipient is not registered as a tester |
| `failed` with 131026 | Recipient cannot receive: not on WhatsApp, or an old app version |

## 13. Consent model
- **Service consent** is created only by the customer's own action: sending
  the pre-filled "Get updates on WhatsApp" message, sending a model file, or
  replying START. Each consent row stores its source and the exact
  `consent_text`.
- **Link security:** the pre-filled message carries `O-XXXXXXXX-SIGNATURE`,
  an HMAC over the full order or quote id. `GET /api/whatsapp/link` issues it
  only to the logged-in owner, so guessing an id prefix cannot subscribe
  anyone to someone else's order.
- **Replies** to a customer's own message need no stored consent. They answer
  a conversation the customer started.
- **Notifications** (status updates) require an active service consent and no
  opt-out.
- **Marketing:** this app never creates it. `enqueueMessage` and the worker
  both refuse `category: 'marketing'` without an active marketing consent.
- **Opt-out:** STOP, STOP ALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPT OUT or
  OPTOUT, as the entire message, sets `opted_out_at`, revokes all consents
  (kept, not deleted), skips queued notifications, and sends one confirmation.
  Order, quote and message history is kept. START turns updates back on. Only
  an exact match counts, so "cancel my order" is not an opt-out.

## 14. Message cost
From Meta's pricing page (checked 2026-09-25): non-template messages sent
inside the 24-hour customer service window are free, as are utility templates
sent inside it. Utility templates outside the window are billed per message,
and marketing templates are always billed. Rates change, so none are
hard-coded here.

With `WHATSAPP_PAID_TEMPLATES=false`, the default, **the code never sends
anything outside the window.** Those notifications are recorded as
`skipped / window_closed`, the email that already existed still goes out, and
Meta's per-message charge is zero. The admin panel counts "Billable (30d)",
which comes from Meta's own `pricing.billable` flag in status webhooks, and
"Not sent, window closed (30d)", which shows what paid mode would have sent.

What stays free in practice:
- Link confirmation with the current status.
- The STATUS command.
- Replies from the admin panel.
- Model-file intake.
- Any update that happens within 24 hours of the customer's last message. For
  example, "payment confirmed" if they linked the order before paying, or a
  quick status change.

What is not free:
- A "shipped" message days later. It needs paid mode, or the customer
  messaging you again.

Other costs:
- **AWS:** one extra async invoke per webhook delivery that adds new events.
  That's well within Lambda's perpetual free tier of 1M requests per month.
  No API Gateway, SQS, EventBridge or Secrets Manager.
- **Unconfirmed, check before relying on it:** whether Meta requires a
  payment method on the WABA before any number can send, even free service
  messages.

## 15. Security
- Webhook: HMAC-SHA256 over the exact raw bytes with the App Secret,
  compared in constant time. The raw body is captured on both the Lambda path
  and the local path. The verify token is also compared in constant time, and
  the challenge echo is restricted to a plain token.
- Only events for our `phone_number_id` are accepted. Payloads are
  shape-checked, capped in size and treated as data.
- The access token is sent only to `graph.facebook.com` and Meta's media
  hosts (`fbsbx.com`, `fbcdn.net`, `whatsapp.net`). It is never logged or sent
  to the browser. Logs mask phone numbers (`91******10`).
- Files arriving in chat: extension allowlist, 25 MB cap, stored under
  `quotes/models/whatsapp/<contactId>/` with a fixed `application/octet-stream`
  content type, and downloadable only by admins through the existing
  short-lived signed URL.
- Least privilege: the one IAM addition is `lambda:InvokeFunction` on this
  function itself. The DB grant covers the five new tables only.
- Data minimisation: message text is cleared after 90 days, webhook payloads
  are cleared once processed, and processed events are deleted after 30 days.
  Status payloads keep no recipient number.

## Files changed
**New:** `backend/migrations/011_whatsapp.sql`,
`backend/src/services/whatsapp.service.js`,
`backend/src/services/whatsapp.worker.js`,
`backend/src/routes/whatsapp.routes.js`, `backend/test/whatsapp.test.mjs`,
`src/components/WhatsAppUpdatesButton.tsx`,
`src/components/admin/WhatsAppPanel.tsx`, `src/hooks/use-whatsapp-status.ts`,
`docs/whatsapp-integration.md`, `docs/whatsapp-integration-audit.md`.

**Modified:**
- `backend/app.ts`: raw body capture, route mounts, worker handler.
- `backend/src/services/order.service.js`: "paid" hook.
- `backend/src/routes/orders.routes.js`: shipped, delivered and cancelled hooks.
- `backend/src/routes/quotes.routes.js`: returns `quoteId`; status hook only on
  a real change.
- `backend/src/services/storage.service.js`: `isModelFilename`, `storeModel`.
- `backend/src/services/email.service.js`: `sendAdminAlert`.
- `backend/test/helpers/temp-postgres.mjs`: applies migration 011.
- `backend/package.json`: `@aws-sdk/client-lambda`; test script.
- `backend/.env.example`, `infra/template.yaml`, `infra/parameters.example.sh`.
- `src/services/api.service.ts`.
- `src/pages/CustomPrinting.tsx`: button on the success screen.
- `src/pages/Orders.tsx`: button per order.
- `src/pages/AdminDashboard.tsx`: panel, and quotes without an email.
- `src/components/Footer.tsx`: "Chat with ProtoDesign".
