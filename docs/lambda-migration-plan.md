# Migration Plan: App Runner → Lambda

**Status:** Phase 1 complete, Phase 2 next
**Goal:** Eliminate recurring AWS spend (~₹1,270/month) while keeping the app functionally identical.
**Decisions taken:** new AWS account + Lambda; the old AWS account stays open with its
data, but its billable compute is deleted; **the database is NOT a clean slate** — it is
the existing Neon project, reconnected, with real production data (verified
2026-09-18: 143 users, 35 products, 8 orders, 5 quotes, 3 admins already seeded).
Only AWS (compute + storage) is starting fresh; Neon never was AWS and was never part
of the account being replaced. Cloudinary keeps images/video, S3 takes STLs only.
**Author:** drafted 2026-09-18

---

## 1. Objective and constraints

App Runner bills provisioned container-hours regardless of traffic. At current volume the
service is idle most of the time, so we are paying for availability we do not use. Lambda
scales to zero and its free tier is perpetual rather than trial-based.

**Hard constraints:**

- Recurring cost must be ₹0 or near-₹0 at current traffic.
- No functional regression: checkout, quotes, admin, and email must behave identically.
- The old account stays live until the new one is proven. Every phase is reversible
  until teardown.

### What the clean-slate decision changes — and what it does not

The clean slate applies to **AWS only**: no cross-account S3 copy, no legacy-URL
coexistence logic, every upload uses the new scheme from day one. That removed the two
most error-prone parts of the original plan.

**It never applied to the database, and was wrongly stated as if it did in an earlier
draft of this section.** Neon was never part of the AWS account being replaced — it is
reconnected as-is. Corrected 2026-09-18 after connecting directly and verifying: this is
the same Neon project the app used before, holding 143 real users, 35 products, 8 orders,
5 quotes, and 3 admin accounts already on file. See §5b.3 for what was verified live and
what schema drift was found. Nothing here is provisioned fresh or seeded; `DATABASE_URL`
just needs to point at Neon's existing pooled (`-pooler`) endpoint.

`migrations/complete_schema.sql` was still worth fixing (§5.6) — it is wrong as a
description of a from-scratch bootstrap, and might matter for a future disaster-recovery
restore — but fixing it was never on the critical path here, since the live database was
never actually broken by the gap it had.

**On the credits:** with Lambda as the target, the new account's credits are a safety
buffer during the build rather than the plan itself. That is the right way round -- the
zero-cost outcome comes from Lambda's perpetual free tier, not from the credits, so there
is no six-month cliff to repeat.

**Explicit non-goals:** performance work, the security findings in the existing audit
(tracked separately), and any redesign of the data model. Those are real but orthogonal;
mixing them into a platform migration makes both harder to verify and to roll back.

---

## 2. Target architecture

```
Browser
  ├── static assets ──────────────→ Vercel (free tier)
  ├── STL upload (direct PUT) ────→ S3 bucket          [bypasses Lambda]
  ├── image/video upload (direct) → Cloudinary          [bypasses Lambda]
  └── /api/* ─────────────────────→ Lambda Function URL
                                      └── Express app (unchanged routing)
                                            └── Postgres (pooled endpoint, TLS, no VPC)
```

### Decisions and why

**Single Lambda, not one function per route.** The entire Express app moves behind one
handler via `serverless-http`. One warm container serves every route, so cold starts are
amortised instead of multiplied, and `app.ts` routing is unchanged. Per-route functions
would require API Gateway for routing — the exact service we are avoiding.

**Function URL, not API Gateway.** API Gateway is not always-free: 1M calls free for 12
months, then $1.00/M (HTTP) or $3.50/M (REST). Function URLs carry no per-request charge
at all. This single choice is what makes the zero-cost target achievable.

*What we give up:* custom domains, WAF, and request validation at the edge. CORS is
already handled in `app.ts` so it moves unchanged. If a custom API domain is needed later,
CloudFront in front of the Function URL stays free (1 TB egress, 10M requests/month).

**Never in a VPC.** A NAT Gateway costs ~$32/month — more than twice the bill we are
escaping. Postgres is reached over public TLS (`src/config/database.js:24`), so the
Lambda stays outside any VPC. This is non-negotiable; it is the single easiest way to
accidentally make this migration cost more than the status quo.

**Node 22, arm64, 1024 MB.** Memory sizing against the free tier:

