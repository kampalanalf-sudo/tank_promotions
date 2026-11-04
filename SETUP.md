# TANK Tickets: server-only DGateway checkout

## Architecture

Paid checkout calls server routes under `/api`. The browser never receives the DGateway API key and never calls DGateway directly.

- `POST /api/payments/collect` creates/reuses an order, requests a DGateway collection, and stores the returned `reference`.
- `POST /api/payments/disburse` is admin-only and requests a payout to any supplied MTN/Airtel number.
- `GET /api/payments/:reference/status?code=TICKET_CODE` is the browser status proxy. The server throttles provider checks to at most one per 10 seconds per payment.
- `POST /api/webhooks/dgateway` receives DGateway callbacks, verifies the signature when a secret is configured, re-fetches the transaction from DGateway, and only then credits the matching order/payout.
- `GET /api/health` is a lightweight health check.

The browser polls the status proxy every 10 seconds, starting 10 seconds after the collection request, and stops after about 5 minutes. While mobile-money confirmation is pending it shows: “Check your phone and approve the prompt”. Tickets are issued only after the server verifies `completed`; `failed` is final. There is no ZengaPay, SMS, USSD, merchant-code, local simulator, or browser-issued paid ticket fallback.

## Required server environment

Set these on the API host (Vercel project environment variables, or the Node server environment). Never prefix private values with `VITE_`.

```sh
DGATEWAY_API_URL=https://dgatewayapi.desispay.com
DGATEWAY_API_KEY=...                 # server-only test/live key
DGATEWAY_WEBHOOK_SECRET=...          # optional but recommended; HMAC-SHA256 raw-body secret
SUPABASE_URL=https://xmfvxypioitbsnsbgioq.supabase.co
SUPABASE_ANON_KEY=...                # public anon key
SUPABASE_SERVICE_ROLE_KEY=...        # server-only service role key
ADMIN_EMAIL=admin@tanktickets.site
API_PUBLIC_URL=https://YOUR_PUBLIC_API_HOST # public API origin used to build callback_url
APP_URL=https://YOUR_PUBLIC_API_HOST        # fallback for API_PUBLIC_URL
```

If the frontend and API are on the same host, `API_PUBLIC_URL` can be that shared origin. If you use GitHub Pages for the frontend and a separate API host, `API_PUBLIC_URL` must be the API host, for example `https://api.tanktickets.site`. Do not set it to `https://tanktickets.site` unless that origin actually serves `/api/webhooks/dgateway`.

Browser build variables:

```sh
VITE_SUPABASE_URL=https://xmfvxypioitbsnsbgioq.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_API_BASE_URL=https://YOUR_API_HOST
VITE_BUILD_SHA=...
```

For local development, leave `VITE_API_BASE_URL` empty. Vite proxies `/api` to `http://127.0.0.1:8787`.

## Database setup

Use the Supabase project `xmfvxypioitbsnsbgioq` (Tank Tickets). Do not substitute another project.

1. Back up the database.
2. For a new database, run `supabase/schema.sql`.
3. For the existing database, apply migrations in order:
   - `supabase/migrations/20261103_secure_dgateway_checkout.sql`
   - `supabase/migrations/20261104_dgateway_api_routes.sql`
   - `supabase/migrations/20261104_dgateway_create_order_security.sql`

The second migration adds `orders.currency`, `orders.last_status_check_at`, and the admin-only `payouts` table, and relaxes `create_order` phone validation so DGateway leading-zero numbers are preserved. The third keeps `create_order` as `SECURITY DEFINER`, which is required because `orders` has RLS enabled and no direct insert policy.

## Local development

Create a root `.env` file (it is gitignored). `npm run dev:api` loads `.env` and `.env.local` automatically. Vite loads only `VITE_*` variables into the browser; private server variables must stay unprefixed.

```sh
npm ci
npm run dev:api     # server-only payments API on 0.0.0.0:8787, reads .env
npm run dev         # Vite on 0.0.0.0:5173, proxies /api to 8787
```

For local browser testing, leave `VITE_API_BASE_URL` empty so the browser calls same-origin `/api` and Vite proxies to the API. DGateway cannot deliver webhooks to `localhost`; use the 10-second status polling locally, or expose the API through a public HTTPS URL and set `APP_URL` to that origin if you need webhook delivery.

### Termux / “Missing script: dev:api”

`npm run dev` only starts Vite. It does not start the payments API. Run `npm run dev:api` in a separate terminal/session and keep it open.

If `npm run dev:api` says `Missing script: "dev:api"`, the checkout does not contain the server-route branch yet. If you are on the old `deploy` branch and Git says local changes to `.env`, `package.json`, or `package-lock.json` would be overwritten, back up `.env` outside the repository and stash the old branch changes first:

