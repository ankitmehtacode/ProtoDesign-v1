# WhatsApp integration — repository audit

Audit of the code as it stood on `master` at `3edc92b` (2026-09-25), done
before any WhatsApp code was written. Where the integration brief described the
system differently, this file records what the code actually does.

## 1. Layout

| Area | Location | Notes |
|---|---|---|
| Frontend entry | `src/main.tsx` → `src/App.tsx` | React 18 + Vite SPA, React Router, TanStack Query, shadcn/Radix + Tailwind |
| Frontend API client | `src/services/api.service.ts` | Single `ApiService.request()` wrapper; JWT from localStorage in `Authorization` |
| Backend entry | `backend/app.ts` | Express app; `export const handler = serverless(app)` for Lambda, `app.listen` locally |
| Routing | `backend/src/routes/*.routes.js` | Mounted under `/api/{auth,products,orders,cart,quotes,user}`; sitemap at `/` |
| Lambda handler | `backend/app.ts` `handler` | Bundled by `backend/build.mjs` (esbuild) to `dist/lambda.mjs` |
| DB access | `backend/src/config/database.js` | `pg-promise`; pool max 1 under Lambda; Neon **pooled** endpoint |
| Migrations | `backend/migrations/*.sql` | Plain SQL, applied by hand (Neon SQL editor as `neondb_owner`). No runner. Tests apply `001`, `009`, `010` via `test/helpers/temp-postgres.mjs` |
| Auth | `backend/src/middleware/auth.js`, `isAdmin.js` | JWT bearer; admin role re-read from `user_roles` per request |
| Errors | `backend/src/middleware/errorHandler.js` | 5xx messages masked outside development; structured `console.*(JSON.stringify({event,...}))` logging everywhere |
| Tests | `backend/test/*.mjs` | `node:test` against a real disposable Postgres; only external HTTP boundaries (PhonePe, SMTP) are stubbed |
| Deploy | `infra/template.yaml` (SAM), `infra/samconfig.toml`, `infra/parameters.sh` (gitignored) | One Lambda + Function URL (no API Gateway, on purpose — cost), S3 model bucket, 14-day log group |

## 2. Business flows as implemented

### RFQ ("custom printing" quote)
- UI: `src/pages/CustomPrinting.tsx`. Login required. Fields: model file
  (`.stl`/`.obj` in the dropzone), quality, material + colour, infill, scale,
  rotation, **email**, **phone** (free text), notes. No name or company field.
- API: `POST /api/quotes/upload-url` (presigned S3 PUT) → browser uploads →
  `POST /api/quotes/request` inserts into `quotes` and sends admin + customer
  emails (Gmail SMTP, awaited with `allSettled`).
- **Model files live in S3** (`quotes/models/<userId>/…`), not Cloudinary as the
  brief assumed. Cloudinary holds product media only.
- `quotes` table: `user_id` nullable, `email NOT NULL`, `phone`, `file_url`
  (S3 key), `file_name`, `specifications JSONB NOT NULL`, `status`,
  `estimated_price`, `admin_notes`.
- Quote statuses (admin select in `AdminDashboard.tsx`): `pending`,
  `contacted`, `paid`, `completed`, `rejected`. Set by `PUT /api/quotes/:id/status`.
  There is **no "quotation ready" state and no quote document/URL** — the
  customer is contacted manually.
- `POST /api/quotes/request` does not return the new quote's id.

### Orders and PhonePe
- `backend/src/services/order.service.js` owns the lifecycle. Server computes
  totals; stock reserved on create.
- Statuses: `pending`/`pending_payment` → `processing` (only after
  `settlePayment` sees PhonePe's **status API** report COMPLETED for the exact
  amount) → `shipped` → `delivered`/`completed`; `cancelled` is terminal.
- PhonePe webhook: `POST /api/orders/payment/callback` — body treated only as a
  hint; state re-verified with PhonePe. `settlePayment` returns `'paid'` exactly
  once per order (guarded UPDATE), which is the correct hook for a
  "payment confirmed" notification.
- Admin status changes: `PUT /api/orders/:id`; emails the customer for
  `shipped`, `delivered`, `cancelled`.
- There are **no** "production started/completed" states and **no tracking
  URL/number** field. Those notifications are therefore not implemented.
- Checkout phone: 10-digit Indian mobile, validated client-side, stored inside
  `orders.shipping_address` JSON.

### Contact / support
- Footer and Legal page show `help@protodesignstudio.com` and
  `tel:+918249581682`. No WhatsApp link or chat exists anywhere in `src/`.

## 3. Constraints that shape the design
1. **Lambda freezes on response.** Anything not awaited before the response
   never runs (existing code already awaits emails for this reason). A webhook
   that must "return 200 quickly" and then do slow work needs a second
   invocation.
2. **No queue, no cron, no API Gateway** exist, deliberately, for cost.
3. **Timeout 20 s, pool size 1** per Lambda container.
4. **Raw body**: under Lambda `req.body` arrives as a Buffer and is parsed by a
   custom middleware in `app.ts`; locally `express.json()` consumes the stream.
   Meta signature verification needs the exact raw bytes on both paths.
5. **DB role**: the app connects as `protodesign_user`, which only has the
   privileges explicitly granted; tables are owned by `neondb_owner`. New
   tables need explicit grants (this is what broke cart/image deletes on
   2026-09-25).
6. **Secrets convention**: SAM `NoEcho` parameters → Lambda environment
   variables, values in gitignored `infra/parameters.sh`. No Secrets Manager
   (cost). No secrets in `VITE_*` variables.

## 4. Where WhatsApp adds real value (and what it costs)
Meta charges nothing for messages sent inside a 24-hour customer service
window opened by the customer's own message; business-initiated templates
outside that window are billed. With a ₹0 target, the value is in
**customer-initiated** flows:

| Flow | Value | Free? |
|---|---|---|
| Customer links an order/RFQ from the site ("Get updates on WhatsApp") and gets current status | High | Yes — reply inside the window |
| Payment confirmed, quote status change, shipped/delivered **while the window is open** | Medium | Yes |
| Same events **after** the window closed | Medium | No — billed template; off by default, email already covers it |
| Customer sends STL/OBJ in chat → RFQ created | High | Yes |
| Support conversation, admin replies from dashboard | High | Yes, inside the window |
| Marketing | Not requested by the business | Not built; guarded against |
