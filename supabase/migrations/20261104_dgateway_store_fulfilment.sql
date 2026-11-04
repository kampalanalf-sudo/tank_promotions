-- Hosted DGateway store -> Tank Tickets orders.
-- Additive migration: does not rewrite existing orders or confirm payments by itself.
begin;

create table if not exists public.dgateway_store_mappings (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null default 'tanktickets',
  product_id text not null,
  product_slug text not null,
  event_id uuid not null references public.events on delete cascade,
  label text not null default '',
  unit_amount integer not null check (unit_amount > 0),
  currency text not null default 'UGX' check (currency in ('UGX', 'KES', 'TZS', 'RWF', 'USD')),
  tickets_per_unit integer not null default 1 check (tickets_per_unit between 1 and 10),
  checkout_url text not null,
  enabled boolean not null default false,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dgateway_store_mappings_product_id_key unique (store_slug, product_id),
  constraint dgateway_store_mappings_product_slug_key unique (store_slug, product_slug),
  constraint dgateway_store_mappings_product_id_format check (product_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  constraint dgateway_store_mappings_product_slug_format check (product_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint dgateway_store_mappings_checkout_url_https check (checkout_url ~ '^https://')
);

create table if not exists public.dgateway_store_payments (
  reference text primary key,
  store_slug text not null default 'tanktickets',
  product_id text not null default '',
  product_slug text not null default '',
  event_id uuid references public.events on delete set null,
  order_id uuid references public.orders on delete set null,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'completed', 'failed')),
  fulfilment_status text not null default 'pending' check (fulfilment_status in ('pending', 'issued', 'blocked', 'not_required')),
  error_code text not null default '',
  amount integer not null check (amount > 0),
  currency text not null check (currency in ('UGX', 'KES', 'TZS', 'RWF', 'USD')),
  quantity integer check (quantity between 1 and 10),
  buyer_name text not null default '',
  buyer_email text not null default '',
  buyer_phone text not null default '',
  provider text not null default '',
  provider_ref text not null default '',
  failure_reason text not null default '',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dgateway_store_payments_reference_format check (reference ~ '^[A-Za-z0-9_-]{6,200}$'),
  constraint dgateway_store_payments_order_id_key unique (order_id)
);

create index if not exists dgateway_store_payments_event_idx on public.dgateway_store_payments (event_id);
create index if not exists dgateway_store_payments_status_idx on public.dgateway_store_payments (payment_status, fulfilment_status);
create index if not exists dgateway_store_mappings_event_idx on public.dgateway_store_mappings (event_id);

alter table public.dgateway_store_mappings enable row level security;
alter table public.dgateway_store_payments enable row level security;

revoke all on public.dgateway_store_mappings from public, anon;
revoke all on public.dgateway_store_payments from public, anon;
grant select, insert, update, delete on public.dgateway_store_mappings to authenticated;
grant select on public.dgateway_store_payments to authenticated;
grant all on public.dgateway_store_mappings to service_role;
grant all on public.dgateway_store_payments to service_role;

drop policy if exists "store mappings admin read" on public.dgateway_store_mappings;
create policy "store mappings admin read" on public.dgateway_store_mappings for select to authenticated using (public.is_admin());
drop policy if exists "store mappings admin insert" on public.dgateway_store_mappings;
create policy "store mappings admin insert" on public.dgateway_store_mappings for insert to authenticated with check (public.is_admin());
drop policy if exists "store mappings admin update" on public.dgateway_store_mappings;
create policy "store mappings admin update" on public.dgateway_store_mappings for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "store mappings admin delete" on public.dgateway_store_mappings;
create policy "store mappings admin delete" on public.dgateway_store_mappings for delete to authenticated using (public.is_admin());
drop policy if exists "store payments admin read" on public.dgateway_store_payments;
create policy "store payments admin read" on public.dgateway_store_payments for select to authenticated using (public.is_admin());

-- Public, non-PII checkout links for published events.
create or replace function public.hosted_ticket_products()
returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'event_id', m.event_id,
    'product_id', m.product_id,
    'product_slug', m.product_slug,
    'checkout_url', m.checkout_url,
    'unit_amount', m.unit_amount,
    'currency', m.currency,
    'tickets_per_unit', m.tickets_per_unit
  ) order by m.created_at), '[]'::json)
  from dgateway_store_mappings m
  join events e on e.id = m.event_id
  where m.enabled and e.status = 'published' and e.starts_at > now() - interval '12 hours';
$$;
revoke execute on function public.hosted_ticket_products() from public;
grant execute on function public.hosted_ticket_products() to anon, authenticated;

