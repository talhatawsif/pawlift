-- 4b: offers, accept/decline, withdraw (incl. late), reassign, cancel with active assignments.
-- Same rules as 4a: security definer, explicit checks, audit in the same transaction, lock leg then assignment.

-- ---------------------------------------------------------------- internal helpers

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

  insert into public.transport_assignments (leg_id, volunteer_id, kind, status, offer_expires_at)
  values (p_leg_id, p_volunteer_id, 'offer', 'offered', expires)
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

-- Puts an ended leg back to open. A request that had started returns to a derived status first.
create or replace function public.reopen_leg_internal(p_leg_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.transport_legs;
begin
  update public.transport_legs set
    status = 'open', started_at = null, version = version + 1, updated_at = now()
  where id = p_leg_id returning * into l;
  update public.transport_requests set status = 'confirmed', version = version + 1, updated_at = now()
  where id = l.request_id and status = 'en_route';
  perform public.refresh_request_status(l.request_id);
end;
$$;
revoke all on function public.reopen_leg_internal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- offer

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
begin
  perform public.sweep_expired_assignments();
  select * into l from public.transport_legs where id = p_leg_id for update;
  if not found then raise exception 'Transport not found' using errcode = '42501'; end if;
  select * into r from public.transport_requests where id = l.request_id;
  if not public.is_active_coordinator(uid, r.org_id) then
    raise exception 'Transport not found' using errcode = '42501';
  end if;
  -- Repeating the same offer returns the existing one.
  if l.status = 'offered' then
    return (select id from public.transport_assignments
            where leg_id = p_leg_id and volunteer_id = p_volunteer_id and status = 'offered');
  end if;
  return public.create_offer_internal(uid, p_leg_id, p_volunteer_id);
end;
$$;

-- ---------------------------------------------------------------- accept / decline / withdraw offer

create or replace function public.accept_offer(p_assignment_id uuid)
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
  if not found or a.volunteer_id <> uid then raise exception 'Offer not found' using errcode = '42501'; end if;
  select * into l from public.transport_legs where id = a.leg_id for update;
  select * into r from public.transport_requests where id = l.request_id;
  select * into a from public.transport_assignments where id = p_assignment_id for update;
  if a.status <> 'offered' or a.offer_expires_at < now() then
    raise exception 'This offer is no longer open' using errcode = '55000';
  end if;
  why := public.assignment_eligibility_error(uid, a.leg_id);
  if why is not null then raise exception '%', why using errcode = '55000'; end if;

  update public.transport_assignments set
    status = 'confirmed', confirmed_by = uid, confirmed_at = now(), offer_expires_at = null, updated_at = now()
  where id = a.id;
  update public.transport_legs set status = 'confirmed', version = version + 1, updated_at = now() where id = l.id;
  perform public.refresh_request_status(r.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'assignment.accept', 'assignment', a.id, r.org_id,
    jsonb_build_object('leg_id', l.id, 'volunteer_id', uid));
  perform public.notify_coordinators(r.org_id, 'assignment_confirmed', r.id, l.id, 'confirmed:' || a.id, null);
end;
$$;

create or replace function public.decline_offer(p_assignment_id uuid, p_reason text)
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
begin
  if char_length(coalesce(reason_, '')) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  perform public.sweep_expired_assignments();
  select * into a from public.transport_assignments where id = p_assignment_id;
  if not found or a.volunteer_id <> uid then raise exception 'Offer not found' using errcode = '42501'; end if;
  select * into l from public.transport_legs where id = a.leg_id for update;
  select * into r from public.transport_requests where id = l.request_id;
  select * into a from public.transport_assignments where id = p_assignment_id for update;
  if a.status <> 'offered' then raise exception 'This offer is no longer open' using errcode = '55000'; end if;

  update public.transport_assignments set
    status = 'declined', ended_at = now(), end_reason = reason_, updated_at = now()
  where id = a.id;
  perform public.reopen_leg_internal(l.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'assignment.decline', 'assignment', a.id, r.org_id, reason_, jsonb_build_object('leg_id', l.id));
  perform public.notify_coordinators(r.org_id, 'offer_declined', r.id, l.id, 'ended:' || a.id, null);
end;
$$;

create or replace function public.withdraw_offer(p_assignment_id uuid, p_reason text)
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
begin
  if char_length(coalesce(reason_, '')) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  perform public.sweep_expired_assignments();
  select * into a from public.transport_assignments where id = p_assignment_id;
  if not found then raise exception 'Offer not found' using errcode = '42501'; end if;
  select * into l from public.transport_legs where id = a.leg_id for update;
  select * into r from public.transport_requests where id = l.request_id;
  if not public.is_active_coordinator(uid, r.org_id) then raise exception 'Offer not found' using errcode = '42501'; end if;
  select * into a from public.transport_assignments where id = p_assignment_id for update;
  if a.status <> 'offered' then raise exception 'This offer is no longer open' using errcode = '55000'; end if;

  update public.transport_assignments set
    status = 'withdrawn', ended_at = now(), end_reason = reason_, updated_at = now()
  where id = a.id;
  perform public.reopen_leg_internal(l.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'assignment.withdraw_offer', 'assignment', a.id, r.org_id, reason_, jsonb_build_object('leg_id', l.id));
  perform public.notify_user(a.volunteer_id, 'offer_withdrawn', r.id, l.id, 'ended:' || a.id);
end;
$$;

-- ---------------------------------------------------------------- volunteer withdraw

create or replace function public.withdraw(p_assignment_id uuid, p_reason text)
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
  late boolean;
  inc uuid;
begin
  if char_length(coalesce(reason_, '')) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  perform public.sweep_expired_assignments();
  select * into a from public.transport_assignments where id = p_assignment_id;
  if not found or a.volunteer_id <> uid then raise exception 'Assignment not found' using errcode = '42501'; end if;
  select * into l from public.transport_legs where id = a.leg_id for update;
  select * into r from public.transport_requests where id = l.request_id;
  select * into a from public.transport_assignments where id = p_assignment_id for update;
  if a.status not in ('reserved','confirmed') then
    raise exception 'This assignment can no longer be withdrawn' using errcode = '55000';
  end if;
  if l.status in ('collected','delivered') then
    raise exception 'The animal has been collected. Report an incident instead.' using errcode = '55000';
  end if;
  if a.status = 'confirmed' and char_length(coalesce(reason_, '')) < 3 then
    raise exception 'Give a reason for withdrawing' using errcode = '22023';
  end if;
  late := a.status = 'confirmed' and l.window_start - now() < interval '2 hours';

  update public.transport_assignments set
    status = 'withdrawn', ended_at = now(), end_reason = reason_, updated_at = now()
  where id = a.id;
  perform public.reopen_leg_internal(l.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'assignment.withdraw', 'assignment', a.id, r.org_id, reason_,
    jsonb_build_object('leg_id', l.id, 'late', late));

  if late then
    insert into public.incidents (request_id, leg_id, raised_by, type, severity, description)
    values (r.id, l.id, uid, 'late_withdrawal', 'high', coalesce(reason_, 'Volunteer withdrew close to the pickup window'))
    returning id into inc;
    perform public.notify_coordinators(r.org_id, 'incident', r.id, l.id, 'incident:' || inc, null);
  else
    perform public.notify_coordinators(r.org_id, 'assignment_withdrawn', r.id, l.id, 'ended:' || a.id, null);
  end if;
end;
$$;

-- ---------------------------------------------------------------- reassign

create or replace function public.reassign(p_assignment_id uuid, p_reason text, p_new_volunteer_id uuid default null)
returns uuid
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
  new_offer uuid;
begin
  if char_length(coalesce(reason_, '')) not between 3 and 500 then
    raise exception 'Give a reason for reassigning' using errcode = '22023';
  end if;
  perform public.sweep_expired_assignments();
  select * into a from public.transport_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found' using errcode = '42501'; end if;
  select * into l from public.transport_legs where id = a.leg_id for update;
  select * into r from public.transport_requests where id = l.request_id;
  if not public.is_active_coordinator(uid, r.org_id) then raise exception 'Assignment not found' using errcode = '42501'; end if;
  select * into a from public.transport_assignments where id = p_assignment_id for update;
  if a.status not in ('reserved','confirmed') then
    raise exception 'This assignment cannot be reassigned' using errcode = '55000';
  end if;
  if l.status in ('collected','delivered') then
    raise exception 'The animal has been collected. Use an incident instead.' using errcode = '55000';
  end if;
  if p_new_volunteer_id = a.volunteer_id then
    raise exception 'Choose a different volunteer' using errcode = '22023';
  end if;

  update public.transport_assignments set
    status = 'reassigned', ended_at = now(), end_reason = reason_, updated_at = now()
  where id = a.id;
  perform public.reopen_leg_internal(l.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'assignment.reassign', 'assignment', a.id, r.org_id, reason_,
    jsonb_build_object('leg_id', l.id, 'volunteer_id', a.volunteer_id, 'new_volunteer_id', p_new_volunteer_id));
  perform public.notify_user(a.volunteer_id, 'reassigned', r.id, l.id, 'ended:' || a.id);

  if p_new_volunteer_id is not null then
    new_offer := public.create_offer_internal(uid, l.id, p_new_volunteer_id);
  end if;
  return new_offer;
end;
$$;

-- ---------------------------------------------------------------- cancel (replaces 4a-era version from 000007)

create or replace function public.cancel_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
  a record;
begin
  if char_length(coalesce(reason_, '')) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  perform public.sweep_expired_assignments();
  select * into r from public.transport_requests where id = p_request_id for update;
  if not found or not public.is_active_coordinator(uid, r.org_id) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if r.status not in ('draft','open','assigned','confirmed','en_route') then
    raise exception 'This request cannot be cancelled here' using errcode = '55000';
  end if;
  perform 1 from public.transport_legs where request_id = r.id order by seq for update;
  if exists (select 1 from public.transport_legs where request_id = r.id and status in ('collected','delivered')) then
    raise exception 'The animal has been collected. Use an incident instead.' using errcode = '55000';
  end if;
  if r.status <> 'draft' and char_length(coalesce(reason_, '')) < 3 then
    raise exception 'Give a reason for cancelling a published request' using errcode = '22023';
  end if;

  for a in
    select x.id, x.volunteer_id, x.leg_id from public.transport_assignments x
    join public.transport_legs l on l.id = x.leg_id
    where l.request_id = r.id and x.status in ('offered','reserved','confirmed')
    for update of x
  loop
    update public.transport_assignments set
      status = 'cancelled', ended_at = now(), end_reason = reason_, updated_at = now()
    where id = a.id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
    values (uid, 'assignment.cancel', 'assignment', a.id, r.org_id, reason_, jsonb_build_object('leg_id', a.leg_id));
    perform public.notify_user(a.volunteer_id, 'cancelled', r.id, a.leg_id, 'ended:' || a.id);
  end loop;

  update public.transport_requests set
    status = 'cancelled', cancelled_at = now(), cancel_reason = reason_, version = version + 1, updated_at = now()
  where id = r.id;
  update public.transport_legs set status = 'cancelled', cancelled_at = now(), version = version + 1, updated_at = now()
  where request_id = r.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason)
  values (uid, 'request.cancel', 'request', r.id, r.org_id, reason_);
end;
$$;

-- ---------------------------------------------------------------- grants
revoke all on function public.offer_leg(uuid, uuid) from public, anon;
revoke all on function public.accept_offer(uuid) from public, anon;
revoke all on function public.decline_offer(uuid, text) from public, anon;
revoke all on function public.withdraw_offer(uuid, text) from public, anon;
revoke all on function public.withdraw(uuid, text) from public, anon;
revoke all on function public.reassign(uuid, text, uuid) from public, anon;
revoke all on function public.cancel_request(uuid, text) from public, anon;
grant execute on function public.offer_leg(uuid, uuid) to authenticated;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.decline_offer(uuid, text) to authenticated;
grant execute on function public.withdraw_offer(uuid, text) to authenticated;
grant execute on function public.withdraw(uuid, text) to authenticated;
grant execute on function public.reassign(uuid, text, uuid) to authenticated;
grant execute on function public.cancel_request(uuid, text) to authenticated;