| Memory | Free GB-s ÷ memory | ÷ 300ms avg | Invocations/month |
|--------|--------------------|-------------|-------------------|
| 512 MB | 800,000 s          | 300 ms      | ~2.6M             |
| 1024 MB| 400,000 s          | 300 ms      | ~1.3M             |

Both exceed the 1M request cap, so the request limit binds before the compute limit
either way. 1024 MB is chosen because Lambda scales CPU with memory — it reduces cold
start and latency at no effective cost.

**Storage split: Cloudinary for images/video, S3 for STLs.** Cloudinary already works
(`src/services/storage.service.js`) and gives a free CDN plus resizing. STLs are large,
read rarely, and need no transformation — they would burn the Cloudinary allowance for no
benefit. Because `quotes.file_url` stores a **full URL** rather than a key, old Cloudinary
objects and new S3 objects coexist with **no data migration**.

---

## 3. Cost model after migration

| Component        | Service                  | Free allowance                   | Expected cost |
|------------------|--------------------------|----------------------------------|---------------|
| API compute      | Lambda                   | 1M req + 400k GB-s, **perpetual**| ₹0            |
| API ingress      | Function URL             | No per-request charge            | ₹0            |
| Egress           | Lambda → internet        | 100 GB/month                     | ₹0            |
| Frontend         | Vercel Hobby             | Generous, perpetual              | ₹0            |
| Images/video     | Cloudinary               | 25 GB/month pooled               | ₹0            |
| STL storage      | S3, 5 GB                 | Trial only — see note            | **~₹12/mo**   |
| Email            | Gmail SMTP (existing)    | 500/day                          | ₹0            |
| Database         | Neon free tier (new)     | Perpetual, connection-capped     | ₹0            |

> **S3 caveat.** The 5 GB / 20k GET tier is a 12-month trial, not an always-free offer.
> Because a $100 credit was consumed, this account is likely on AWS's newer credit-based
> free tier, where those trials largely do not apply. Assume S3 bills from day one at
> roughly $0.023/GB — about ₹12/month for 5 GB. Confirm in Billing → Free Tier.

**Verdict: ~₹12/month, down from ~₹1,270.** The database line is now a decision rather
than an unknown, so this figure is no longer contingent on discovery.

---

## 4. Phase 0 — Discovery (no longer blocking)

No longer gates the plan the way it originally did: the database question is resolved
(§5b.3 — it is the existing Neon project, reconnected, verified live). Two reasons remain
to run this, both cheap:

1. **To know what is still billing in an account you are keeping.** The account stays
   open, so anything running in it keeps charging. You cannot stop what you have not
   found — an orphaned RDS instance would outlive the App Runner deletion unnoticed. Now
   that Neon is confirmed as the real database, a live RDS instance would mean something
   else was running alongside it, not instead of it — worth knowing either way.
2. **To confirm the diagnosis.** If a large share of the ₹3,800 turns out to be something
   other than App Runner, that shapes what we avoid recreating in the new account.

Note the repo has had no commits since 2026-02-12 — roughly seven months of an idle
App Runner container billing for availability nobody used. That is consistent with the
bill and is exactly the cost Lambda's scale-to-zero eliminates.

Re-authenticate the AWS CLI (its token is currently expired), then:

