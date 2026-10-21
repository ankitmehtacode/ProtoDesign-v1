# Google Ads (phase 5)

This phase sends two things back to Google Ads, both **only for people who
opted in**:

1. **Offline conversions.** Ad clicks that became an enquiry or a paid
   order, so Google Ads can tell which ads and keywords bring customers. Its
   bidding then stops paying for clicks that never convert.
2. **Customer Match.** A hashed audience of opted-in leads, so you can show
   them ads, or exclude them from ads meant for new customers.

Nothing here uses the Google Ads API. The API needs an approved developer
token and an OAuth setup; a scheduled HTTPS import and a file upload need
neither.

## Consent

Both choices are separate from analytics and from the enquiry form's
contact consent. Both start unticked, and both store the exact wording that
was agreed to (`ADS_CONSENT_TEXTS` in `backend/src/services/leads.service.js`).

| Choice | Where it is asked | What leaves the shop |
| --- | --- | --- |
| Ad measurement | Once per ad visit (a `gclid` in the URL): in the analytics notice, or as a short question of its own if analytics was allowed earlier | The ad click ID, the conversion name, its time and the order value. Never a name or contact detail. |
| Customer Match | An optional box on "Ask an expert" forms | The SHA-256 hash of the lead's phone and email, normalised the way Google requires |

**Customer Match only uses a contact its owner proved after ticking the
box, within 14 days:**
- a WhatsApp message from that number, which has not sent STOP;
- a confirmed stock or price alert for that email.

Anyone can type someone else's number into a form. For the same reason, a
repeat enquiry can add Customer Match consent to an existing lead only when
it comes from the signed-in account that lead belongs to.

Ad-measurement consent is per click. A returning visitor who arrives from a
new ad is asked again. The new click replaces the old one, and it counts
only if that visit says yes. The wording version is stored on the visitor
(`ads_consent_version`).

**Withdrawing:**
- **Ad measurement:** "Analytics preferences" in the footer asks again. "No
  thanks" deletes the browser's visits altogether.
- **Customer Match:** the person writes in, and the admin uses "Withdraw on
  request" in the lead's dialog, or deletes the lead. Because the audience
  file is uploaded as a full replacement, that person drops out of the next
  upload.

The privacy policy's "Google Ads (only if you opt in)" section says all of
this in plain words.

## 1. Offline conversions

`GET /api/ads/conversions.csv` returns the last 7 days of conversions in
Google's import format. It has a `Parameters:TimeZone=Asia/Kolkata` row,
then these columns: `Google Click ID, Conversion Name, Conversion Time,
Conversion Value, Conversion Currency`.

The feed lists:
- **ProtoDesign lead:** an enquiry from a browser that came from an ad and
  allowed measurement.
- **ProtoDesign purchase:** a sale by an account whose browser came from an
  ad and allowed measurement, valued at the order total in INR. A sale is an
  order paid through PhonePe, or a cash-on-delivery order once it is
  delivered or completed. A cancelled order never counts.

**Rules and limits:**
- A conversion counts only if it happened within 90 days after the click,
  which is Google's limit.
- A sale is picked up by its latest update, so an order delivered weeks
  after it was placed still reaches the feed. Its conversion time stays the
  time it was placed.
- A refund or cancellation after Google imported a sale is not retracted
  (that needs Google's conversion adjustments, which this does not send).
- If a shared browser is linked to one account and someone else clicks an
  ad on it, that account's later orders are credited to that click. This is
  accepted as rare.

Every fetch repeats the full week, so a missed fetch loses nothing. Google
skips a conversion it has already imported.

**Setup:**

1. **Create two conversion actions.** In Google Ads, go to *Goals →
   Conversions → New conversion action → Import → Other data sources or
   CRMs → Track conversions from clicks*. Name them exactly
   `ProtoDesign lead` and `ProtoDesign purchase`. If you use other names,
   set `AdsLeadConversion` and `AdsPurchaseConversion` to match.
2. **Turn on auto-tagging** (*Admin → Account settings → Auto-tagging*), so
   ad clicks carry a `gclid`.
3. **Deploy the feed.** Generate a secret with `openssl rand -hex 24`, set it
   as `AdsFeedSecret` in `infra/parameters.sh`, apply
   `backend/migrations/019_ads.sql` in Neon, then run
   `sam build && sam deploy`.
4. **Schedule the import.** In Google Ads, go to *Goals → Uploads →
   Schedules → New schedule → HTTPS*:
   - URL: `<BackendUrl>/api/ads/conversions.csv`
   - Username: anything (e.g. `google`)
   - Password: the secret
   - Frequency: daily

   If the form has no password field, use
   `<BackendUrl>/api/ads/conversions.csv?key=<secret>` instead.
5. **Confirm it runs.** The admin's Leads → Google Ads panel shows when
   Google last fetched the feed and how many conversions it held. Google's
   own upload history shows anything it rejected.

## 2. Customer Match

In Admin → Leads → Google Ads, download the hashed audience, either for
everyone or for one interest (printers, filament, resin). The file has two
columns, `Email,Phone`, both already SHA-256 hashed.

In Google Ads, go to *Tools → Shared library → Audience manager → Customer
lists → Upload*. Choose to upload hashed data, and **replace** the list's
contents each time, rather than adding to them, so withdrawn people are
removed.

Google decides whether an account may use Customer Match, based on its
policy compliance and payment history. Google's help pages list the
current requirements.

## Deploying

1. Apply `backend/migrations/019_ads.sql` in Neon **before** deploying, so
   the new columns exist. The rollback is in its header.
2. With `AdsFeedSecret` empty, `/api/ads/conversions.csv` answers 404, and
   the consent boxes still collect choices for when it is turned on.
