# Setting up TANK Tickets online (Supabase + ZengaPay + GitHub Pages)

The website runs on GitHub Pages (`https://tanktickets.site`) backed by Supabase (`xmfvxypioitbsnsbgioq`) and **ZengaPay** Mobile Money Collections (MTN Mobile Money & Airtel Money in UGX).

> **Security rule:** Never place `ZENGAPAY_API_KEY`, `ZENGAPAY_WEBHOOK_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY` in any `VITE_*` variable, committed `.env` file, or browser code. Keep all payment credentials strictly in **Supabase Edge Function Secrets**.

---

## 1. Apply the ZengaPay SQL migration in Supabase

Run `supabase/migrations/20261105_zengapay_payments.sql` in **Supabase → SQL Editor** for project `xmfvxypioitbsnsbgioq` (or run `npx supabase db push` with the project linked).

For a brand-new Supabase project, run `supabase/schema.sql` in **SQL Editor**.

---

## 2. Set ZengaPay secrets in Supabase Edge Functions

In **Supabase Dashboard → Project `xmfvxypioitbsnsbgioq` → Edge Functions → Secrets** (or via CLI):

```bash
npx supabase secrets set --project-ref xmfvxypioitbsnsbgioq \
  ZENGAPAY_API_KEY="ZPYPUBK-your_live_or_sandbox_api_key" \
  ZENGAPAY_WEBHOOK_SECRET="your_zengapay_developer_settings_secret_hash" \
  ZENGAPAY_BASE_URL="https://api.zengapay.com/v1"
```

- **Production base URL:** `https://api.zengapay.com/v1` (default if `ZENGAPAY_BASE_URL` is omitted).
- **Sandbox base URL:** `https://api.sandbox.zengapay.com/v1` (must match a sandbox API key — ZengaPay returns `401` if a live key is used against sandbox or vice versa).
- **Optional fee pass-through:** set `ZENGAPAY_CHARGE_CUSTOMER="true"` if you want ZengaPay collection fees added to the buyer's Mobile Money prompt (`false` by default).

---

## 3. Deploy the Supabase Edge Functions (`--no-verify-jwt`)

Deploy the ZengaPay and ticket-delivery Edge Functions with JWT gateway verification off (each function enforces its own auth/signature checks):

```bash
npx supabase functions deploy zengapay-collect   --project-ref xmfvxypioitbsnsbgioq --no-verify-jwt
npx supabase functions deploy zengapay-status    --project-ref xmfvxypioitbsnsbgioq --no-verify-jwt
npx supabase functions deploy zengapay-webhook   --project-ref xmfvxypioitbsnsbgioq --no-verify-jwt
npx supabase functions deploy zengapay-transfer  --project-ref xmfvxypioitbsnsbgioq --no-verify-jwt
npx supabase functions deploy ticket-delivery    --project-ref xmfvxypioitbsnsbgioq --no-verify-jwt
```

*(You can also remove the retired `dgateway-*` Edge Functions in Supabase Dashboard → Edge Functions once switched over.)*

---

## 4. Configure ZengaPay Dashboard → Developer Settings

1. Sign in to [ZengaPay Dashboard](https://dashboard.zengapay.com) → **Settings → Developer Settings**.
2. **API Key:** Copy your API key (`ZPYPUBK-...`) into `ZENGAPAY_API_KEY` in Supabase Secrets above.
3. **Webhooks:**
   - Set **WEBHOOK URL** to:
     ```text
     https://xmfvxypioitbsnsbgioq.supabase.co/functions/v1/zengapay-webhook
     ```
   - Enter a strong **Secret Hash**, save the exact same value as `ZENGAPAY_WEBHOOK_SECRET` in Supabase Secrets, and **Enable Webhooks**.
4. **IP Whitelisting note:**
   - ZengaPay's Developer Settings require at least one IP address saved to activate full API access, and ZengaPay enforces IP whitelisting on `/v1/transfers`, `/v1/checkout/sessions`, and `/v1/account*` (`403 Forbidden: Connection refused from unauthorized IP`).
   - Standard Mobile Money collections (`POST /v1/collections` and `GET /v1/collections/{ref}`) work seamlessly, while admin payouts (`/v1/transfers`) require calling from a whitelisted static IP (or running the included Node `/api` server behind a static egress IP and setting `VITE_API_BASE_URL`).

---

## 5. Automatic Email & WhatsApp PDF Ticket Delivery (Optional)

When ZengaPay confirms `SUCCEEDED` (via either webhook or buyer status poll), TANK Tickets automatically invokes `ticket-delivery` to generate a QR PDF ticket in the private `tickets` Storage bucket and send it by email (Resend) and/or WhatsApp (Meta Cloud API):

- **Email (Resend):** set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `TANK Tickets <tickets@tanktickets.site>`) in Supabase Edge Function secrets.
- **WhatsApp (Meta Cloud API):** set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_TEMPLATE_NAME` in Supabase Edge Function secrets.

---

## 6. Local development

1. Copy `.env.example` to `.env` and fill in your credentials.
2. Run `npm install`.
3. Run `npm run dev` (frontend) and optionally `npm run dev:api` (local Node `/api` ZengaPay server on port `8787`, proxied by Vite when `VITE_SUPABASE_URL` is blank or `VITE_API_BASE_URL` points to it).
