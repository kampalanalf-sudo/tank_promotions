# TANK Tickets: verified Mobile Money checkout

## What changed

The application source is now maintained on `main`, not a separate stale `deploy` bundle. GitHub Actions builds the React app, runs checkout and server-security tests, publishes `dist`, and checks the public page's commit marker. `public/CNAME` preserves `tanktickets.site`.

Paid checkout uses DGateway through Supabase Edge Functions. It never falls back to ZengaPay, merchant USSD codes, SMS matching, a local simulator, or a browser-issued ticket. Free events can still be booked without a payment gateway.

## Backend setup — required before accepting payments

Use the Supabase project configured in `.env.production`. Do not substitute another project: its events, orders and auth users are different.

1. Connect that project to the deployment tooling, or open its Supabase dashboard.
2. Back up the database, then run `supabase/migrations/20261103_secure_dgateway_checkout.sql` in the SQL editor. This preserves existing data, makes order creation idempotent, and revokes public execution of historical manual confirmation functions. For a new database, run `supabase/schema.sql` instead.
3. In **Edge Functions → Secrets**, set:
   - `DGATEWAY_API_KEY`: the app's test or live key from DGateway. Never put it in a `VITE_` variable or browser settings.
   - `DGATEWAY_WEBHOOK_SECRET`: the app's webhook signing secret.
   - `DGATEWAY_API_URL`: `https://dgatewayapi.desispay.com`.
   Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to the functions.
4. Deploy all three functions, including the `_shared` directory:

   ```sh
   supabase functions deploy dgateway-collect --project-ref YOUR_PROJECT_REF --no-verify-jwt
   supabase functions deploy dgateway-status --project-ref YOUR_PROJECT_REF --no-verify-jwt
   supabase functions deploy dgateway-webhook --project-ref YOUR_PROJECT_REF --no-verify-jwt
   ```

   The functions support guest checkout. Collection validates the order server-side; status checks the exact order/reference; the webhook requires a valid HMAC signature and verifies the transaction with DGateway. Disabling Supabase JWT verification does not disable these application checks.
5. In DGateway → **My Apps → Settings**, register:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/dgateway-webhook
   ```

6. Keep test mode until an end-to-end sandbox payment and webhook have passed. DGateway's documented numbers are `0111777771` (success), `0111777991` (failure), and `0111777881` (pending). Use them only with a `dgw_test_` key. Never simulate success in the frontend.
7. Replace the server key with the live key only after gateway approval and a controlled real-number verification. Test numbers are rejected with live keys.

The Admin → DGateway page shows setup information and the webhook URL; it does not store gateway credentials in the database or browser.

## Frontend and publishing

`.env.production` contains only the public Supabase URL and public `anon` key. Row Level Security and server-only payment functions protect data. Keep all private keys out of this repository.

```sh
npm ci
npm run check
npm run verify:build
npm run check:server
npm run test:server
npm run dev
```

Pull requests run checks. Merging to `main` publishes the site through GitHub Actions. Do not copy an old `docs/index.html` over the new build or force-push a separate deployment branch.

Every build includes a `tank-build` HTML meta tag with its Git commit SHA. After deployment, check:

```sh
curl -fsSL 'https://tanktickets.site/?build=COMMIT_SHA' | grep 'tank-build'
```

If the SHA differs, check the Pages deployment commit and CDN cache before changing payment code. A query-string URL bypasses the usual cached page URL. The checkout also displays an explicit unavailable message if its backend function is missing; it does not show a fake phone prompt.

## Ticket delivery

After server-verified payment, the QR ticket appears on screen. Buyers can save it or share it to WhatsApp. Signed-in buyers can find it in My tickets. Automatic email requires the EmailJS settings in Admin → Ticket delivery. WhatsApp sharing is buyer-initiated, not an automatic WhatsApp API delivery.

## Current deployment verification

As of 2026-11-04, the public site is served from `main`, and the TANK Supabase project `xmfvxypioitbsnsbgioq` is connected. The secure checkout migration has been applied, and `dgateway-collect`, `dgateway-status`, and `dgateway-webhook` are deployed and active. `DGATEWAY_API_URL` is configured. A pre-migration backup is stored in the private database schema `tank_private_backup`.

Paid collections are still **not live** until the DGateway app credentials are added as Supabase Edge Function secrets:

- `DGATEWAY_API_KEY`: start with the app's `dgw_test_` key.
- `DGATEWAY_WEBHOOK_SECRET`: the app's generated webhook signing secret.

Add them in Supabase → Edge Functions → Secrets for this project. Do not paste them into chat, commit them, or store them in the browser/database settings. The webhook URL is:

```text
https://xmfvxypioitbsnsbgioq.supabase.co/functions/v1/dgateway-webhook
```

A fresh page build and active Edge Functions do **not** prove that live collections work. Complete the DGateway secrets/webhook setup and run a sandbox payment before declaring the payment flow live.

DGateway API reference: https://dgateway.desispay.com/docs
