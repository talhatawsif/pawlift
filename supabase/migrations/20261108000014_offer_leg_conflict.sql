-- 4b fix: offering an already-offered leg to a different volunteer must fail, not return null.
create or replace function public.offer_leg(p_leg_id uuid, p_volunteer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  l public.transport_legs;
  r public.transport_requests;
  existing uuid;
begin
  perform public.sweep_expired_assignments();
  select * into l from public.transport_legs where id = p_leg_id for update;
  if not found then raise exception 'Transport not found' using errcode = '42501'; end if;
  select * into r from public.transport_requests where id = l.request_id;
  if not public.is_active_coordinator(uid, r.org_id) then
    raise exception 'Transport not found' using errcode = '42501';
  end if;
  if l.status = 'offered' then
    select id into existing from public.transport_assignments
    where leg_id = p_leg_id and volunteer_id = p_volunteer_id and status = 'offered';
    if existing is not null then return existing; end if;
    raise exception 'This transport has already been offered to someone' using errcode = '55000';
  end if;
  return public.create_offer_internal(uid, p_leg_id, p_volunteer_id);
end;
$$;
revoke all on function public.offer_leg(uuid, uuid) from public, anon;
grant execute on function public.offer_leg(uuid, uuid) to authenticated;
