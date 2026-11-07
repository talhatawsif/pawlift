-- 4b fix: offers need a non-null idempotency_key (column is NOT NULL). Server-generated.

-- Creates an offer. Caller must already hold the leg lock and have checked that the actor is a coordinator.
create or replace function public.create_offer_internal(p_actor uuid, p_leg_id uuid, p_volunteer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.transport_legs;
  r public.transport_requests;
  why text;
  existing uuid;
  new_id uuid;
  expires timestamptz;
begin
  select * into l from public.transport_legs where id = p_leg_id;
  select * into r from public.transport_requests where id = l.request_id;
  if r.status <> 'open' or l.status <> 'open' then
    raise exception 'This transport is no longer open' using errcode = '55000';
  end if;
  if l.window_start <= now() then
    raise exception 'The pickup window has already started' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.organisation_members m
    where m.org_id = r.org_id and m.user_id = p_volunteer_id and m.status = 'active' and m.is_volunteer
  ) then
    raise exception 'That person is not an active volunteer of your organisation' using errcode = '55000';
  end if;
  why := public.assignment_eligibility_error(p_volunteer_id, p_leg_id);
  if why is not null then raise exception '%', why using errcode = '55000'; end if;
  expires := least(now() + interval '24 hours', l.window_start - interval '1 hour');
  if expires <= now() then
    raise exception 'Too close to the pickup window to make an offer' using errcode = '55000';
  end if;

  insert into public.transport_assignments (leg_id, volunteer_id, kind, status, idempotency_key, offer_expires_at)
  values (p_leg_id, p_volunteer_id, 'offer', 'offered', 'offer:' || gen_random_uuid(), expires)
  returning id into new_id;

  update public.transport_legs set status = 'offered', version = version + 1, updated_at = now() where id = p_leg_id;
  perform public.refresh_request_status(r.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (p_actor, 'assignment.offer', 'assignment', new_id, r.org_id,
    jsonb_build_object('leg_id', p_leg_id, 'volunteer_id', p_volunteer_id, 'offer_expires_at', expires));
  perform public.notify_user(p_volunteer_id, 'offer_received', r.id, p_leg_id, 'offer:' || new_id);
  return new_id;
end;
$$;
revoke all on function public.create_offer_internal(uuid, uuid, uuid) from public, anon, authenticated;
