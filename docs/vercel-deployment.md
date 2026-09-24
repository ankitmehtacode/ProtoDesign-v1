# Deploying the frontend to Vercel

Prerequisites: the backend is already deployed (`infra/README.md`) and you have
its Function URL. Vercel's Hobby tier is free and perpetual for this project's
traffic — no trial window to plan around, unlike App Runner's.

## 1. Import the project

In the Vercel dashboard, import this repository. Vercel auto-detects Vite
(build command `npm run build`, output directory `dist` — both are Vite
defaults, unchanged here) via `vite.config.ts`.

## 2. Environment variables

Set these in Vercel's project settings (Production, and Preview if you want
preview deployments to work — see §4 on what that implies):

| Variable | Value |
|---|---|
| `VITE_API_URL` | The Lambda Function URL from `infra/README.md` **with `/api` appended**, no trailing slash — e.g. `https://<id>.lambda-url.<region>.on.aws/api`. Without `/api`, every request 404s. |
| `VITE_GOOGLE_CLIENT_ID` | Same Google OAuth client ID as the backend |

## 3. Fill in `vercel.json`'s sitemap rewrite

`vercel.json` proxies `/sitemap.xml` to the backend, which generates it from
live product data (`backend/src/routes/sitemap.routes.js`). Replace the
placeholder with the real Function URL:

```json
{
  "source": "/sitemap.xml",
  "destination": "https://<function-id>.lambda-url.<region>.on.aws/sitemap.xml"
}
```

This entry must stay **before** the catch-all `/(.*)` rewrite in the array —
Vercel matches in order, and the catch-all would otherwise intercept
`/sitemap.xml` and return the React app's HTML shell instead of XML, which is
invisible in the browser but means search engines index nothing there.

Also set the backend's `FRONTEND_URL` env var to this Vercel deployment's own
URL (see `infra/parameters.sh`) — `sitemap.routes.js` builds every `<loc>` in
the sitemap from it. It was previously hardcoded to a domain the app was never
actually deployed to; fixed as part of this phase, but it still needs a real
value from you now.

## 4. CORS: production origin vs. preview deployments

The backend only accepts requests from origins you name (`app.ts`'s CORS
middleware; see `docs/lambda-migration-plan.md` §5.1). Add your production
Vercel URL to `FrontendUrls` in `infra/parameters.sh` and redeploy the backend.

Vercel gives every branch and PR its own preview URL, which an exact-match
list cannot cover. The backend supports an opt-in `FrontendOriginPattern`
regex for this (`infra/template.yaml`) — deliberately **not** a blanket
`*.vercel.app` allow, since Vercel is shared hosting and that would trust
every other app deployed there too, not just yours.

**Decide this deliberately rather than defaulting into it:** enabling preview
CORS means preview branches — including ones a collaborator pushes — talk to
your **production** database and can create real orders and real PhonePe
payment attempts. If you want previews, consider a second Neon branch/database
for them instead of pointing every preview at production data.

## 5. Custom domain (optional)

If you had one on Amplify (this repo did not — it used the amplifyapp.com
subdomain only), add it in Vercel's Domains settings and update `DNS`. Add the
new domain to `FrontendUrls` and redeploy the backend, or CORS will block it.

## Verifying

```bash
curl -I https://your-app.vercel.app/                 # 200, serves index.html
curl -I https://your-app.vercel.app/product/anything  # 200 -- SPA rewrite, not a 404
curl https://your-app.vercel.app/sitemap.xml          # XML, not HTML
```

Then load the app in a browser and confirm the network tab shows requests
reaching the Function URL with no CORS errors, log in, and place a test order.