```bash
# 1. What is App Runner actually passing as DATABASE_URL?
aws apprunner list-services --region ap-south-1
aws apprunner describe-service --region ap-south-1 --service-arn <ARN> \
  --query 'Service.SourceConfiguration.*.ImageConfiguration.RuntimeEnvironmentVariables'

# 2. Is there an RDS instance quietly billing?
aws rds describe-db-instances --region ap-south-1 --query 'DBInstances[].[DBInstanceIdentifier,Engine,DBInstanceClass]'

# 3. What is actually generating the bill, by service?
aws ce get-cost-and-usage --time-period Start=2026-06-01,End=2026-09-01 \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

Query 3 is the important one — it replaces our assumptions about where ₹3,800 went with
a fact, and will confirm or refute the assumption that Amplify is also contributing. Query
1 is now confirmatory rather than a discovery step — it should show the same Neon host
already verified in §5b.3, not a different database.

The new AWS account needs no database of its own: `DATABASE_URL` points at the **existing**
Neon project's pooled endpoint, unchanged. No migration, no dump, no restore, no fresh
provisioning.

---

## 5. Phase 1 — Lambda-compatible code — ✅ COMPLETE

All changes are deployable to the *existing* App Runner service and verifiable there.
Nothing platform-specific is switched on yet, so the whole phase reverts with `git revert`.

**5.1 Handler export** — `app.ts` now exports `handler` via `serverless-http`, with
`app.listen()` guarded behind `if (!IS_LAMBDA)` so local dev and containers are unchanged.
Routing is untouched. CORS origins moved to a comma-separated `FRONTEND_URLS` env var; the
hardcoded Amplify URL is gone, since that account is being retired.

**5.2 Build step** — `build.mjs` bundles to a single ESM file via esbuild.
`npm run build` → `dist/lambda.mjs` (4.1 MB); `npm run package` → `lambda.zip` (867 KB).
`pg-native` is marked external and a `createRequire` banner restores `require` for the CJS
dependencies. Measured JS init: **~218 ms**, so expect a ~400-500 ms real cold start.

**5.3 Dangling email promises — all six fixed.** Lambda freezes the execution environment
the moment a response returns, so these would have silently stopped sending:

| File | Site | Email |
|------|------|-------|
| `orders.routes.js` | order creation | Order confirmation |
| `orders.routes.js` | status update | Shipped/delivered/cancelled |
| `quotes.routes.js` | quote request | Admin notification |
| `quotes.routes.js` | quote request | Customer confirmation |
| `auth.service.js`  | signup | Welcome |
| `auth.service.js`  | Google signup | Welcome |

Each is now awaited before responding. Two carried explicit `// BACKGROUND - NO AWAIT`
comments — correct reasoning for a long-lived server, wrong for Lambda. The quote pair is
awaited with `Promise.allSettled` so a mail failure cannot fail the quote. Every handler
now logs structured JSON (`{event:'email_failed', type, id, error}`) instead of a bare
string, so CloudWatch can be filtered on it.

**5.4 Connection pooling** — `max: 1` under Lambda (one container serves one request; a
bigger pool only multiplies connections by concurrency). `DATABASE_URL` is now required
and the app refuses to start without it. The eager `db.connect()` at module load is gone:
it added a round-trip to every cold start and its `.catch()` swallowed the failure, so the
process continued against a database it could not reach.

Also removed: the `receive` hook that claimed to convert snake_case to camelCase. Under
pg-promise v12 the `receive` signature is a single event object, so it was iterating
`data`/`result`/`ctx` rather than column names — a silent no-op. Verified safe: every
camelCase read in the codebase is either `req.body` or a `snake_case || camelCase`
fallback, so nothing depended on it. The defensive fallbacks throughout the code were
written around a transform that never fired.

**5.5 Eager SMTP verify removed** — `email.service.js` ran `transporter.verify()` at module
load, opening a real Gmail handshake on every cold start while gating nothing (result
logged and discarded). Replaced with a config-presence warning.

**5.6 Schema bootstrap file fixed** — worth doing, but see the correction in §5b.3: the
live Neon database was never actually broken by this. `complete_schema.sql` was missing
`payment_status`, which `orders.routes.js` writes on every settled payment; a database
built from that file *from scratch* would throw on every successful PhonePe payment.
Migration `009_add_payment_status.sql` had already been run against the real database at
some point without ever being folded into this file — so the bootstrap script and the
live schema had quietly diverged. Fixed by folding it in, adding a supporting index, and
correcting the stale `payment_gateway DEFAULT 'razorpay'` to `'phonepe'`. This matters for
a future disaster-recovery restore, not for this migration.

**5.7 `isAdmin` rewritten.** It queried `users.role` — a column the schema does not define
— and hid the resulting error in an empty `catch (e) {}`, falling through to `user_roles`.
Admin authorization was working *by accident*, and a real database fault was
indistinguishable from "not an admin". Now a single authoritative `user_roles` query that
fails closed and reports the error. Still checked per-request against the database rather
than read from the JWT, so revoking an admin takes effect immediately.

**5.8 Dependencies pruned** — removed `bcrypt` (native, and **never imported**; only
pure-JS `bcryptjs` is used — it would have broken the bundle), plus `@react-oauth/google`
and `react-js-phonepe-pg`, which are frontend packages with zero backend references, and
the unused `cross-env`.

