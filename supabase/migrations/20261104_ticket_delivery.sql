-- Automatic ticket delivery after verified payment.
-- Additive: stores delivery state and a private PDF bucket. Does not mark payments paid.
begin;

create table if not exists public.ticket_deliveries (
  order_id uuid primary key references public.orders on delete cascade,
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  whatsapp_status text not null default 'pending' check (whatsapp_status in ('pending', 'sent', 'failed', 'skipped')),
  email_attempts integer not null default 0 check (email_attempts >= 0),
  whatsapp_attempts integer not null default 0 check (whatsapp_attempts >= 0),
  email_last_error text not null default '',
  whatsapp_last_error text not null default '',
  email_sent_at timestamptz,
  whatsapp_sent_at timestamptz,
  pdf_path text not null default '',
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ticket_deliveries_status_idx on public.ticket_deliveries (email_status, whatsapp_status);

alter table public.ticket_deliveries enable row level security;
revoke all on public.ticket_deliveries from public, anon;
grant select on public.ticket_deliveries to authenticated;
grant all on public.ticket_deliveries to service_role;

drop policy if exists "ticket deliveries admin read" on public.ticket_deliveries;
create policy "ticket deliveries admin read" on public.ticket_deliveries
  for select to authenticated using (public.is_admin());

-- Atomically claim a delivery so webhook retries do not send duplicate WhatsApp messages.
create or replace function public.claim_ticket_delivery(p_order_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_row ticket_deliveries%rowtype;
begin
  insert into ticket_deliveries (order_id) values (p_order_id)
  on conflict (order_id) do nothing;

  update ticket_deliveries
     set locked_until = now() + interval '2 minutes', updated_at = now()
   where order_id = p_order_id
     and (locked_until is null or locked_until < now())
  returning * into v_row;

  if not found then
    return null;
  end if;
  return row_to_json(v_row);
end $$;
revoke execute on function public.claim_ticket_delivery(uuid) from public, anon, authenticated;
grant execute on function public.claim_ticket_delivery(uuid) to service_role;

-- Private PDF tickets. The Edge Function uploads with the service role and sends signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tickets', 'tickets', false, 5242880, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['application/pdf'];

commit;
