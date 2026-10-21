# Search demand (phase 3)

The admin's **Search demand** section shows what people search on Google
before they find the shop, and which of those searches turn into leads.

## What it can and cannot know

Google Search Console reports **counts**: for each search query, the page it
showed, how many times it appeared (impressions), how often it was clicked,
and its average position. It never says who searched, so nothing here is
personal data and the privacy policy does not change.

Joined with first-party tracking (phase 1), the section shows per landing
page how many tracked Google visitors arrived and how many became leads.
Tracked visitors are only those who allowed analytics, so they are always
fewer than Search Console's clicks.

Search Console withholds rare queries for privacy, and its figures run two to
three days behind. The section's periods end on the newest day it has.
Until enough history is stored for the period before, comparisons are shown
as "–" rather than as growth that is not there.

The headline numbers are Search Console's own daily totals. The per-search
tables cannot include anonymised searches and keep the top 1000 rows a day,
so they add up to less.

## What the section shows

- **Demand by topic**: printers, filament, resin, printing service, the brand
  by name, other. Impressions against the previous period and the share of
  searches with buying words (price, buy, best, near me...).
- **Opportunities**, ranked by a rough estimate of extra clicks (a typical
  top-three click-through of 10%):
  - *close to the top*: ranking 4-20 with at least 20 impressions.
  - *seen but skipped*: top three with at least 50 impressions but under 3%
    click-through, so the page's title and description need work.
- **Rising searches**: at least doubled against the previous period.
- **Landing pages**: search clicks per page beside tracked visitors and leads.
- **Top searches**, exportable as CSV.

Topics are matched by keyword in
`backend/src/services/search-console.service.js` (`TOPICS`); add brands there
as the catalogue grows.

## How the data arrives

A daily EventBridge schedule (06:30 IST) runs `runSearchConsoleSync`:

1. It reads the service account's JSON key from SSM.
2. It asks the Search Console API for every day after the newest stored one:
   Search Console's own daily totals (which include the anonymised searches,
   so the headline numbers match its reports) and the rows per search and page.
   The first run fetches the last 118 days, enough for two 56-day periods.
3. It stores the rows a week at a time, oldest first. Each week is written
   whole or not at all, so a run that hits the time limit leaves no half day,
   and the next run carries on from there.

Only final data is requested (`dataState: final`), so a stored day never
changes later.

Every run is recorded in `search_console_syncs` and shown at the top of the
section. A failed scheduled run also sends a Telegram alert, with a message
that says what to fix (for example, that the service account is not a user
on the property). **Sync now** in the section runs the same sync on demand.

## Storage budget

At most 1000 rows a day (the top rows by clicks, then impressions) are kept
for 120 days, counted back from the newest stored day: about 30 MB at worst, and far less for a shop this size.
Daily maintenance prunes older rows and sync records older than 60 days.
Search Console itself keeps 16 months if older figures are ever needed.

## Setup (once, about 10 minutes)

1. **Google Cloud**: in any project (a new one is fine), enable the
   *Google Search Console API*. Create a service account with no roles,
   then under *Keys* add a JSON key and download it.
2. **Search Console**: open the property, go to *Settings → Users and
   permissions → Add user*, enter the service account's email
   (`...@...iam.gserviceaccount.com`), and give it **Restricted** access.
   Restricted is read-only.
3. **AWS SSM**: store the key in the stack's region, then delete the
   downloaded file:

   ```sh
   aws ssm put-parameter --region ap-southeast-1 \
     --name /protodesign/search-console-key --type SecureString \
     --value file://path/to/key.json
   rm path/to/key.json
   ```

   The key cannot be a Lambda environment variable: it is about 2.3 KB, and
   Lambda allows 4 KB for all variables together. A standard SecureString
   using the AWS-managed `aws/ssm` key is free, and the function's role may
   read only this one parameter.
4. **Deploy**: in `infra/parameters.sh`, set `SearchConsoleSiteUrl` to the
   property exactly as Search Console names it: `sc-domain:protodesign.in`
   for a domain property, or `https://www.example.com/` for a URL-prefix one.
   Apply `backend/migrations/017_search_console.sql` in Neon, then run
   `sam build && sam deploy`.
5. Open **Admin → Search demand** and press **Sync now**. The first sync may
   take two or three presses (each stops early to stay inside the
   function's 20-second limit), or you can leave it to the daily run.

To rotate the key, add a new key to the service account, overwrite the
parameter with `--overwrite`, and delete the old key in Google Cloud.

## Rollback

Set `SearchConsoleSiteUrl` empty and deploy: the sync stops and the section
shows the setup steps. To remove the data as well, run
`DROP TABLE IF EXISTS search_console_rows, search_console_days, search_console_syncs;`.
The next sync can fetch the last 118 days again.