**5.9 Dead upload path** — the `/uploads` static handler is removed from `app.ts`. The
three orphaned JPEGs under `backend/src/uploads/products/` have since been deleted
(along with `supabase/`, `src/extra/`, and `backend/migrations/old migrations/`).

### Verification performed

The built bundle was invoked directly with synthetic Function URL (payload v2.0) events,
with `DATABASE_URL` pointed at an unreachable host on purpose:

```
GET /api/health  -> 200  {"status":"OK","runtime":"lambda"}
GET /api/nope    -> 404  {"error":"Route not found"}
GET /sitemap.xml -> 500  (ECONNREFUSED — the intended database failure)
module init: ~218ms
```

Health and 404 responding while the database is unreachable is the point: it proves
nothing touches the database or SMTP at cold start.

**Not yet verified:** any authenticated path, payments, or uploads. Those need a real
database and are Phase 3 work.

---

## 5b. New account setup (do before Phase 3)

Order matters here — several items feed Phase 3's environment variables.

1. **Create the account** under the business entity if one exists, and enable a billing
   alarm at $1 immediately. An alarm is the only thing that turns a surprise bill into a
   same-day notification.
2. **Apply for AWS Activate** if eligible — $1,000+ legitimately, versus $100–200 from the
   free tier. Worth doing even though Lambda makes it unnecessary; it buys unhurried time.
3. **Reconnect the existing Neon project — do not provision a fresh one.**
   Corrected 2026-09-18: this is not a clean slate. It is the same Neon database the
   app used before, with 143 real users, 35 products, 8 orders, 5 quotes, and payments
   already on file. Verified read-only against the live database:
   - `orders.payment_status` **already exists** with the correct default. Migration
     `009` was run against this database at some point even though it was never folded
     into `complete_schema.sql` — the file was wrong (§5.6), but the live database was
     never actually broken by that gap.
   - `user_roles` already matches what the rewritten `isAdmin` (§5.7) expects, and
     **3 admin rows already exist.** No seeding needed.
   - **Schema drift found:** a `reference_images` table exists live that is in neither
     `complete_schema.sql` nor any current route or service (confirmed: zero references
     in `backend/src/`). Left alone — nothing depends on it — but it is a reminder that
     `complete_schema.sql` describes what the app needs, not a complete mirror of this
     database. Do not run it against Neon expecting it to be a from-scratch bootstrap;
     it was written and fixed for that purpose but has never been exercised that way
     here.
   - Get the **pooled** connection string (host contains `-pooler`) from the Neon
     dashboard for `DatabaseUrl` in `infra/parameters.sh` — required regardless, per
     §5.4's `max: 1` pool sizing. **Done** — filled in 2026-09-18 from the Neon console.
   - Confirmed via the Neon console (screenshots, 2026-09-18): **Free plan**; usage since
     Sep 1 is 0.36 CU-hrs and 33.5 MB storage, nowhere near free-tier limits. **No IP
     restrictions, no VPC** — consistent with this plan's "never in a VPC" decision (§2),
     since a restricted list would need updating for Lambda's non-static outbound IPs.
     **2 branches exist** (default: `production`); only `production` was verified above —
     confirm the other one isn't also live before assuming it's unused.
   - **Region correction:** the Neon project is in **AWS Asia Pacific 1, Singapore
     (`ap-southeast-1`)**, not Mumbai. `infra/samconfig.toml` originally defaulted the
     Lambda to `ap-south-1` — fixed to `ap-southeast-1` to match, so the function and its
     database share a region rather than paying a cross-region round trip on every query.
     This is unrelated to the old App Runner service, which genuinely was in `ap-south-1`
     (its URL: `7rphdmquxg.ap-south-1.awsapprunner.com`) — the Phase 0 discovery commands
     in §4 still correctly target that region for the *old* account.
4. ~~Seed an admin user~~ — not needed. Three already exist in this database.
5. **Generate fresh secrets.** New `JWT_SECRET`, and a **new Cloudinary API secret** — the
   old one is committed to a public repo and must be treated as compromised. A clean slate
   makes this rotation free; do it now rather than carrying a known-leaked credential into
   the new environment.
6. **Re-register external callbacks** once the Function URL exists: the PhonePe merchant
   callback URL and the Google OAuth authorized origins. Both fail silently and both sit
   on the revenue path — a stale PhonePe callback means payments that succeed at the
   gateway and are never recorded as paid.

---