```sh
cd ~/tank
BACKUP="$HOME/tank-env-$(date +%Y%m%d-%H%M%S).bak"
cp .env "$BACKUP"
chmod 600 "$BACKUP"
git stash push -u -m "deploy local changes before switching to payments API branch"

git fetch origin
git switch arena/25a297ce-tank-promotions || git switch -c arena/25a297ce-tank-promotions --track origin/arena/25a297ce-tank-promotions
git pull --ff-only origin arena/25a297ce-tank-promotions

cp "$BACKUP" .env
chmod 600 .env
npm ci
node -e "console.log(require('./package.json').scripts['dev:api'] || 'MISSING')"
```

Do not run `git stash pop` on the API branch; it may reapply old `deploy` package files. The API branch ignores `.env`, so `git ls-files .env` should print nothing.

The last command must print the `node --env-file-if-exists=... server/dev.ts` command. Then use two Termux sessions:

```sh
# Session 1
cd ~/tank
npm run dev:api

# Session 2
cd ~/tank
npm run dev
```

Health checks:

```sh
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:5173/api/health
```

Use Node.js 22 or newer for the `--env-file-if-exists` loader.

Checks:

```sh
npm run check
npm run verify:build
npm run check:server
npm run test:server
```

## GitHub Pages frontend + separate API

GitHub Pages is static hosting. It does not run `server/dev.ts`, does not read your computer/Termux `.env`, and cannot serve `/api/...`.

To use GitHub Pages for the frontend:

1. Deploy the `api/` routes to a server host (for example Vercel).
2. Set the private server environment variables on that API host, not in GitHub Pages. Set `API_PUBLIC_URL` to the public API origin so DGateway callbacks go to the API host.
3. In GitHub → **Settings → Secrets and variables → Actions → Variables**, add a repository variable:

   ```text
   VITE_API_BASE_URL=https://YOUR_PUBLIC_API_HOST
   ```

   This value is public and is compiled into the browser bundle. Never put `DGATEWAY_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_` variable.
4. Merge the server-route branch and let the Pages workflow rebuild the frontend.
5. Register the webhook URL:

   ```text
   https://YOUR_PUBLIC_API_HOST/api/webhooks/dgateway
   ```

If `VITE_API_BASE_URL` is empty, the browser calls same-origin `/api`. That works only when the frontend and API are served from the same host; it does not work on GitHub Pages alone.

## Deploying the API

GitHub Pages can host the static React bundle, but it cannot serve `/api/...`. Deploy the API routes to a server runtime such as Vercel:

- `api/payments/collect.ts`
- `api/payments/disburse.ts`
- `api/payments/[reference]/status.ts`
- `api/webhooks/dgateway.ts`
- `api/health.ts`

`vercel.json` is included. The API host must allow requests from `https://tanktickets.site` and must not be blocked by SSO/deployment protection for DGateway webhooks. Set `VITE_API_BASE_URL` to the public API origin before building the frontend.

Register the webhook URL in DGateway → My Apps → Settings:

```text
https://YOUR_API_HOST/api/webhooks/dgateway
```

If `DGATEWAY_WEBHOOK_SECRET` is set, DGateway must sign the raw request body with HMAC-SHA256. The handler accepts `x-dgateway-signature`, `x-webhook-signature`, or `x-signature`, with or without a `sha256=` prefix. Even without a webhook secret, the handler does not trust the webhook body: it re-fetches the transaction from DGateway and matches reference, amount, currency, and direction before crediting.

## DGateway contract

Base URL: `https://dgatewayapi.desispay.com`. Auth header: `X-API-Key`.

Collect:

```http
POST /v1/payments/collect
{ "amount": 20000, "currency": "UGX", "phone_number": "0772123456", "description": "...", "callback_url": "https://YOUR_API_HOST/api/webhooks/dgateway" }
```

Disburse:

```http
POST /v1/payments/disburse
{ "amount": 5000, "currency": "UGX", "phone_number": "0772123456", "description": "..." }
```

Status:

```http
GET /v1/transactions/:reference/status
```

Currency routing is automatic: UGX/KES/TZS mobile money, USD Stripe card. Mobile-money amounts are whole units; USD amounts are cents. Phone numbers may be `07XXXXXXXX`, `2567XXXXXXXX`, or `+2567XXXXXXXX` (also 254/255/250). The leading 0 is preserved.

## Current deployment status

As of 2026-11-04, the Supabase migrations are applied to `xmfvxypioitbsnsbgioq`. On this branch, the old Supabase Edge Functions (`dgateway-collect`, `dgateway-status`, `dgateway-webhook`) are legacy and no longer used by the browser. The currently published `main` GitHub Pages site may still use those Edge Functions until this branch is merged.

Paid collections are **not live** until the `/api` server is deployed and `DGATEWAY_API_KEY` is configured in the server host environment. Until then the API fails closed with `PAYMENT_NOT_CONFIGURED` and the checkout shows an honest unavailable message. Complete a sandbox collection plus verified webhook/status round-trip before declaring payments live.

DGateway API reference: https://dgateway.desispay.com/docs
