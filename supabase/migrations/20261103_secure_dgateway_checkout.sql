-- Run before deploying the new DGateway Edge Functions.
-- Preserves existing events/orders; removes public manual payment confirmation.
begin;

alter table public.orders add column if not exists collection_started_at timestamptz;
create index if not exists orders_external_ref_idx on public.orders (external_ref);

-- Only server-verified DGateway updates may mark a paid order successful.
-- Revoke every historical overload, including the old Zenga/SMS parameter names.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('confirm_order', 'apply_payment_sms')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
  end loop;
end $$;

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
  if p_code !~ '^TNK-[A-Z0-9]{8}$' then raise exception 'Invalid ticket code.'; end if;
  if p_external_ref is null or p_external_ref !~ '^TNK-[A-Za-z0-9-]{12,80}$' then
    raise exception 'A unique checkout reference is required.';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'You can buy 1 to 10 tickets at a time.'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'A valid guest name is required.'; end if;
  if p_phone is null or p_phone !~ '^256(7[0-9]{8}|111777(77[0-9]|99[0-9]|88[0-9]))$' then
    raise exception 'A valid Ugandan mobile number is required.';
  end if;
  if p_email is not null and char_length(p_email) > 0 and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid email address is required.';
  end if;

  -- Serialize retries of the same checkout before looking up its order.
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
  insert into orders (code, event_id, event_title, user_id, name, phone, email, qty, amount, status, external_ref)
  values (p_code, ev.id, ev.title, auth.uid(), trim(p_name), p_phone, lower(coalesce(p_email, '')), p_qty, amt,
    case when amt = 0 then 'SUCCEEDED' else 'PENDING' end, p_external_ref)
  returning * into r;
  return row_to_json(r);
end $$;

revoke execute on function public.create_order(uuid, text, text, text, text, integer, text) from public;
grant execute on function public.create_order(uuid, text, text, text, text, integer, text) to anon, authenticated;

-- Public settings contain ticket-delivery configuration only, never gateway credentials.
create or replace function public.storefront_settings() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'email_service_id', email_service_id,
    'email_template_id', email_template_id,
    'email_public_key', email_public_key
  ) from settings where id = 1;
$$;
revoke execute on function public.storefront_settings() from public;
grant execute on function public.storefront_settings() to anon, authenticated;

commit;
