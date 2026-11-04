-- Add server-route payment metadata and admin payouts for the /api DGateway integration.
alter table public.orders add column if not exists currency text not null default 'UGX';
alter table public.orders add column if not exists last_status_check_at timestamptz;

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  external_ref text not null unique,
  dgateway_ref text not null default '',
  amount integer not null check (amount > 0),
  currency text not null check (currency in ('UGX', 'KES', 'TZS', 'RWF', 'USD')),
  phone_number text not null,
  description text not null default '',
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'FAILED')),
  provider text not null default '',
  provider_ref text not null default '',
  created_by uuid references auth.users on delete set null,
  last_status_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payouts_dgateway_ref_unique_idx
  on public.payouts (dgateway_ref) where dgateway_ref <> '';
create index if not exists payouts_status_idx on public.payouts (status);
create index if not exists payouts_created_by_idx on public.payouts (created_by);

alter table public.payouts enable row level security;
drop policy if exists "payouts admin read" on public.payouts;
create policy "payouts admin read" on public.payouts for select to authenticated
  using (is_admin());
revoke all on public.payouts from anon;
grant select on public.payouts to authenticated;
grant all on public.payouts to service_role;

create or replace function public.create_order(
  p_event_id uuid,
  p_code text,
  p_name text,
  p_phone text,
  p_email text,
  p_qty integer,
  p_external_ref text
) returns json
language plpgsql
security invoker
set search_path = public
as $$
declare
  ev events;
  taken integer;
  amt integer;
  r orders;
begin
  if p_code !~ '^TNK-[A-Z0-9]{8}$' then raise exception 'Invalid ticket code.'; end if;
  if p_external_ref is null or p_external_ref !~ '^TNK-[A-Za-z0-9-]{12,80}$' then
    raise exception 'A unique checkout reference is required.';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'You can buy 1 to 10 tickets at a time.'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'A valid guest name is required.'; end if;
  if p_phone is null or p_phone !~ '^([+]?256[17][0-9]{8}|0[17][0-9]{8}|[+]?2547[0-9]{8}|[+]?255[67][0-9]{8}|[+]?2507[2389][0-9]{7}|0111777(77|99|88)[0-9]|256111777(77|99|88)[0-9])$' then
    raise exception 'A valid Mobile Money number is required.';
  end if;
  if p_email is not null and char_length(p_email) > 0 and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'A valid email address is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_external_ref, 0));
  select * into r from orders where external_ref = p_external_ref limit 1;
  if found then
    if r.event_id <> p_event_id or r.code <> p_code or r.phone <> p_phone or r.qty <> p_qty
      or r.name <> trim(p_name) or r.email <> lower(coalesce(p_email, '')) then
      raise exception 'This checkout reference belongs to different order details.';
    end if;
    return row_to_json(r);
  end if;

  select * into ev from events where id = p_event_id and status = 'published' for update;
  if not found then raise exception 'This event is not available.'; end if;
  if ev.starts_at < now() - interval '12 hours' then raise exception 'This event has already happened.'; end if;
  select coalesce(sum(qty), 0) into taken from orders
    where event_id = ev.id and (status in ('SUCCEEDED', 'CHECKED_IN')
      or (status = 'PENDING' and created_at > now() - interval '15 minutes'));
  if taken + p_qty > ev.capacity then raise exception 'Sorry, not enough tickets left.'; end if;

  amt := ev.price * p_qty;
  insert into orders (code, event_id, event_title, user_id, name, phone, email, qty, amount, status, external_ref, currency)
  values (p_code, ev.id, ev.title, auth.uid(), trim(p_name), p_phone, lower(coalesce(p_email, '')), p_qty, amt,
    case when amt = 0 then 'SUCCEEDED' else 'PENDING' end, p_external_ref, 'UGX')
  returning * into r;
  return row_to_json(r);
end $$;

revoke all on function public.create_order(uuid, text, text, text, text, integer, text) from public;
grant execute on function public.create_order(uuid, text, text, text, text, integer, text) to anon, authenticated;
