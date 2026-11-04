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
APP_URL=https://tanktickets.site     # public origin used to build callback_url
```

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

```sh
npm ci
npm run dev:api     # server-only payments API on 0.0.0.0:8787
npm run dev         # Vite on 0.0.0.0:5173, proxies /api to 8787
```

Checks:

```sh
npm run check
npm run verify:build
npm run check:server
npm run test:server
```

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

As of 2026-11-04, the Supabase migrations are applied to `xmfvxypioitbsnsbgioq`. The old Supabase Edge Functions (`dgateway-collect`, `dgateway-status`, `dgateway-webhook`) are legacy and no longer used by the browser.

Paid collections are **not live** until the `/api` server is deployed and `DGATEWAY_API_KEY` is configured in the server host environment. Until then the API fails closed with `PAYMENT_NOT_CONFIGURED` and the checkout shows an honest unavailable message. Complete a sandbox collection plus verified webhook/status round-trip before declaring payments live.

DGateway API reference: https://dgateway.desispay.com/docs