## 6. Phase 2 — Direct uploads (the 6 MB ceiling) — ✅ COMPLETE

**Status:** implemented and verified by typecheck, build, and a unit test suite against
the presigning logic (`backend/test/storage.presign.test.mjs`, 15/15 passing). **Not yet
verified against real AWS** — that needs the bucket from Phase 3 to exist.

What shipped, beyond the plan below: `isAdmin` was extracted into shared middleware
(`backend/src/middleware/isAdmin.js`) so the quote admin routes could use it too. Those
routes — `GET /quotes/admin/all` and `PUT /quotes/:id/status` — **had no authentication at
all**; any unauthenticated caller could list every customer's email, phone, model and
specifications, or change any quote's status. Found while rewriting the file, fixed rather
than left for later. Quote models are now downloaded via a short-lived signed URL
(`GET /quotes/:id/download`) rather than a stored public link, since the bucket is private.

**This is the largest change and the one that must not be rushed.** Lambda's synchronous
invoke payload cap is 6 MB, shared by Function URLs. Current limits:

- `src/routes/quotes.routes.js:13` — 100 MB STL uploads
- `src/routes/products.routes.js:11` — 50 MB, up to 10 images **plus a video** in one request

Anything over 6 MB fails with no workaround. Uploads must not transit Lambda.

### 2a. STL → S3 presigned PUT

Replace the single multipart endpoint with a three-step flow:

1. `POST /api/quotes/upload-url` (authenticated) — validates declared content-type and
   size, returns a presigned PUT URL plus the server-generated object key.
2. Browser `PUT`s the file **directly to S3**. No Lambda involvement, no size ceiling.
3. `POST /api/quotes/request` — receives the key plus specs as small JSON, verifies the
   object exists via `HeadObject`, then writes the row.

**Security requirements on the presigned URL** (treat the client as hostile):
- Key is generated **server-side** and namespaced by `userId` — never accept a
  client-supplied path, or one user can overwrite another's objects.
- Pin `Content-Length` range and `Content-Type` in the signature.
- 5-minute expiry.
- The `HeadObject` check in step 3 is what prevents a row pointing at an object that was
  never actually uploaded.
- Bucket stays private with public access blocked; reads go through presigned GETs or
  CloudFront with OAC.

### 2b. Product images/video → Cloudinary signed direct upload

Same shape: a `POST /api/products/upload-signature` endpoint (admin-only, reusing the
existing `isAdmin` middleware) returns a Cloudinary signature; the browser uploads
directly. `storage.service.js` keeps its `uploadFromUrl` path for bulk import, which is
server-to-server and unaffected by the 6 MB limit.

### 2c. Frontend

`src/services/api.service.ts` gains the two-step upload helpers. Callers to update:
`src/pages/CustomPrinting.tsx` (STL), `src/pages/AdminDashboard.tsx` and
`src/pages/BulkUpload.tsx` (product media).

> **Deploy Phase 2 to App Runner and verify it there before touching Lambda.** Separating
> the risky application change from the platform change means that if uploads break, we
> know which of the two caused it.

Because no data carries over, there is no legacy-URL coexistence to handle and no backfill
— every upload uses the new scheme from the first request.

---

## 7. Phase 3 — Deploy Lambda — ✅ SCAFFOLDED, not yet deployed

`infra/template.yaml` defines the stack: the Lambda function (Node 22, arm64,
1024 MB, no VPC), its Function URL (`AuthType: NONE` — the app's own
`authMiddleware` is what actually gates routes, same as it did on App Runner),
the private S3 bucket for models, and IAM scoped to exactly
`s3:PutObject/GetObject/HeadObject` on `<bucket>/quotes/models/*` plus writing
to this function's own CloudWatch log group — nothing broader.

**Build reuses Phase 1's bundler, not a second path.** `infra/Makefile`'s
`build-ApiFunction` target runs `backend/build.mjs` (the same esbuild + CJS
`require()` shim already exercised by the Phase 1/2 smoke tests), rather than
SAM's own esbuild integration. What gets deployed is the artifact that was
already verified, not a fresh unverified bundle.

**No Cors block on the Function URL, deliberately.** Express's own `cors`
middleware in `app.ts` stays the single source of truth for allowed origins
and credentials. Configuring CORS at both the Function URL and in Express
risks duplicate `Access-Control-*` headers, which browsers reject outright.
Cost: OPTIONS preflights invoke Lambda instead of being absorbed at the URL —
immaterial at this app's volume.

