-- 4c: a pickup window means "any time between start and end", so a volunteer can claim until the window ends
-- (was: refused once it started, which made seeded demo requests unclaimable). Reservations now hold until
-- least(now + 4 h, window_end). Offers keep their lead-time rule (expiry = least(24 h, window_start - 1 h)).

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
  if l.window_end <= now() then
    raise exception 'The pickup window has passed. Ask the coordinator.' using errcode = '55000';
  end if;

  begin
    insert into public.transport_assignments
      (leg_id, volunteer_id, kind, status, journey_id, idempotency_key, reserved_until)
    values (p_leg_id, uid, 'claim', 'reserved', p_journey_id, p_idempotency_key,
            least(now() + interval '4 hours', l.window_end))
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

create or replace function public.get_request_detail(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r public.transport_requests;
  l public.transport_legs;
  prof public.profiles;
  mine uuid;
  block text;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into r from public.transport_requests where id = p_request_id;
  if not found then raise exception 'Request not found' using errcode = '42501'; end if;
  select * into prof from public.profiles where id = uid;
  select * into l from public.transport_legs where request_id = r.id and status <> 'cancelled' order by seq limit 1;
  select a.id into mine from public.transport_assignments a
    where a.volunteer_id = uid and a.leg_id = l.id and a.status in ('offered','reserved','confirmed') limit 1;
  if not (
    (r.status = 'open' and r.published_at is not null and prof.is_demo is not distinct from r.is_demo)
    or mine is not null
    or public.is_active_coordinator(uid, r.org_id)
  ) then
    raise exception 'Request not found' using errcode = '42501';
  end if;

  if r.status <> 'open' or l.status <> 'open' then
    block := 'Someone else has just offered to take this one.';
  elsif l.window_end <= now() then
    block := 'The pickup window has passed. Ask the coordinator.';
  else
    block := public.assignment_eligibility_error(uid, l.id);
  end if;

  return (
    select jsonb_build_object(
      'request_id', r.id, 'reference', r.reference, 'animal_name', r.animal_name, 'species', r.species,
      'photo_path', r.photo_path, 'urgency', r.urgency, 'is_demo', r.is_demo, 'status', r.status,
      'handling_requirements', r.handling_requirements, 'carrier_requirements', r.carrier_requirements,
      'deadline', r.deadline, 'org_name', o.name, 'org_verification_status', o.verification_status,
      'leg_id', l.id, 'window_start', l.window_start, 'window_end', l.window_end,
      'origin_label', lo.label_public, 'origin_suburb', so.name,
      'destination_label', ld.label_public, 'destination_suburb', sd.name,
      'claim_block', block, 'my_assignment_id', mine
    )
    from public.organisations o
    join public.locations lo on lo.id = l.from_location_id
    join public.suburbs so on so.id = lo.suburb_id
    join public.locations ld on ld.id = l.to_location_id
    join public.suburbs sd on sd.id = ld.suburb_id
    where o.id = r.org_id
  );
end;
$$;

revoke all on function public.claim_leg(uuid, text, uuid) from public, anon;
grant execute on function public.claim_leg(uuid, text, uuid) to authenticated;
revoke all on function public.get_request_detail(uuid) from public, anon;
grant execute on function public.get_request_detail(uuid) to authenticated;
