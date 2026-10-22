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

1. It reads the Google credential from SSM and signs in as the service account.
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

## Setup (once, about 15 minutes)

The function signs in to Google **without a key**, by workload identity
federation: Google checks a request signed with the function's own AWS role
and lets that role act as a service account. Nothing secret is stored, and
Google Cloud projects that forbid service-account keys (the default for new
ones, `iam.disableServiceAccountKeyCreation`) work unchanged.

1. **Google Cloud**: in any project, create a service account with **no
   roles**, e.g. `search-console-sync`.
2. **Search Console**: open the property, go to *Settings → Users and
   permissions → Add user*, enter the service account's email
   (`...@...iam.gserviceaccount.com`), and give it **Restricted** access.
   Restricted is read-only. Note the property's exact name for step 5:
   `sc-domain:protodesignstudio.com` for a domain property, or
   `https://www.protodesignstudio.com/` for a URL-prefix one.
3. **Federation**, in Google Cloud Shell (it has `gcloud`; the AWS commands
   below run on your own machine). `ROLE` is the function's AWS role:

   ```sh
   aws cloudformation describe-stack-resource --region ap-southeast-1 \
     --stack-name protodesign-api --logical-resource-id ApiFunctionRole \
     --query StackResourceDetail.PhysicalResourceId --output text
   ```

   Then, in Cloud Shell:

   ```sh
   PROJECT=<project id>
   SA=search-console-sync@$PROJECT.iam.gserviceaccount.com
   AWS_ACCOUNT=<12-digit AWS account id>
   ROLE=<ApiFunctionRole physical id>
   NUM=$(gcloud projects describe $PROJECT --format='value(projectNumber)')

   gcloud services enable --project=$PROJECT \
     searchconsole.googleapis.com sts.googleapis.com iamcredentials.googleapis.com
   gcloud iam workload-identity-pools create aws-lambda --project=$PROJECT \
     --location=global --display-name="AWS Lambda"
   # Only this AWS account, and only the function's role, can sign in.
   gcloud iam workload-identity-pools providers create-aws protodesign-api --project=$PROJECT \
     --location=global --workload-identity-pool=aws-lambda --account-id=$AWS_ACCOUNT \
     --attribute-mapping="google.subject=assertion.arn.extract('assumed-role/{role}/'),attribute.aws_role=assertion.arn.extract('assumed-role/{role}/')" \
     --attribute-condition="attribute.aws_role=='$ROLE'"
   gcloud iam service-accounts add-iam-policy-binding $SA --project=$PROJECT \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/aws-lambda/attribute.aws_role/$ROLE"
   gcloud iam workload-identity-pools create-cred-config \
     projects/$NUM/locations/global/workloadIdentityPools/aws-lambda/providers/protodesign-api \
     --service-account=$SA --aws --output-file=search-console-federation.json
   cat search-console-federation.json
   ```

   The printed config has no secret in it: it names the pool, the service
   account and Google's endpoints. `google.subject` is the role name, not the
   full ARN, so it always fits Google's 127-byte limit.
4. **AWS SSM**, on your machine: save the printed JSON as a file and store it
   in the stack's region (add `--overwrite` if the parameter already holds a
   key):

   ```sh
   aws ssm put-parameter --region ap-southeast-1 \
     --name /protodesign/search-console-key --type SecureString \
     --value file://search-console-federation.json
   ```

   The parameter is read once per sync, and the function's role may read only
   this one parameter. (It keeps its `-key` name from when it held a key.)
5. **Deploy**: in `infra/parameters.sh`, set `SearchConsoleSiteUrl` to the
   property's name from step 2. Apply
   `backend/migrations/017_search_console.sql` in Neon, then run
   `sam build && sam deploy`.
6. Open **Admin → Search demand** and press **Sync now**. The first sync may
   take two or three presses (each stops early to stay inside the
   function's 20-second limit), or you can leave it to the daily run. A
   refused sign-in says so and names what to check.

If the stack is ever recreated, its role gets a new name: update the
provider's condition and the service account's binding to it.

**With a key instead**: where Google Cloud allows keys, add a JSON key to the
service account and store that file in the same parameter instead of the
config (then `rm` the downloaded file). The sync accepts either. To rotate a
key, add a new one, overwrite the parameter with `--overwrite`, and delete the
old key in Google Cloud.

## Rollback

Set `SearchConsoleSiteUrl` empty and deploy: the sync stops and the section
shows the setup steps. To remove the data as well, run
`DROP TABLE IF EXISTS search_console_rows, search_console_days, search_console_syncs;`.
The next sync can fetch the last 118 days again.