**Secrets are plain Lambda environment variables**, not Secrets Manager
(~$0.40/secret/month) or SSM SecureString. Lambda encrypts them at rest with
an AWS-managed key at no cost either way; the tradeoff is that anyone with
`lambda:GetFunctionConfiguration` can read them in plaintext via the console.
Accepted here for a single-admin project at this size — revisit if that
changes.

**There is no parallel-run step.** The old backend is already stopped (see
§4), so there is nothing to run alongside and nothing to switch away from.
Deploy, then verify directly against the new Function URL.

### The two-pass deploy this requires

PhonePe's callback URL and the customer redirect need the app's own public
URL, which does not exist until the Function URL is created by this same
stack. `infra/README.md` §1–2 covers it: deploy once with `BackendUrl` and
`FrontendUrl` blank, read the Function URL back from the stack outputs,
redeploy with them filled in. Skipping the second pass means PhonePe calls
back into thin air — payments succeed at the gateway and are never marked
paid in the database.

### Still to do before this is live

- Run `sam build && sam deploy` against the new account (§5b) — **not yet
  executed**; everything above is written and structurally validated
  (YAML parses, every `!Ref`/`!GetAtt` resolves, no orphaned parameters) but
  unverified against real AWS.
- ~~Provision the Neon database~~ — not needed. It already exists, holds real
  production data, and is reconnected as-is (§5b.3).
- Verify end-to-end per `infra/README.md`'s checklist: health check, a quote
  upload over 6MB (the case that was impossible before Phase 2), an admin
  product create with images, and one full order with the confirmation email
  actually arriving.
- Re-register the PhonePe callback URL and Google OAuth origins.

---

## 8. Phase 4 — Frontend to Vercel — ✅ SCAFFOLDED, not yet deployed

Full instructions in `docs/vercel-deployment.md`. Summary of what changed here:

**`vercel.json`'s SPA rewrite already existed** and needed one addition: a
`/sitemap.xml` rewrite proxying to the Lambda backend, placed *before* the
catch-all in the array (Vercel matches in order). Without it, the catch-all
would intercept `/sitemap.xml` and silently return the React app's HTML shell
instead of XML — invisible in a browser, but search engines would index
nothing there. This only worked before because Vite's local dev proxy forwarded
`/sitemap.xml` to `localhost:3001`; that proxy has no equivalent on Vercel.

**`sitemap.routes.js`'s `baseUrl` was hardcoded** to `protodesignstudio.com` —
a domain this app was never actually deployed to (Amplify and App Runner used
their own subdomains). Fixed to read `FRONTEND_URL`, the same env var already
required for the PhonePe redirect, rather than adding a second place to
configure the same fact.

**CORS gained an opt-in preview-origin pattern.** Vercel gives every branch/PR
its own URL, which the existing exact-match `FrontendUrls` list cannot cover.
Rather than wildcard `*.vercel.app` — shared hosting, so that would trust every
other app deployed there too — `app.ts` now also accepts one project-scoped
regex via `FRONTEND_ORIGIN_PATTERN`, off by default. Enabling it is a
deliberate decision, not a default: preview branches would then talk to
**production** data (real orders, real PhonePe attempts) unless a separate
database is set up for them. See `docs/vercel-deployment.md` §4.

**Two dead components were removed while auditing this area:**
`src/components/AuthModal.tsx` was never imported anywhere, and duplicated
login/signup/Google auth via raw `fetch()` calls that bypassed `apiService`
entirely — bypassing its token storage, its 401 handling, everything. Kept
around, it was a component someone could wire up later and get silently broken
auth. `README.md` was two dead links (the App Runner URL, already 404, and the
Amplify URL, still live but serving a storefront with no working backend —
see the corrected timeline in §4) and nothing else; replaced with an accurate
one pointing at this plan.

### Still to do

- Deploy Phase 3 first — this phase needs the Function URL.
- Import the repo into Vercel, set `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID`.
- Fill in the real Function URL in `vercel.json`'s sitemap rewrite and in the
  backend's `FrontendUrls`/`FrontendUrl` parameters, then redeploy both.
- Decide on preview-deployment CORS deliberately (§4 above) rather than
  defaulting into it.

---

## 9. Phase 5 — Go live and decommission

