# TANK Tickets – DGateway & Supabase Setup Guide

TANK Tickets is integrated with **DGateway** (unified payment gateway for East African Mobile Money — MTN Uganda & Airtel Uganda) and **Supabase** (database, authentication, and secure edge functions).

---

## 1. Create the Database (Supabase)

1. Sign up / log in at **[https://supabase.com](https://supabase.com)** and create a **New project** (name: `tank-tickets`, region: *Europe (Frankfurt)* or closest to Uganda).
2. Open **SQL Editor → New query**, copy and paste everything from **`supabase/schema.sql`**, and click **Run**.
3. Open **Authentication → URL Configuration**:
   - **Site URL:** `https://tanktickets.site`
   - **Redirect URLs:** add `https://tanktickets.site/**`
4. Leave **Confirm email** switched on (Authentication → Providers → Email).

---

## 2. Connect the Site Frontend

1. In Supabase open **Project Settings → API** (or **Connect**). Copy the **Project URL** and the **anon public** key (`eyJ...`).
2. In your local project folder (`~/tank`), create or edit `.env`:

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
   ```

   *(The anon key is safe for client-side use; Supabase Row Level Security protects your database).*

---

## 3. Deploy Supabase Edge Functions & Configure DGateway

DGateway secrets (`DGATEWAY_API_KEY`, `DGATEWAY_WEBHOOK_SECRET`) live securely in Supabase Edge Functions and are never exposed to the client browser.

### A. Set DGateway Secrets in Supabase

1. Go to **[https://dgatewayadmin.desispay.com](https://dgatewayadmin.desispay.com)**:
   - Go to **My Apps → [your app] → API Keys** → Generate or copy your API Key (`dgw_test_...` for development, `dgw_live_...` for production).
   - Go to **My Apps → [your app] → Settings** → scroll to **Webhook Secret** → click Show → Copy.
2. In your Supabase Dashboard:
   - Go to **Project Settings → Edge Functions → Secrets** (or using Supabase CLI), and add:
     - `DGATEWAY_API_KEY` = `dgw_test_...` (or `dgw_live_...`)
     - `DGATEWAY_WEBHOOK_SECRET` = *(copied from DGateway Settings)*
     - `DGATEWAY_API_URL` = `https://dgatewayapi.desispay.com`
     - `APP_URL` = `https://tanktickets.site`

### B. Register Your Webhook URL in DGateway

1. In **[https://dgatewayadmin.desispay.com](https://dgatewayadmin.desispay.com)** → **My Apps → Settings**:
2. Set the **Webhook URL** to:
   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/dgateway-webhook
   ```
3. Save changes.

### C. Deploy Edge Functions (using Supabase CLI)

From your terminal / development environment:
```bash
supabase functions deploy dgateway-collect --no-verify-jwt
supabase functions deploy dgateway-status --no-verify-jwt
supabase functions deploy dgateway-webhook --no-verify-jwt
```

---

## 4. Create the Admin Account

The admin desk is hardcoded for **`admin@tanktickets.site`**. No other account can access the admin control panel.

1. In Supabase open **Authentication → Users → Add user → Create new user**.
2. Email: `admin@tanktickets.site`, set a strong password, and check **Auto Confirm User**.
3. Open **`https://tanktickets.site/#/admin`** and sign in.
4. You can also review or update DGateway API keys and webhook settings directly inside **Admin (`#/admin`) → DGateway**.

---

## 5. Automated Ticket Delivery

### A. WhatsApp Tickets (Instant)
Works out of the box with zero configuration! When buyers complete their payment, they tap **Send to WhatsApp** to receive their QR ticket link and code directly in their chat.

### B. Automated Email Tickets (EmailJS)
1. Sign up for free at **[https://www.emailjs.com](https://www.emailjs.com)** (free tier includes 200 emails/month).
2. Create an **Email Service** (e.g. Gmail).
3. Create an **Email Template** with **To Email:** `{{to_email}}` and content containing:
   ```text
   Hi {{to_name}},

   You're going to {{event_title}}!
   📅 Date: {{event_date}}
   📍 Venue: {{venue}}
   🎟️ Tickets: {{qty}} · {{amount}}

   Your Ticket Code: {{ticket_code}}
   Open your digital QR Ticket: {{ticket_link}}

   Show the QR code at the entrance for scanning.
   TANK Promotions — Kila Sekunde Ina Hesabu
   ```
4. In EmailJS **Account → Security**, add `tanktickets.site` to Allowed Domains.
5. In **Admin (`#/admin`) → Ticket delivery**, paste your Service ID, Template ID, and Public Key.

---

## 6. Testing DGateway Payments (Sandbox Mode)

When testing with a `dgw_test_*` API key:
- At checkout, enter test phone number **`256111777111`** (MTN or Airtel) — DGateway will simulate an instant successful Mobile Money STK push!
- To test the failure path, enter **`256111777222`**.
- Webhook events arrive with `X-DGateway-Signature` and are cryptographically verified using HMAC-SHA256 before updating the ticket status to `SUCCEEDED`.
- Once verified, the live QR ticket unlocks immediately with auto-emailing.

---

## 7. Build and Publish (Termux)

```bash
cd ~/tank
npm run build
rm -rf docs && cp -a dist docs && touch docs/.nojekyll
git add -A && git add -f docs
git commit -m "Configure DGateway payment gateway with automated STK push"
git push origin deploy --force
```
