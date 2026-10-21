# Lead tracking (phase 1)

First-party visit tracking and an "Ask an expert" enquiry form, feeding a
**Leads** section in the admin. Everything runs on the existing Lambda and Neon
database: no third-party analytics, no new AWS resources.

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
