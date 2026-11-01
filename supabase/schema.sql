-- TANK Tickets database
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again (it drops and recreates the functions and policies).


-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  type text not null default 'Other',
  venue text not null,
  area text not null default '',
  starts_at timestamptz not null,
  price integer not null default 0 check (price >= 0),
  capacity integer not null check (capacity > 0),
  image text not null default '',
  description text not null default '',
  organizer_name text not null default '',
  organizer_phone text not null default '',
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  event_id uuid not null references public.events on delete cascade,
  event_title text not null,
  user_id uuid references auth.users on delete set null,
  name text not null,
  phone text not null,
  email text not null default '',
  qty integer not null check (qty between 1 and 10),
  amount integer not null check (amount >= 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'SUCCEEDED', 'FAILED', 'CHECKED_IN')),
  zenga_ref text not null default '',
  external_ref text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists orders_event_idx on public.orders (event_id);

create table if not exists public.briefs (
  id uuid primary key default gen_random_uuid(),
  venue text not null,
  area text not null default '',
  date text not null default '',
  type text not null default '',
  phone text not null,
  note text not null default '',
  status text not null default 'New' check (status in ('New', 'In review', 'Replied')),
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  zenga_env text not null default 'sandbox',
  zenga_token text not null default '',
  simulate boolean not null default true,
  email_service_id text not null default '',
  email_template_id text not null default '',
  email_public_key text not null default ''
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------- helpers

-- The admin is the account with this email address, and only once the email
-- has been confirmed. Keep "Confirm email" switched on in Supabase.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) = 'admin@tanktickets.site'
      and email_confirmed_at is not null
  );
$$;

-- New sign-ups get a profile with the name and phone they entered.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email, phone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'phone', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins can publish or reject. Organizers' new events start "pending".
create or replace function public.guard_event_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then
    -- Events the TANK team creates go live straight away.
    if tg_op = 'INSERT' then new.status := 'published'; end if;
  else
    if tg_op = 'INSERT' then
      new.status := 'pending';
      new.owner_id := auth.uid();
    else
      new.status := old.status;
      new.owner_id := old.owner_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists events_guard on public.events;
create trigger events_guard before insert or update on public.events
  for each row execute function public.guard_event_status();

-- ---------------------------------------------------------------- security

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.orders enable row level security;
alter table public.briefs enable row level security;
alter table public.settings enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (id = auth.uid() or is_admin());

drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select
  using (status = 'published' or owner_id = auth.uid() or is_admin());
drop policy if exists "events insert" on public.events;
create policy "events insert" on public.events for insert to authenticated
  with check (owner_id = auth.uid() or is_admin());
drop policy if exists "events update" on public.events;
create policy "events update" on public.events for update to authenticated
  using (owner_id = auth.uid() or is_admin());
drop policy if exists "events delete" on public.events;
create policy "events delete" on public.events for delete to authenticated
  using (owner_id = auth.uid() or is_admin());

-- Orders are created and updated only through the functions below.
drop policy if exists "orders read" on public.orders;
create policy "orders read" on public.orders for select using (
  user_id = auth.uid()
  or (email <> '' and email = lower(coalesce(auth.jwt() ->> 'email', '')))
  or is_admin()
  or exists (select 1 from events e where e.id = orders.event_id and e.owner_id = auth.uid())
);

drop policy if exists "briefs insert" on public.briefs;
create policy "briefs insert" on public.briefs for insert to anon, authenticated with check (status = 'New');
drop policy if exists "briefs admin read" on public.briefs;
create policy "briefs admin read" on public.briefs for select using (is_admin());
drop policy if exists "briefs admin update" on public.briefs;
create policy "briefs admin update" on public.briefs for update using (is_admin());

drop policy if exists "settings read" on public.settings;
create policy "settings read" on public.settings for select using (true);
drop policy if exists "settings admin write" on public.settings;
create policy "settings admin write" on public.settings for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------- functions

-- Tickets sold per event (public, counts only).
create or replace function public.event_sold_counts()
returns table (event_id uuid, sold bigint)
language sql stable security definer set search_path = public as $$
  select o.event_id, sum(o.qty)::bigint
  from orders o
  where o.status in ('SUCCEEDED', 'CHECKED_IN')
  group by o.event_id;
$$;

