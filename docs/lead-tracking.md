# Lead tracking (phase 1)

First-party visit tracking and an "Ask an expert" enquiry form, feeding a
**Leads** section in the admin. Everything runs on the existing Lambda and Neon
database: no third-party analytics, no new AWS resources.

Phase 3, the Search Console view of what people search before they arrive,
is in [search-demand.md](search-demand.md); phase 4, lead scoring and filament
reorders, in [lead-intel.md](lead-intel.md).

## What it can and cannot know

Google does not tell any website who searched for what. Search Console reports
search words only in aggregate, and organic visits arrive without them. So this
system does **not** identify people who searched for printers. It records what
the site itself sees, and only with permission:

| Visitor did | What is stored |
|---|---|
| Nothing (no consent choice yet, or "No thanks") | Nothing |
| Allowed analytics | A random visitor id; first-touch source (UTM tags, Google Ads `gclid`, referrer host, landing page); page views, product views, add-to-cart, print-quote uploads |
| Sent an enquiry | Name, phone/email, message, product, the exact consent wording, and a link to that browser's earlier visits (if analytics was allowed) |
| Is signed in | Their browser's visits are linked to their account |

## Flow

```
Browser (after "Allow")                      Lambda                       Neon
 track() queue ─ every 5 s / tab hidden ──►  POST /api/track  (text/plain beacon, no preflight)
                                              caps: 300/visitor/day, TRACKING_DAILY_EVENT_CAP/day
                                              ──► visitors (first touch) + visitor_events
 LeadCapture form ───────────────────────►  POST /api/leads  (consent + honeypot + LEADS_DAILY_CAP)
                                              ──► leads (merge on phone, else email), link visitor
                                              ──► Telegram alert to admin chats (new leads only)
 Admin → Leads ──────────────────────────►  GET/PATCH/DELETE /api/leads/admin[/:id]  (isAdmin)
EventBridge 04:00 IST ───────────────────►  runLeadMaintenance: prune + database size check
```

Code: `backend/src/services/leads.service.js`, `backend/src/routes/leads.routes.js`,
`src/lib/analytics.ts`, `src/components/AnalyticsConsent.tsx`,
`src/components/LeadCapture.tsx`, `src/components/admin/LeadsSection.tsx`.

## Storage budget

Neon's free tier stops **every write, checkout included**, at 0.5 GB. Guards:

- Events are small: 161 bytes each including indexes (measured on 10,000
  rows). 10,000 a day held for 30 days is about 50 MB.
- `TRACKING_DAILY_EVENT_CAP` (default 20,000) and 300 per visitor per day stop a
  bot from filling the database. Hitting a cap logs `tracking_daily_cap_reached`.
- Daily prune: anonymous visitors idle for 30 days (with their events), and
  every event older than 180 days.
- Daily size check: at `STORAGE_ALERT_BYTES` (default 400 MB) it logs
  `database_storage_high` and alerts the Telegram admin chats. The Leads page
  also shows database size.

## Deploying

1. Apply `backend/migrations/015_leads.sql` in the Neon SQL editor as
   `neondb_owner`. It is additive; its header has the rollback.
2. Deploy the backend (`sam build && sam deploy`). This adds the
   `LeadMaintenanceSchedule` rule.
3. Deploy the frontend.
4. Check: open the site in a private window, choose Allow, view a printer,
   send a test enquiry, then confirm it appears in Admin → Leads with its
   journey. Delete it from the lead dialog afterwards.

Optional environment variables (defaults are fine): `TRACKING_DAILY_EVENT_CAP`,
`LEADS_DAILY_CAP` (300), `STORAGE_ALERT_BYTES`.

## Consent wording

The consent text stored with a lead comes from `CONSENT_TEXTS` in
`leads.service.js`, never from the request. The form shows a copy
(`LeadCapture.tsx`). To change the wording, add a new version to both. Keep
old versions so that earlier consents stay accurate.

The analytics notice says usage data "is not used for ads". Phase 5 (sending
conversions to Google Ads) changes that. The notice, the privacy policy and
this document must be updated before it ships.

## Erasure

Admin → Leads → a lead → "Delete on request" removes the lead and every visit
from browsers linked only to it. A browser that also belongs to a signed-in
customer keeps its visits but loses the link to the lead.