-- A buyer can retrieve an issued QR ticket only with the DGateway reference AND email.
-- This never marks an order paid and never returns pending/failed purchases.
create or replace function public.store_ticket_by_reference(p_reference text, p_email text)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'code', o.code,
    'event_title', e.title,
    'starts_at', e.starts_at,
    'venue', e.venue,
    'area', e.area,
    'name', o.name,
    'qty', o.qty,
    'amount', o.amount,
    'status', o.status
  )
  from dgateway_store_payments p
  join orders o on o.id = p.order_id
  join events e on e.id = o.event_id
  where p.reference = trim(coalesce(p_reference, ''))
    and o.email = lower(trim(coalesce(p_email, '')))
    and o.email <> ''
    and o.status in ('SUCCEEDED', 'CHECKED_IN')
    and p.payment_status = 'completed'
    and p.fulfilment_status = 'issued'
  limit 1;
$$;
revoke execute on function public.store_ticket_by_reference(text, text) from public;
grant execute on function public.store_ticket_by_reference(text, text) to anon, authenticated;

-- Called only by the Edge Function after it has verified the transaction with DGateway.
-- The webhook body itself is never sufficient to create a paid order.
create or replace function public.apply_dgateway_store_payment(p_payment jsonb)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_reference text := trim(coalesce(p_payment->>'reference', ''));
  v_store_slug text := trim(coalesce(p_payment->>'store_slug', 'tanktickets'));
  v_product_id text := trim(coalesce(p_payment->>'product_id', ''));
  v_product_slug text := trim(coalesce(p_payment->>'product_slug', ''));
  v_status text := trim(coalesce(p_payment->>'status', ''));
  v_currency text := upper(trim(coalesce(p_payment->>'currency', '')));
  v_amount numeric := nullif(trim(coalesce(p_payment->>'amount', '')), '')::numeric;
  v_quantity integer := nullif(trim(coalesce(p_payment->>'quantity', '')), '')::integer;
  v_name text := trim(coalesce(p_payment->>'name', ''));
  v_email text := lower(trim(coalesce(p_payment->>'email', '')));
  v_phone text := trim(coalesce(p_payment->>'phone', ''));
  v_provider text := left(trim(coalesce(p_payment->>'provider', '')), 100);
  v_provider_ref text := left(trim(coalesce(p_payment->>'provider_ref', '')), 200);
  v_failure_reason text := left(trim(coalesce(p_payment->>'failure_reason', '')), 500);
  v_existing dgateway_store_payments%rowtype;
  v_seen boolean := false;
  v_event_id uuid;
  v_mapping dgateway_store_mappings%rowtype;
  v_event events%rowtype;
  v_order orders%rowtype;
  v_taken integer;
  v_tickets integer;
  v_block text := '';
  v_code text;
  v_order_id uuid;
  v_attempt integer;
