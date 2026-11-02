# TANK Tickets – setup

The site works in two modes:

- **This device only** (no setup): everything is saved in the browser. Good for trying it out. Other people cannot see events or orders.
- **Online database** (Supabase, free): events, accounts and orders are shared. **You need this for organizers and buyers to use the site for real.**

## 1. Create the database (Supabase)

1. Sign up at https://supabase.com and click **New project** (choose region *Europe (Frankfurt)* or the closest to Uganda).
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, and click **Run**.
3. Open **Authentication → URL Configuration**:
   - **Site URL:** `https://tanktickets.site`
   - **Redirect URLs:** add `https://tanktickets.site/**`
4. Leave **Confirm email** switched on (Authentication → Providers → Email). The admin check depends on it. Supabase's built-in email only sends a few messages per hour; for more, add your own SMTP under **Authentication → Emails**.

## 2. Connect the site

1. In Supabase open **Project Settings → API** (or **Connect**). Copy the **Project URL** and the **anon public** key.
2. In the project folder (`~/tank`), create a file named `.env`:

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```

   The anon key is designed to be public; the security rules in `schema.sql` protect the data.
3. Rebuild and publish (see section 5).

## 3. Create the admin account

The admin desk belongs to **admin@tanktickets.site**. No other account can become admin.

1. In Supabase open **Authentication → Users → Add user → Create new user**.
2. Email `admin@tanktickets.site`, choose a strong password, tick **Auto Confirm User**, and click **Create user**.
3. On the site, open **https://tanktickets.site/#/admin** and sign in with that email and password.

Do this straight after step 1, and keep **Confirm email** switched on (Authentication → Providers → Email), so nobody else can claim the address. The admin desk is not linked from the public pages; bookmark `#/admin`. To change the admin password later, use **Forgot your password?** on the sign-in page (you need access to that mailbox) or edit the user in Supabase.

## 4. Ticket delivery

**WhatsApp:** works without setup. After paying, the buyer taps **Send to WhatsApp**; organizers can send any ticket from their guest list.

**Email (EmailJS, free plan: 200 emails a month):**

1. Sign up at https://www.emailjs.com → **Email Services → Add New Service** (for example Gmail).
2. **Email Templates → Create New Template**:
   - **To Email:** `{{to_email}}`
   - **Subject:** `Your ticket: {{event_title}}`
   - **Content:**
     ```
     Hi {{to_name}},

     You're going to {{event_title}}.
     When: {{event_date}}
     Where: {{venue}}
     Tickets: {{qty}} · {{amount}}

     Ticket code: {{ticket_code}}
     Open your QR ticket: {{ticket_link}}

     Show the QR code at the door.
     TANK Promotions
     ```
3. **Account → Security:** add `tanktickets.site` to the allowed domains.
4. On the site go to **Admin → Ticket delivery** and paste the Service ID, Template ID and Public Key.

## 5. Build and publish (Termux)

```bash
cd ~/tank
npm run build
rm -rf docs && cp -r dist docs && touch docs/.nojekyll
git add -f docs
git commit -m "Update site"
git push origin deploy
```

## Payments

Buyers pay the MTN or Airtel merchant code shown at checkout. The merchant phone receives a confirmation SMS, and an automation app such as MacroDroid opens the private TANK SMS trigger link. TANK matches the payer number and exact amount, then issues the ticket.

1. In **Admin → Payments**, save the merchant codes and generate the SMS confirmation key.
2. In **Admin → SMS**, copy the trigger link.
3. On the merchant phone, create a MacroDroid macro: **SMS Received** → **Open Website** with that link. Keep `{sms_message}` in the link so the SMS body is sent.
4. Keep the confirmation key private. Automatic matching across devices requires the Supabase database to be connected.