# Phase 2: advisor, calculator and alerts

## Printer advisor and filament calculator

`/printer-advisor` asks for a budget, a main use and materials. It then ranks
the in-stock printers from their specifications: technology, build volume,
maximum nozzle temperature, multi-colour and bed levelling. The spec keys are
matched the same way as `COMPARABLE_SPECS` in `src/seo/site.js`.

`/filament-calculator` turns prints per week × grams per print into monthly
use, spool life and cost. The cost uses the cheapest in-stock spool per kg of
that material, with the spool weight read from the name or specs. Both pages
are in `PAGES` and in the sitemap, so they are prerendered for search.

The server computes every result (`backend/src/services/tools.service.js`) and
stores it in `tool_results`. The browser never supplies text the bot sends.
When WhatsApp is on, the result comes with a signed code (`A-XXXXXXXX-XXXXXXXX`)
and a wa.me link. The visitor sends it from their own WhatsApp, and the worker
then:

1. replies with the stored result, which is free because the customer opened
   the 24-hour window;
2. creates or merges a lead with the WhatsApp number, which WhatsApp has
   verified, unlike a typed number;
3. links the visitor's earlier visits to the lead.

A forged or altered code gets an apology, never content. Caps: 60 results per
network per day. Results never sent to WhatsApp are deleted after 30 days.

## Stock and price alerts

Product pages for printers, filament and resin offer "email me". It is
**back in stock** when the product is out of stock, and **price drop** (below
the price shown at sign-up) when it is in stock. Each sign-up:

- creates a row in `product_alerts`;
- emails a **confirmation link**. This is double opt-in: nothing else is
  sent, and no lead is recorded, until the owner of the address confirms.
  So an address someone else typed gets one email and is then forgotten
  (unconfirmed sign-ups are deleted after 7 days).

The confirm and unsubscribe links open a page with a button, and the button
POSTs. Mail scanners and link previews open every link, so a plain GET would
confirm or unsubscribe people without their knowledge.

`ProductAlertsSchedule` runs hourly and emails the confirmed alerts that have
come true. Prices include festival sales. Each send:

- holds a 15-minute lease (`claimed_at`), so a duplicated schedule event
  cannot send twice;
- sets `notified_at` only on success;
- on failure, counts an attempt and frees the lease. After 3 failures the
  alert is marked failed, so bad addresses cannot block the rest;
- if the run is killed mid-send, has its lease go stale and is retried.

The run also stops starting sends with less than 5 seconds of the Lambda left.

**Email budget:** Gmail allows about 500 messages a day, and order email needs
them. Confirmations and alerts together are limited to `ALERT_EMAILS_DAILY`
(default 150) in any 24 hours. Past it, sign-ups get "try tomorrow" and alerts
wait for the next run (`product_alerts_deferred` is logged).

Alerts go by email because they fire days later, outside WhatsApp's free
window, where each message would be a billed marketing template.

Caps: 10 new alerts per network per day and `ALERT_SIGNUPS_DAILY` (300) in
total. Tool results: 60 per network and `TOOL_RESULTS_DAILY_CAP` (2,000) in total.

**Retention and erasure:**
- Alerts are deleted 180 days after they close, or after 180 days open (a
  product that never came back).
- Deleting a lead also deletes every alert for its email address.
- A forwarded wa.me code makes a lead of whoever sends it. Only the first
  sender is linked to the browsing history of the visitor who ran the tool.

Admin → Leads shows tool use and the open alerts per product.

The daily maintenance runs each cleanup step on its own and logs any failure.
So if the code is deployed before migration 016, the storage check still runs.

## Deploying phase 2

1. Apply `016_lead_tools.sql` after `015` (Neon SQL editor, `neondb_owner`).
2. Check that `BACKEND_URL` is set: unsubscribe links are built from it.
3. `sam build && sam deploy`. This adds `ProductAlertsSchedule`.
4. Smoke test: run the advisor and tap "Send to my WhatsApp". The bot should
   reply with the same picks, and the lead should appear in Admin → Leads.
   Set an alert on an out-of-stock product with your own email and confirm
   it from the email. Then set the product's stock above zero and expect the
   alert within the hour.