**The old account stays open and keeps its data.** Nothing is exported, migrated, or
deleted from it. What gets deleted is the *billable compute*, which is a different thing
and is the entire point of the migration.

1. Point users at the new frontend. Keep the old account's services **running**.
2. Monitor for at least a week, ideally to a month boundary. Watch CloudWatch error rate,
   email delivery, and PhonePe callbacks specifically.
3. Then, in the **old** account, delete:
   - the **App Runner service** — this is ~100% of the recurring charge
   - the **Amplify app**
4. Leave in place: S3 buckets, the database, IAM, and the account itself.
5. Set a **billing alarm at $1** on the old account and leave it armed.
6. Confirm in Cost Explorer that the charges actually stopped. Deleting in the console is
   not proof of non-billing — verify against the bill.

### Actual timeline (corrected 2026-09-18)

An earlier draft of this document claimed the bill accrued over ~7 months of dormancy.
That was wrong. What happened:

| When | What |
|------|------|
| ~Dec 2025 – Feb 2026 | Active development; $100 credit covering usage |
| ~Mar – Jun 2026 | Credit exhausted, App Runner running → **₹3,800 over 3 months** |
| ~Jun 2026 | **App Runner stopped by the owner** |
| Today | Backend `/api/health` → **404** (not serving). Amplify → **200** (still live) |

**So nothing is currently bleeding from App Runner.** This migration is preventive, not
a fire. The lesson still holds — App Runner billed ~₹1,270/mo for provisioned capacity
regardless of traffic, which is exactly what Lambda's scale-to-zero removes — but there is
no active charge to stop.

### What this changes about the plan

**There is no live backend, therefore no cutover risk.** The original plan choreographed
running Lambda in parallel with App Runner, verifying, then switching traffic. None of
that is needed: there is no traffic and no working service to preserve. Deploy the Lambda,
point the frontend at it, done. This removes the riskiest sequencing in the whole plan.

**Amplify is still serving a broken storefront.** The frontend returns 200 while its API
is dead — visitors get a site where nothing loads, logs in, or checks out. Decide
deliberately: either take it down until the new backend is live, or leave it and accept
that anyone who finds it sees a broken shop. It is also the one thing in the old account
still plausibly billing.

### Still worth doing in the old account

1. Confirm the App Runner service is **deleted or paused**, not merely idle. A paused
   service bills nothing; a running one with no traffic still bills for provisioned
   memory. A 404 strongly suggests it is genuinely stopped, but verify in the console.
2. Delete or pause the Amplify app.
3. Set a **billing alarm at $1** and leave it armed.
4. Run the Cost Explorer query in §4 — with the account staying open, this is the only
   way to know whether anything in there is still charging.

---

## 10. Rollback

| Phase | Rollback | Reversible? |
|-------|----------|-------------|
| 1 | `git revert`, redeploy App Runner | Fully |
| 2 | `git revert`, redeploy App Runner | Fully — no data migration involved |
| 3 | Delete the SAM stack | Fully — nothing depends on it yet |
| 4 | Repoint `VITE_API_URL`, redeploy | Fully |
| 5 | **Irreversible after teardown** | Closing the old account cannot be undone |

Phases 1 and 2 are pure code and revert with `git revert`. Phases 3 and 4 are additive —
the old account keeps running untouched the whole time, so rollback is repointing
`VITE_API_URL`. Only Phase 5 is one-way.

**The old account is never closed**, so its data remains available indefinitely as a
fallback — which makes this migration unusually safe to reverse. The only irreversible
step is deleting the App Runner service, and recreating one from this repo is a redeploy,
not a rebuild.

Note that keeping the account means keeping responsibility for it: it needs a billing
alarm and an occasional look at the bill, because nothing else will tell you if something
in there starts charging.

---

## 11. Known risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| DB turns out to be RDS | Unknown — Phase 0 resolves | Re-plan; this becomes a DB migration first |
| Cold start hurts UX | Medium | 1024 MB + arm64 + minimal bundle; measure in Phase 3 before judging |
| Gmail SMTP 500/day cap | Low at current volume | Move to SES (62k/month free from Lambda) if it binds |
| Connection exhaustion | Medium | Pooled endpoint + `max: 1`; load-test in Phase 3 |
| Function URL has no WAF | Accepted | Not present on App Runner today either — no regression |

