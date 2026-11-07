-- 4a: claim, confirm, release, expiry sweep for transport assignments.
-- All state changes go through security-definer RPCs that audit in the same transaction.
-- Lock order everywhere: leg row first, then assignment row.

-- ---------------------------------------------------------------- helpers

-- Null when the volunteer may take the leg, otherwise a plain-English reason.
-- Does not check leg/request state (callers do). Ignores assignments on the leg itself in the overlap test.
create or replace function public.assignment_eligibility_error(p_uid uuid, p_leg_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.transport_legs;
  r public.transport_requests;
  p public.profiles;
  v public.volunteer_profiles;
begin
  select * into l from public.transport_legs where id = p_leg_id;
  if not found then return 'This transport is not available'; end if;
  select * into r from public.transport_requests where id = l.request_id;
  select * into p from public.profiles where id = p_uid;
  if not found or p.account_status <> 'active' then return 'Your account is not active'; end if;
  select * into v from public.volunteer_profiles where user_id = p_uid;
  if not found or v.verification_status <> 'verified' then
    return 'Only verified volunteers can take transports';
  end if;
  if p.is_demo is distinct from r.is_demo then return 'This transport is not available'; end if;
  if v.guidelines_version_accepted is distinct from 'v1' then
    return 'Accept the current transport guidelines first';
  end if;
  if not (r.species = any (v.species_ok)) then
    return 'Your profile does not cover this kind of animal';
  end if;
  if nullif(btrim(coalesce(r.carrier_requirements, '')), '') is not null and not v.has_carrier then
    return 'This transport needs a carrier or crate and your profile says you do not have one';
  end if;
  if exists (
    select 1 from public.transport_assignments a
    join public.transport_legs l2 on l2.id = a.leg_id
    where a.volunteer_id = p_uid
      and a.status in ('offered','reserved','confirmed')
      and a.leg_id <> p_leg_id
      and l2.window_start < l.window_end and l2.window_end > l.window_start
  ) then
    return 'You already have a transport that overlaps this window';
  end if;
  return null;
end;
$$;
revoke all on function public.assignment_eligibility_error(uuid, uuid) from public, anon, authenticated;

-- Recomputes the stored request status (open / assigned / confirmed) from its legs.
create or replace function public.refresh_request_status(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur text;
  nxt text;
begin
  select status into cur from public.transport_requests where id = p_request_id;
  if cur is null or cur not in ('open','assigned','confirmed') then return; end if;
  if exists (select 1 from public.transport_legs where request_id = p_request_id and status in ('open','offered')) then
    nxt := 'open';
  elsif exists (select 1 from public.transport_legs where request_id = p_request_id and status = 'reserved') then
    nxt := 'assigned';
  elsif exists (select 1 from public.transport_legs where request_id = p_request_id and status <> 'cancelled')
    and not exists (select 1 from public.transport_legs where request_id = p_request_id and status not in ('confirmed','cancelled')) then
    nxt := 'confirmed';
  else
    return;
  end if;
  if nxt <> cur then
    update public.transport_requests set status = nxt, version = version + 1, updated_at = now()
    where id = p_request_id;
  end if;
end;
$$;
revoke all on function public.refresh_request_status(uuid) from public, anon, authenticated;

-- Notify every active coordinator of an org. Deduped per (user, key).
create or replace function public.notify_coordinators(p_org_id uuid, p_type text, p_request_id uuid, p_leg_id uuid, p_key text, p_exclude uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, request_id, leg_id, dedupe_key, payload)
  select m.user_id, p_type, p_request_id, p_leg_id, p_key,
         jsonb_build_object('reference', (select reference from public.transport_requests where id = p_request_id))
  from public.organisation_members m
  where m.org_id = p_org_id and m.is_coordinator and m.status = 'active'
    and m.user_id is distinct from p_exclude
  on conflict (user_id, dedupe_key) do nothing;
$$;
revoke all on function public.notify_coordinators(uuid, text, uuid, uuid, text, uuid) from public, anon, authenticated;

create or replace function public.notify_user(p_user uuid, p_type text, p_request_id uuid, p_leg_id uuid, p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, request_id, leg_id, dedupe_key, payload)
  values (p_user, p_type, p_request_id, p_leg_id, p_key,
          jsonb_build_object('reference', (select reference from public.transport_requests where id = p_request_id)))
  on conflict (user_id, dedupe_key) do nothing;
$$;
revoke all on function public.notify_user(uuid, text, uuid, uuid, text) from public, anon, authenticated;

-- Expires stale reservations and offers. Called lazily by every assignment RPC; pg_cron wiring is 6a.
-- Returns how many assignments expired.
create or replace function public.sweep_expired_assignments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  n integer := 0;
  req public.transport_requests;
begin
  for a in
    select x.id, x.leg_id, x.volunteer_id, x.status, l.request_id
    from public.transport_assignments x
    join public.transport_legs l on l.id = x.leg_id
    where (x.status = 'reserved' and x.reserved_until < now())
       or (x.status = 'offered' and x.offer_expires_at < now())
    for update of x skip locked
  loop
    update public.transport_assignments set
      status = 'expired', ended_at = now(), end_reason = 'expired', updated_at = now()
    where id = a.id;
    update public.transport_legs set status = 'open', version = version + 1, updated_at = now()
    where id = a.leg_id and status in ('reserved','offered');
    perform public.refresh_request_status(a.request_id);
    select * into req from public.transport_requests where id = a.request_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
    values (null, 'assignment.expire', 'assignment', a.id, req.org_id,
      jsonb_build_object('leg_id', a.leg_id, 'was', a.status));
    perform public.notify_user(a.volunteer_id, 'assignment_expired', a.request_id, a.leg_id, 'expire:' || a.id);
    perform public.notify_coordinators(req.org_id, 'assignment_expired', a.request_id, a.leg_id, 'expire:' || a.id, null);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.sweep_expired_assignments() from public, anon, authenticated;

-- ---------------------------------------------------------------- claim

create or replace function public.claim_leg(p_leg_id uuid, p_idempotency_key text, p_journey_id uuid default null)
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
  why text;
  new_id uuid;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'Invalid request key' using errcode = '22023';
  end if;
  perform public.sweep_expired_assignments();

  select id into existing from public.transport_assignments
  where volunteer_id = uid and idempotency_key = p_idempotency_key;
  if existing is not null then return existing; end if;

  select * into l from public.transport_legs where id = p_leg_id for update;
  if not found then raise exception 'Transport not found' using errcode = '42501'; end if;
  select * into r from public.transport_requests where id = l.request_id;

  why := public.assignment_eligibility_error(uid, p_leg_id);
  if why is not null then raise exception '%', why using errcode = '55000'; end if;

  if p_journey_id is not null and not exists (select 1 from public.journeys where id = p_journey_id and user_id = uid) then
    raise exception 'Journey not found' using errcode = '42501';
  end if;
  if r.status <> 'open' or l.status <> 'open' then
    raise exception 'Someone else has just offered to take this one.' using errcode = '55000';
  end if;
  if l.window_start <= now() then
    raise exception 'The pickup window has already started. Ask the coordinator.' using errcode = '55000';
  end if;

  begin
    insert into public.transport_assignments
      (leg_id, volunteer_id, kind, status, journey_id, idempotency_key, reserved_until)
    values (p_leg_id, uid, 'claim', 'reserved', p_journey_id, p_idempotency_key,
            least(now() + interval '4 hours', l.window_start))
    returning id into new_id;
  exception when unique_violation then
    select id into existing from public.transport_assignments
    where volunteer_id = uid and idempotency_key = p_idempotency_key;
    if existing is not null then return existing; end if;
    raise exception 'Someone else has just offered to take this one.' using errcode = '55000';
  end;

  update public.transport_legs set status = 'reserved', version = version + 1, updated_at = now() where id = p_leg_id;
  perform public.refresh_request_status(r.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'assignment.claim', 'assignment', new_id, r.org_id,
    jsonb_build_object('leg_id', p_leg_id, 'request_id', r.id));
  perform public.notify_coordinators(r.org_id, 'assignment_claimed', r.id, p_leg_id, 'claimed:' || new_id, null);
  return new_id;
end;
$$;

-- ---------------------------------------------------------------- confirm

create or replace function public.confirm_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  a public.transport_assignments;
  l public.transport_legs;
  r public.transport_requests;
  why text;
begin
  perform public.sweep_expired_assignments();
  select * into a from public.transport_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found' using errcode = '42501'; end if;
  select * into l from public.transport_legs where id = a.leg_id for update;
  select * into r from public.transport_requests where id = l.request_id;
  if not public.is_active_coordinator(uid, r.org_id) then
    raise exception 'Assignment not found' using errcode = '42501';
  end if;
  select * into a from public.transport_assignments where id = p_assignment_id for update;
  if a.status <> 'reserved' or a.reserved_until < now() then
    raise exception 'This reservation is no longer active' using errcode = '55000';
  end if;
  why := public.assignment_eligibility_error(a.volunteer_id, a.leg_id);
  if why is not null then raise exception '%', why using errcode = '55000'; end if;

  update public.transport_assignments set
    status = 'confirmed', confirmed_by = uid, confirmed_at = now(), reserved_until = null, updated_at = now()
  where id = a.id;
  update public.transport_legs set status = 'confirmed', version = version + 1, updated_at = now() where id = l.id;
  perform public.refresh_request_status(r.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'assignment.confirm', 'assignment', a.id, r.org_id,
    jsonb_build_object('leg_id', l.id, 'volunteer_id', a.volunteer_id));
  perform public.notify_user(a.volunteer_id, 'assignment_confirmed', r.id, l.id, 'confirmed:' || a.id);
end;
$$;

-- ---------------------------------------------------------------- release

create or replace function public.release_assignment(p_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  a public.transport_assignments;
  l public.transport_legs;
  r public.transport_requests;
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
  is_coord boolean;
begin
  if char_length(coalesce(reason_, '')) > 500 then
    raise exception 'Reason too long' using errcode = '22023';
  end if;
  perform public.sweep_expired_assignments();
  select * into a from public.transport_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found' using errcode = '42501'; end if;
  select * into l from public.transport_legs where id = a.leg_id for update;
  select * into r from public.transport_requests where id = l.request_id;
  is_coord := public.is_active_coordinator(uid, r.org_id);
  if not is_coord and a.volunteer_id <> uid then
    raise exception 'Assignment not found' using errcode = '42501';
  end if;
  select * into a from public.transport_assignments where id = p_assignment_id for update;
  if a.status <> 'reserved' then
    raise exception 'Only a reservation can be released here' using errcode = '55000';
  end if;

  update public.transport_assignments set
    status = 'released', ended_at = now(), end_reason = reason_, updated_at = now()
  where id = a.id;
  update public.transport_legs set status = 'open', version = version + 1, updated_at = now() where id = l.id;
  perform public.refresh_request_status(r.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'assignment.release', 'assignment', a.id, r.org_id, reason_,
    jsonb_build_object('leg_id', l.id, 'by', case when a.volunteer_id = uid then 'volunteer' else 'coordinator' end));
  if a.volunteer_id = uid then
    perform public.notify_coordinators(r.org_id, 'assignment_released', r.id, l.id, 'released:' || a.id, uid);
  else
    perform public.notify_user(a.volunteer_id, 'assignment_released', r.id, l.id, 'released:' || a.id);
  end if;
end;
$$;

-- ---------------------------------------------------------------- grants
revoke all on function public.claim_leg(uuid, text, uuid) from public, anon;
revoke all on function public.confirm_assignment(uuid) from public, anon;
revoke all on function public.release_assignment(uuid, text) from public, anon;
grant execute on function public.claim_leg(uuid, text, uuid) to authenticated;
grant execute on function public.confirm_assignment(uuid) to authenticated;
grant execute on function public.release_assignment(uuid, text) to authenticated;
