-- create_order must remain SECURITY DEFINER: orders has RLS enabled and no direct
-- insert policy, so invoker-rights would block checkout order creation.
alter function public.create_order(uuid, text, text, text, text, integer, text)
  security definer
  set search_path = public;

revoke all on function public.create_order(uuid, text, text, text, text, integer, text) from public;
grant execute on function public.create_order(uuid, text, text, text, text, integer, text) to anon, authenticated;