---

## 11b. Data residency (DPDP Act / RBI) — flagged 2026-09-18, unresolved

Raised mid-migration: does Indian law require this app's data to be stored in India? Checked
against current sources rather than answered from memory, since this affects a live paying
business with real customer data:

- **DPDP Act, 2023 has no blanket India-only mandate.** Section 16 uses a negative-list
  approach — cross-border transfer is allowed except to countries the government
  blacklists. As of August 2026, no country has been blacklisted, so Singapore is not a
  DPDP violation today. (Earlier draft bills, 2019/2021, were stricter; the enacted Act is
  not.)
- **RBI's 2018 payment-data-localization circular is the rule that might actually apply**,
  and it binds Payment System Operators / aggregators (PhonePe), not necessarily every
  merchant using one. This app's own database stores order metadata (`payment_status`,
  `payment_gateway`, `total_amount`, PhonePe's `merchantOrderId`) — not card numbers or UPI
  credentials. PhonePe, as the RBI-licensed PSO, is the one obligated to keep actual payment
  credentials in India, on its own infrastructure, regardless of where this app's server
  sits. Whether the broader "transaction data" language also sweeps in order-status
  metadata is genuinely unclear and **was not resolved here** — it needs an actual CA/lawyer
  opinion, not an AI's reading of a circular.
- **Neon has no Mumbai region** (checked directly: 8 AWS regions offered, Singapore is the
  closest to India). A project's region is fixed at creation; moving means `pg_dump`/
  `pg_restore` or logical replication into a new project, with real downtime for 143 live
  users, and effectively means leaving Neon for a provider that does offer Mumbai (e.g.
  RDS) — which also means leaving Neon's free tier. Not a decision to make as a side effect
  of a region question.

**Decision taken 2026-09-18:** Lambda and S3 stay in `ap-southeast-1`, matching the existing
database, until a legal opinion says otherwise. Revisit if that opinion concludes the RBI
circular's "transaction data" reaches this app's own order records.

---

## 11c. Future trigger: leaving Neon for an India-hosted stack — decided 2026-09-18

**Decision:** stay on Neon in Singapore, with Lambda/S3 co-located there (§11b), until Neon's
free tier is actually exhausted. At that point, do ONE combined migration rather than two:
move off Neon to an India-hosted Postgres provider (or RDS in `ap-south-1`) **and** move
Lambda/S3 to Mumbai in the same cutover. This deliberately avoids ever running the split
configuration modeled in §11b's latency analysis — Lambda in Mumbai while the database
stays in Singapore, which a 36-round-trip endpoint (`GET /products`'s N+1 query, see below)
would turn into a 2+ second page load.

**Correction to how the trigger works — it is not time-boxed.** Checked directly against
Neon's current plan docs: the Free plan has no expiration date. It is a **monthly usage
cap that resets**, not a clock that runs out like the AWS credits did. The real ceilings:

| Resource | Free limit | Current usage (2026-09-18) |
|---|---|---|
| Compute | 100 CU-hours/month | 0.36 CU-hrs |
| Storage | **0.5 GB** | 33.5 MB |
| Network transfer | 5 GB/month | — |
| Branches | 10/project | 2 |

At current usage, none of these bind. **Storage is the one that will actually trigger this
someday** — it is the smallest ceiling relative to how a growing product/order catalog
consumes it, and unlike the others it is unlikely to reset before it matters (data doesn't
get deleted between billing periods; only compute and transfer reset monthly).

**What happens at the limit is a hard stop, not a warning.** Per Neon's docs: exceeding
storage causes inserts/updates/deletes to start failing outright; reads keep working.
There is no grace period and no advance notice — the first sign would be a customer's
checkout failing to write. **Action item, not yet done:** set up monitoring on Neon's
storage usage (their API or console) with an alert well before 0.5 GB, so this is caught
as a dashboard warning rather than a production incident.

---

## 12. Out of scope, deliberately

The unauthenticated PhonePe callback (`src/routes/orders.routes.js:284`), the committed
Cloudinary secret in `backend/.env.example`, the divergent admin authorization paths, the
`DATE_TRUNC` row-matching bug in order cancel/address, and unrestored stock on cancellation
are all real and some are urgent — the leaked secret should be rotated today regardless of
this plan. They are excluded here so that a failure during migration is unambiguously a
migration failure. Track and fix them separately.
