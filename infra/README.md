# Deploying the ProtoDesign backend to Lambda

Prerequisites: [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
(`brew install aws-sam-cli`), Node 22+, and AWS credentials for the **new** account.
Confirm with `aws sts get-caller-identity` before deploying — this template creates
real, billable-if-misconfigured resources.

## Credentials: two ways to authenticate the CLI

**Recommended — `aws login` (no static access key, AWS CLI 2.32+ required):**
When creating the IAM user, check "Provide user access to the AWS Management Console"
and set a password, then attach the `SignInLocalDevelopmentAccess` managed policy
alongside your deploy permissions. Then:

```bash
aws login --profile protodesign
```

This opens a browser, you sign in with the IAM user's console password, and the CLI
gets temporary credentials that auto-refresh for up to 12 hours — no access key ever
touches disk. Re-run `aws login` when a session expires. This only works interactively;
it cannot authenticate an unattended CI job (a future GitHub Actions deploy would need
a static key or, better, OIDC role federation instead).

**Alternative — static access key:** skip the console-access checkbox, generate an
access key when creating the user instead, then `aws configure --profile protodesign`.
Simpler, but the secret persists in `~/.aws/credentials` until you manually rotate it.

Either way, the profile still needs deploy permissions (e.g. `AdministratorAccess` for
now) attached separately — console access / `SignInLocalDevelopmentAccess` only grants
*authentication*, not what the user is allowed to do once signed in.

All commands below assume `--profile protodesign`; add it explicitly if it isn't your
default profile, e.g. `sam deploy --profile protodesign ...`.

## Why deployment is two passes

PhonePe's settlement callback and the customer redirect need the app's own
public URL (`BACKEND_URL`, `FRONTEND_URL`), but a Lambda Function URL does not
exist until this stack creates it — so it can't be known on the first deploy.
Deploy once with those blank, read back the URL, then redeploy with it filled
in. Skipping the second pass means PhonePe calls back into thin air: payments
succeed at the gateway and are never recorded as paid.

## 1. First deploy

```bash
cp parameters.example.sh parameters.sh
# Edit parameters.sh: fill in StlBucketName (must be globally unique),
# DatabaseUrl (Neon's POOLED "-pooler" endpoint), JwtSecret
# (openssl rand -base64 48), and the rest. Leave BackendUrl blank.

source parameters.sh
sam build
sam deploy --parameter-overrides "$PARAMETER_OVERRIDES"
```

Note the `ApiFunctionUrl` in the stack outputs.

## 2. Second deploy — fill in BackendUrl

```bash
# In parameters.sh, set:
#   BackendUrl=<the ApiFunctionUrl from step 1, no trailing slash>
#   FrontendUrl=<your Vercel URL>
#   FrontendUrls=<same Vercel URL, or a comma-separated list>

source parameters.sh
sam deploy --parameter-overrides "$PARAMETER_OVERRIDES"
```

## 3. Point the frontend at it

Set `VITE_API_URL` to the Function URL **plus `/api`** in Vercel's project
settings, then redeploy the frontend. The frontend appends paths like
`/auth/login` to this value and the backend mounts every route under `/api`
(`backend/app.ts`), so omitting the suffix makes every call 404. The stack
output ends in a trailing slash; strip it first:

```
VITE_API_URL=https://<function-id>.lambda-url.<region>.on.aws/api
```

`VITE_API_URL` is baked into the bundle at build time, so changing it requires
a rebuild, not just a redeploy of the old build. See `docs/vercel-deployment.md`
for the Vercel side in full, including `vercel.json`'s sitemap rewrite, which
needs the Function URL *without* `/api` (the sitemap route is mounted at `/`).

## 4. Re-register external callbacks

Both of these fail silently and both sit on the revenue path:

- **PhonePe merchant dashboard** — update the callback URL to
  `<ApiFunctionUrl>/api/orders/payment/callback`.
- **Google Cloud Console → OAuth client** — add the Vercel URL to Authorized
  JavaScript origins.

## 5. Seed the first admin

Nothing grants admin access until a row exists (see
`docs/lambda-migration-plan.md` §5.7 — `isAdmin` is authoritative against
`user_roles`, not the JWT):

```sql
INSERT INTO user_roles (user_id, role) VALUES ('<uuid-of-your-account>', 'admin');
```

## Verifying it actually works

```bash
curl https://<function-id>.lambda-url.<region>.on.aws/api/health
```

Then walk the paths that changed in Phase 2 specifically: request a quote with
a file over 6MB (this is the one that was impossible before this migration),
confirm the admin dashboard can create a product with images, and place a
real order end-to-end including that the confirmation email arrives.

## Verifying the cost, not just the deploy

`sam deploy` succeeding is not the same as this staying free. After a day of
real traffic, check:

- **CloudWatch → Lambda → this function** — Invocations and Duration. Multiply
  duration by memory to sanity-check GB-seconds against the 400,000 free.
- **Cost Explorer**, grouped by service, filtered to this account — confirm
  Lambda, S3, and CloudFront (if added later) show $0 or near-$0, and that
  nothing unexpected (a second log group, a leftover NAT Gateway) appears.

## Tearing this down

```bash
sam delete
```

This removes the Lambda, its Function URL, the log group, and the S3 bucket
**and everything in it**. If real customer models are in the bucket by then,
export them first — this is destructive and cannot be undone.