begin
  if v_reference !~ '^[A-Za-z0-9_-]{6,200}$' then raise exception 'Invalid payment reference.' using errcode = '22023'; end if;
  if v_status not in ('pending', 'completed', 'failed') then raise exception 'Invalid verified payment status.' using errcode = '22023'; end if;
  if v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount) or v_amount > 2000000000 then
    raise exception 'Invalid verified payment amount.' using errcode = '22023';
  end if;
  if v_currency not in ('UGX', 'KES', 'TZS', 'RWF', 'USD') then raise exception 'Invalid verified currency.' using errcode = '22023'; end if;
  if v_quantity is not null and (v_quantity < 1 or v_quantity > 10) then raise exception 'Invalid ticket quantity.' using errcode = '22023'; end if;
  if char_length(v_name) > 80 or char_length(v_email) > 120 or char_length(v_phone) > 30 then
    raise exception 'Invalid buyer details.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dgateway-store:' || v_reference, 0));
  select * into v_existing from dgateway_store_payments where reference = v_reference;
  v_seen := found;
  if v_seen then
    if v_existing.amount <> v_amount or v_existing.currency <> v_currency then
      raise exception 'Verified payment does not match the stored amount/currency.' using errcode = '22023';
    end if;
    if v_existing.store_slug <> v_store_slug then
      raise exception 'Verified store does not match the stored payment.' using errcode = '22023';
    end if;
    if v_existing.product_id <> '' and v_product_id <> '' and v_existing.product_id <> v_product_id then
      raise exception 'Verified product does not match the stored payment.' using errcode = '22023';
    end if;
    if v_existing.product_slug <> '' and v_product_slug <> '' and v_existing.product_slug <> v_product_slug then
      raise exception 'Verified product does not match the stored payment.' using errcode = '22023';
    end if;
    if v_existing.buyer_email <> '' and v_email <> '' and v_existing.buyer_email <> v_email then
      raise exception 'Verified buyer does not match the stored payment.' using errcode = '22023';
    end if;
    if v_existing.order_id is not null then
      select * into v_order from orders where id = v_existing.order_id;
      return json_build_object('received', true, 'status', v_existing.payment_status, 'fulfilment', 'issued', 'order_id', v_order.id, 'code', v_order.code, 'idempotent', true);
    end if;
    if v_existing.payment_status = 'failed' and v_status <> 'failed' then
      return json_build_object('received', true, 'status', 'failed', 'fulfilment', 'not_required', 'idempotent', true);
    end if;
    if v_existing.payment_status = 'completed' and v_status = 'failed' then
      return json_build_object('received', true, 'status', 'completed', 'fulfilment', v_existing.fulfilment_status, 'code', v_existing.error_code, 'idempotent', true);
    end if;
  end if;

  if v_status = 'completed' then
    if v_product_id = '' or v_product_slug = '' then
      v_block := 'PRODUCT_DETAILS_MISSING';
    else
      select * into v_mapping from dgateway_store_mappings
        where store_slug = v_store_slug and product_id = v_product_id and product_slug = v_product_slug and enabled
        for update;
      if not found then
        v_block := 'PRODUCT_NOT_MAPPED';
      else
        v_event_id := v_mapping.event_id;
        if v_mapping.currency <> v_currency then
          v_block := 'CURRENCY_MISMATCH';
        else
          if v_quantity is null then
            if v_amount % v_mapping.unit_amount = 0 then
              v_quantity := (v_amount / v_mapping.unit_amount)::integer;
            end if;
          end if;
          if v_quantity is null or v_quantity < 1 or v_quantity > 10 or v_mapping.unit_amount * v_quantity <> v_amount then
            v_block := 'AMOUNT_MISMATCH';
          elsif char_length(v_name) < 1 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
            v_block := 'BUYER_DETAILS_MISSING';
          else
            select * into v_event from events where id = v_mapping.event_id and status = 'published' for update;
            if not found then
              v_block := 'EVENT_UNAVAILABLE';
            elsif v_event.starts_at < now() - interval '12 hours' then
              v_block := 'EVENT_ENDED';
            else
              v_tickets := v_quantity * v_mapping.tickets_per_unit;
              if v_tickets > 10 then
                v_block := 'TICKET_LIMIT';
              else
                select coalesce(sum(qty), 0) into v_taken from orders
                  where event_id = v_event.id and (status in ('SUCCEEDED', 'CHECKED_IN')
                    or (status = 'PENDING' and created_at > now() - interval '15 minutes'));
                if v_taken + v_tickets > v_event.capacity then
                  v_block := 'CAPACITY_EXCEEDED';
                end if;
              end if;
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  if v_block <> '' then
    insert into dgateway_store_payments as p (
      reference, store_slug, product_id, product_slug, event_id, payment_status, fulfilment_status, error_code,
      amount, currency, quantity, buyer_name, buyer_email, buyer_phone, provider, provider_ref, failure_reason, last_verified_at, updated_at
    ) values (
      v_reference, v_store_slug, v_product_id, v_product_slug, v_event_id, v_status, 'blocked', v_block,
      v_amount::integer, v_currency, v_quantity, v_name, v_email, v_phone, v_provider, v_provider_ref, v_failure_reason, now(), now()
    )
    on conflict (reference) do update set
      product_id = coalesce(nullif(excluded.product_id, ''), p.product_id),
      product_slug = coalesce(nullif(excluded.product_slug, ''), p.product_slug),
      event_id = coalesce(excluded.event_id, p.event_id),
      payment_status = excluded.payment_status, fulfilment_status = 'blocked', error_code = excluded.error_code,
      quantity = coalesce(excluded.quantity, p.quantity),
      buyer_name = coalesce(nullif(excluded.buyer_name, ''), p.buyer_name),
      buyer_email = coalesce(nullif(excluded.buyer_email, ''), p.buyer_email),
      buyer_phone = coalesce(nullif(excluded.buyer_phone, ''), p.buyer_phone),
      provider = excluded.provider, provider_ref = excluded.provider_ref, failure_reason = excluded.failure_reason,
      last_verified_at = now(), updated_at = now();
    return json_build_object('received', true, 'status', v_status, 'fulfilment', 'blocked', 'code', v_block, 'idempotent', v_seen);
  end if;

  if v_status <> 'completed' then
    insert into dgateway_store_payments as p (
      reference, store_slug, product_id, product_slug, event_id, payment_status, fulfilment_status, error_code,
      amount, currency, quantity, buyer_name, buyer_email, buyer_phone, provider, provider_ref, failure_reason, last_verified_at, updated_at
    ) values (
      v_reference, v_store_slug, v_product_id, v_product_slug, v_event_id, v_status,
      case when v_status = 'failed' then 'not_required' else 'pending' end, '',
      v_amount::integer, v_currency, v_quantity, v_name, v_email, v_phone, v_provider, v_provider_ref, v_failure_reason, now(), now()
    )
    on conflict (reference) do update set
      payment_status = excluded.payment_status, fulfilment_status = excluded.fulfilment_status, error_code = '',
      product_id = coalesce(nullif(excluded.product_id, ''), p.product_id),
      product_slug = coalesce(nullif(excluded.product_slug, ''), p.product_slug),
      quantity = coalesce(excluded.quantity, p.quantity),
      buyer_name = coalesce(nullif(excluded.buyer_name, ''), p.buyer_name),
      buyer_email = coalesce(nullif(excluded.buyer_email, ''), p.buyer_email),
      buyer_phone = coalesce(nullif(excluded.buyer_phone, ''), p.buyer_phone),
      provider = excluded.provider, provider_ref = excluded.provider_ref, failure_reason = excluded.failure_reason,
      last_verified_at = now(), updated_at = now();
    return json_build_object('received', true, 'status', v_status, 'fulfilment', case when v_status = 'failed' then 'not_required' else 'pending' end, 'idempotent', v_seen);
  end if;

  v_tickets := v_quantity * v_mapping.tickets_per_unit;
  for v_attempt in 1..20 loop
    v_code := 'TNK-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
    exit when not exists (select 1 from orders where code = v_code);
  end loop;
  if exists (select 1 from orders where code = v_code) then raise exception 'Could not allocate a ticket code.' using errcode = '53000'; end if;

  insert into orders (
    code, event_id, event_title, user_id, name, phone, email, qty, amount, currency, status,
    dgateway_ref, payment_ref, provider, provider_ref, external_ref, last_status_check_at, created_at, updated_at
  ) values (
    v_code, v_event.id, v_event.title, null, v_name, v_phone, v_email, v_tickets, v_amount::integer, v_currency, 'SUCCEEDED',
    v_reference, v_reference, v_provider, v_provider_ref, 'TNK-STORE-' || md5(v_reference), now(), now(), now()
  ) returning id into v_order_id;

  insert into dgateway_store_payments as p (
    reference, store_slug, product_id, product_slug, event_id, order_id, payment_status, fulfilment_status, error_code,
    amount, currency, quantity, buyer_name, buyer_email, buyer_phone, provider, provider_ref, failure_reason, last_verified_at, updated_at
  ) values (
    v_reference, v_store_slug, v_product_id, v_product_slug, v_event.id, v_order_id, 'completed', 'issued', '',
    v_amount::integer, v_currency, v_quantity, v_name, v_email, v_phone, v_provider, v_provider_ref, '', now(), now()
  )
  on conflict (reference) do update set
    order_id = excluded.order_id, event_id = excluded.event_id,
    product_id = excluded.product_id, product_slug = excluded.product_slug,
    payment_status = 'completed', fulfilment_status = 'issued', error_code = '', quantity = excluded.quantity,
    buyer_name = excluded.buyer_name, buyer_email = excluded.buyer_email, buyer_phone = excluded.buyer_phone,
    provider = excluded.provider, provider_ref = excluded.provider_ref, failure_reason = '', last_verified_at = now(), updated_at = now();

  return json_build_object('received', true, 'status', 'completed', 'fulfilment', 'issued', 'order_id', v_order_id, 'code', v_code, 'idempotent', v_seen);
end $$;
revoke execute on function public.apply_dgateway_store_payment(jsonb) from public, anon, authenticated;
grant execute on function public.apply_dgateway_store_payment(jsonb) to service_role;

-- Seed the one currently published, price-matched hosted product. Safe to rerun; does not overwrite admin edits.
insert into public.dgateway_store_mappings (
  store_slug, product_id, product_slug, event_id, label, unit_amount, currency, tickets_per_unit, checkout_url, enabled
)
select 'tanktickets', '49', 'ruhindo-beach-vibes-740d', e.id, 'RUHINDO BEACH VIBES', 20000, 'UGX', 1,
       'https://dgatewayadmin.desispay.com/store/pay/ruhindo-beach-vibes-740d', true
from public.events e
where e.id = '5534bf00-c5ca-4d8d-b69d-72663d562ff3' and e.price = 20000 and e.status = 'published'
on conflict (store_slug, product_id) do nothing;

commit;