-- Creates an order. Price and availability are checked here, not in the browser.
create or replace function public.create_order(
  p_event_id uuid, p_code text, p_name text, p_phone text, p_email text, p_qty integer, p_external_ref text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  taken integer;
  amt integer;
  r orders;
begin
  if p_code !~ '^TNK-[A-Z0-9]{6,}$' then raise exception 'Invalid ticket code.'; end if;
  if p_qty < 1 or p_qty > 10 then raise exception 'You can buy 1 to 10 tickets at a time.'; end if;
  if char_length(trim(p_name)) = 0 or char_length(p_phone) < 9 then raise exception 'Name and phone are required.'; end if;

  select * into ev from events where id = p_event_id and status = 'published' for update;
  if not found then raise exception 'This event is not available.'; end if;
  if ev.starts_at < now() - interval '12 hours' then raise exception 'This event has already happened.'; end if;

  -- Paid tickets plus unpaid ones reserved in the last 10 minutes.
  select coalesce(sum(qty), 0) into taken from orders
  where event_id = ev.id
    and (status in ('SUCCEEDED', 'CHECKED_IN') or (status = 'PENDING' and created_at > now() - interval '10 minutes'));
  if taken + p_qty > ev.capacity then raise exception 'Sorry, not enough tickets left.'; end if;

  amt := ev.price * p_qty;
  insert into orders (code, event_id, event_title, user_id, name, phone, email, qty, amount, status, external_ref)
  values (p_code, ev.id, ev.title, auth.uid(), trim(p_name), p_phone, lower(coalesce(p_email, '')), p_qty, amt,
          case when amt = 0 then 'SUCCEEDED' else 'PENDING' end, coalesce(p_external_ref, ''))
  returning * into r;
  return row_to_json(r);
end $$;

-- Saves the ZengaPay reference / result for a pending order.
-- NOTE: for real money, confirm payments from a server (ZengaPay callback via a
-- Supabase Edge Function) instead of trusting the buyer's browser.
create or replace function public.confirm_order(p_code text, p_status text, p_zenga_ref text default '')
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('PENDING', 'SUCCEEDED', 'FAILED') then raise exception 'Invalid status.'; end if;
  update orders
     set status = p_status,
         zenga_ref = coalesce(nullif(p_zenga_ref, ''), zenga_ref)
   where code = p_code and status = 'PENDING';
  return found;
end $$;

-- Lets anyone holding a ticket link see whether it is valid.
create or replace function public.ticket_status(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select status from orders where code = p_code;
$$;

-- Door check-in, allowed for the event's organizer and admins.
create or replace function public.check_in(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare
  o orders;
  owner uuid;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'message', 'Please sign in.'); end if;
  select * into o from orders where code = upper(trim(p_code)) for update;
  if not found then return json_build_object('ok', false, 'message', 'No ticket with that code.'); end if;
  select owner_id into owner from events where id = o.event_id;
  if not (is_admin() or owner = auth.uid()) then
    return json_build_object('ok', false, 'message', 'This ticket is for another organizer''s event.');
  end if;
  if o.status = 'CHECKED_IN' then
    return json_build_object('ok', false, 'message', 'Already checked in: ' || o.name, 'order', row_to_json(o));
  end if;
  if o.status <> 'SUCCEEDED' then
    return json_build_object('ok', false, 'message', 'This ticket has not been paid.', 'order', row_to_json(o));
  end if;
  update orders set status = 'CHECKED_IN' where id = o.id returning * into o;
  return json_build_object('ok', true, 'message', 'Welcome ' || o.name || ' · ' || o.qty || ' guest(s)', 'order', row_to_json(o));
end $$;

grant execute on function public.event_sold_counts() to anon, authenticated;
grant execute on function public.create_order(uuid, text, text, text, text, integer, text) to anon, authenticated;
grant execute on function public.confirm_order(text, text, text) to anon, authenticated;
grant execute on function public.ticket_status(text) to anon, authenticated;
revoke execute on function public.check_in(text) from public, anon;
grant execute on function public.check_in(text) to authenticated;

-- ---------------------------------------------------------------- admin account
-- The admin is admin@tanktickets.site (see is_admin above). Create it in
-- Supabase → Authentication → Users → Add user, with "Auto Confirm User" ticked.

-- ---------------------------------------------------------------- merchant SMS payments
alter table public.settings add column if not exists mtn_merchant_code text not null default '89713371';
alter table public.settings add column if not exists mtn_merchant_name text not null default 'TANK Promotions';
alter table public.settings add column if not exists airtel_merchant_code text not null default '7280543';
alter table public.settings add column if not exists airtel_merchant_name text not null default 'TANK Promotions';
alter table public.settings add column if not exists sms_secret text not null default 'tank2026secret';

-- ensure existing row has the defaults populated if blank
update public.settings
   set mtn_merchant_code = case when mtn_merchant_code = '' or mtn_merchant_code = '7185040' then '89713371' else mtn_merchant_code end,
       mtn_merchant_name = case when mtn_merchant_name = '' then 'TANK Promotions' else mtn_merchant_name end,
       airtel_merchant_code = case when airtel_merchant_code = '' or airtel_merchant_code = '7185040' then '7280543' else airtel_merchant_code end,
       airtel_merchant_name = case when airtel_merchant_name = '' then 'TANK Promotions' else airtel_merchant_name end,
       sms_secret = case when sms_secret = '' then 'tank2026secret' else sms_secret end
 where id = 1;

drop policy if exists "settings read" on public.settings;
create policy "settings read" on public.settings for select using (is_admin());

create or replace function public.storefront_settings()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'email_service_id', email_service_id,
    'email_template_id', email_template_id,
    'email_public_key', email_public_key,
    'mtn_merchant_code', mtn_merchant_code,
    'mtn_merchant_name', mtn_merchant_name,
    'airtel_merchant_code', airtel_merchant_code,
    'airtel_merchant_name', airtel_merchant_name,
    'simulate', simulate,
    'zenga_env', zenga_env
  ) from settings where id = 1;
$$;

create or replace function public.apply_payment_sms(p_secret text, p_text text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  sec text;
  amt integer;
  ref text;
  tid text;
  payer text;
  raw_phone text;
  n integer;
  hit orders;
begin
  select sms_secret into sec from settings where id = 1;
  if sec is null or length(sec) < 6 or p_secret is distinct from sec then
    return json_build_object('ok', false, 'message', 'Wrong confirmation key.');
  end if;

  -- 1. Amount: handles UGX 500, UGX 50,000, UGX500, etc.
  amt := substring(replace(coalesce(p_text, ''), ',', '') from '(?i)UGX[[:space:]]*([0-9]+)')::integer;
  if amt is null then
    return json_build_object('ok', false, 'message', 'That message has no UGX amount, so it was ignored.');
  end if;

  -- 2. Transaction ID (TID)
  tid := substring(coalesce(p_text, '') from '(?i)(?:TID|TxId|Trans[[:space:]]*ID|Id)[[:space:]:]*([A-Za-z0-9]+)');

  -- 3. Ticket code (e.g. TNK-ABCDEF12)
  ref := substring(upper(coalesce(p_text, '')) from 'TNK-?[A-Z0-9]{6,10}');
  if ref is not null then
    ref := 'TNK-' || replace(replace(ref, 'TNK-', ''), 'TNK', '');
  end if;

  -- 4. Payer phone number: matches 2567XXXXXXXX, 07XXXXXXXX, or 7XXXXXXXX (9 digits)
  raw_phone := substring(replace(replace(coalesce(p_text, ''), ' ', ''), '-', '') from '(?i)(?:from|sender:)?(2567[0-9]{8}|07[0-9]{8}|7[0-9]{8})');
  if raw_phone is not null then
    if raw_phone like '256%' then
      payer := raw_phone;
    elsif raw_phone like '07%' then
      payer := '256' || substring(raw_phone from 2);
    elsif raw_phone like '7%' and length(raw_phone) = 9 then
      payer := '256' || raw_phone;
    end if;
  end if;

  -- Priority 1: match by ticket code
  if ref is not null then
    select count(*) into n from orders
    where status = 'PENDING' and amt >= amount and replace(code, '-', '') = replace(ref, '-', '');
    if n = 1 then
      select * into hit from orders
      where status = 'PENDING' and amt >= amount and replace(code, '-', '') = replace(ref, '-', '')
      limit 1;
    end if;
  end if;

  -- Priority 2: match by payer phone number within the last 45 minutes
  if hit.id is null and payer is not null then
    select count(*) into n from orders
    where status = 'PENDING' and amt >= amount and phone = payer
      and created_at > now() - interval '45 minutes';
    if n = 1 then
      select * into hit from orders
      where status = 'PENDING' and amt >= amount and phone = payer
        and created_at > now() - interval '45 minutes'
      limit 1;
    elsif n > 1 then
      return json_build_object('ok', false, 'message', 'Multiple pending orders found for this phone number.');
    end if;
  end if;

  if hit.id is null then
    return json_build_object('ok', false, 'message', 'No pending order matches this SMS (amount UGX ' || amt || coalesce(', phone ' || payer, '') || ').');
  end if;

  update orders
     set status = 'SUCCEEDED',
         zenga_ref = coalesce(tid, 'SMS')
   where id = hit.id and status = 'PENDING';

  return json_build_object('ok', true, 'message', 'Ticket issued for ' || hit.name || ' (UGX ' || amt || ').', 'code', hit.code, 'tid', tid);
end $$;

grant execute on function public.storefront_settings() to anon, authenticated;
grant execute on function public.apply_payment_sms(text, text) to anon, authenticated;
