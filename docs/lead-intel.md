# Lead scoring and filament reorders (phase 4)

Two lists that tell the team who to contact first: open leads ranked by a
score, and filament buyers who are likely running out. Everything is
computed from data the shop already holds (phases 1-2 and orders). Nothing
is sent to customers.

## Lead score

Every hour, each open lead (status New, Contacted or Qualified) gets a score
from 0 to 100. The score is the sum of plain rules, and the admin shows
every rule that applied. It is deliberately not a trained model: the shop
has too few won leads to learn from yet, and a score the team can read is
one they can act on and question.

| Signal (tracked activity over the last 30 days) | Points |
| --- | --- |
| Wants a printer / resin / printing service / filament / other | 15 / 12 / 10 / 8 / 3 |
| Each product page viewed (up to 5) | 3 |
| Looked at a product over ₹20,000 | 10 |
| Added to cart | 15 |
| Started a print quote | 10 |
| Used the advisor or calculator | 8 |
| Asked for a stock or price alert | 8 |
| Came back on 2-3 / 4+ days in two weeks | 10 / 15 |
| Confirmed their number (WhatsApp code) or email (alert) | 5 |
| Wrote a message | 5 |
| Enquired more than once | 5 |
| Already a customer | 5 |
| Active in the last 2 days / this week | 15 / 8 |
| Quiet for over 30 days | -15 |

The bands are: **hot** from 60, **warm** from 35, and **cold** below 35. For
example, a bare enquiry with a message is warm. Someone who viewed a ₹45,000
printer on three days and added it to cart is hot. The weights are in
`backend/src/services/lead-intel.service.js` (`scoreLead`); change them once
won and lost leads show what really predicts a sale.

Tracked activity exists only for visitors who allowed analytics. Leads
without it are scored on their enquiry alone.

## Hot-lead alerts

When a lead first reaches 60, the hourly run sends a Telegram message. The
message has the lead's contact details and the top reasons for the score.

- A lead is alerted once. It can be alerted again only after its score falls
  below 45 and climbs back up, so a score hovering around 60 does not alert
  every hour.
- One run sends at most five individual alerts. Any further hot leads go in
  a single summary message.
- Each lead is claimed in the database before its alert is sent, so a
  duplicated or retried run cannot alert it twice.
- If Telegram does not accept the alert, or the run is nearly out of time,
  the claim is released and the next hourly run tries again.
- Marking a lead Won or Lost removes its score.

## Filament running low

For each customer with a confirmed filament order in the last year, the
model estimates when they run out:

1. **Their buying rhythm** (two or more purchases at least a week apart):
   everything they bought before their last purchase, used up over the time
   between their first and last purchase. An order placed within a week of
   the previous one counts as part of the same purchase.
2. **Their filament calculator answer** (grams a month), if they ran the
   calculator and sent it from WhatsApp while signed in.
3. **The typical rate**: the median of the shop's repeat buyers once there
   are five of them. Until then it is one 1 kg spool a month.

Spool weights come from product names and specs. Lines with no readable
weight count as 1 kg, and the admin says so.

The admin lists customers from 21 days before their predicted run-out date
until 45 days after it; after that the customer counts as lapsed. Each row
has WhatsApp and email buttons that open the team's own apps. Every Monday
at 10:00 IST, Telegram lists the customers due within a week, plus those up
to two weeks overdue.

Sending reminders to customers themselves (email or WhatsApp) is **not**
built. It is marketing, so it needs its own opt-in, and WhatsApp's paid
templates are off.

## Deploying

1. Apply `backend/migrations/018_lead_scoring.sql` in Neon **before**
   deploying: the admin's Leads query reads the new columns. The rollback is
   in the migration's header.
2. Run `sam build && sam deploy`. This adds `LeadScoringSchedule` (hourly) and
   `ReorderDigestSchedule` (Mondays).

Scores appear after the first hourly run. That run alerts every open lead
already at 60 or above (five individually, the rest in one summary). Both lists need Telegram set up
(`TelegramBotToken`, `TelegramAdminChatIds`) for alerts; the admin works
without it.
