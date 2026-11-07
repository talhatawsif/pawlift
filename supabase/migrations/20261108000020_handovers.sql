-- 5b: relay handovers. Multi-driver requests can be driven; each handover between legs is recorded
-- (giver at delivery, receiver at the next pickup); a receiver can dispute, which opens a high-severity
-- incident and blocks downstream legs until a coordinator resolves it; the final leg's receipt has its own RPC.
-- Lock order as before: leg row, then assignment row.

-- ---------------------------------------------------------------- helpers

-- Derives the request status once driving has started. Open / assigned / confirmed stay with refresh_request_status.
create or replace function public.refresh_progress_status(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  nxt text;
  first_status text;
begin
  select status into first_status from public.transport_legs
    where request_id = p_request_id and status <> 'cancelled' order by seq limit 1;
  if first_status is null then return; end if;
  if not exists (select 1 from public.transport_legs where request_id = p_request_id and status not in ('delivered','cancelled')) then
    nxt := 'delivered';
  elsif first_status in ('collected','delivered') then
    nxt := 'collected';
  elsif exists (select 1 from public.transport_legs where request_id = p_request_id and status in ('en_route','collected')) then
    nxt := 'en_route';
  else
    return;
  end if;
  update public.transport_requests set status = nxt, version = version + 1, updated_at = now()
  where id = p_request_id and status <> nxt and status in ('confirmed','en_route','collected','delivered');
end;
$$;
revoke all on function public.refresh_progress_status(uuid) from public, anon, authenticated;

-- Loads and locks the caller's confirmed assignment, its leg and request. Raises a plain error otherwise.
create or replace function public.progress_lock_internal(p_uid uuid, p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aa public.transport_assignments;
  ll public.transport_legs;
  rr public.transport_requests;
begin
  perform public.sweep_expired_assignments();
  select * into aa from public.transport_assignments where id = p_assignment_id;
  if not found or aa.volunteer_id <> p_uid then raise exception 'Assignment not found' using errcode = '42501'; end if;
  select * into ll from public.transport_legs where id = aa.leg_id for update;
  select * into rr from public.transport_requests where id = ll.request_id for update;
  select * into aa from public.transport_assignments where id = p_assignment_id for update;
  if aa.status <> 'confirmed' then
    raise exception 'This assignment is not confirmed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.incidents i
    join public.transport_legs dl on dl.id = i.leg_id
    where i.request_id = rr.id and i.type = 'handover_dispute' and i.status <> 'resolved' and dl.seq < ll.seq
  ) then
    raise exception 'A handover is being reviewed by the coordinator' using errcode = '55000';
  end if;
end;
$$;
revoke all on function public.progress_lock_internal(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- start / pickup / delivery

create or replace function public.start_leg(p_assignment_id uuid)
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
begin
  perform public.progress_lock_internal(uid, p_assignment_id);
  select * into a from public.transport_assignments where id = p_assignment_id;
  select * into l from public.transport_legs where id = a.leg_id;
  select * into r from public.transport_requests where id = l.request_id;
  if l.status <> 'confirmed' then raise exception 'This trip has already started' using errcode = '55000'; end if;
  if now() < l.window_start - interval '3 hours' then
    raise exception 'You can start up to 3 hours before the pickup window' using errcode = '55000';
  end if;
  update public.transport_legs set status = 'en_route', started_at = now(), version = version + 1, updated_at = now()
  where id = l.id;
  perform public.refresh_progress_status(r.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'leg.start', 'leg', l.id, r.org_id, jsonb_build_object('request_id', r.id, 'leg_id', l.id));
  perform public.notify_coordinators(r.org_id, 'leg_started', r.id, l.id, 'started:' || l.id, null);
end;
$$;

-- Later legs: the previous leg must be delivered; this also records the previous handover's receiver confirmation.
create or replace function public.confirm_pickup(p_assignment_id uuid, p_note text)
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
  prev public.transport_legs;
  note_ text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if char_length(coalesce(note_, '')) > 500 then raise exception 'Note too long' using errcode = '22023'; end if;
  perform public.progress_lock_internal(uid, p_assignment_id);
  select * into a from public.transport_assignments where id = p_assignment_id;
  select * into l from public.transport_legs where id = a.leg_id;
  select * into r from public.transport_requests where id = l.request_id;
  if l.status <> 'en_route' then raise exception 'Start the trip before confirming pickup' using errcode = '55000'; end if;
  select * into prev from public.transport_legs
    where request_id = r.id and status <> 'cancelled' and seq < l.seq order by seq desc limit 1;
  if found then
    if prev.status <> 'delivered' then
      raise exception 'Wait for the previous driver to hand over the animal' using errcode = '55000';
    end if;
    insert into public.handover_confirmations (leg_id, role, confirmed_by, outcome, note)
    values (prev.id, 'receiver', uid, 'ok', note_)
    on conflict (leg_id, role) do update
      set confirmed_by = excluded.confirmed_by, on_behalf_of = null, confirmed_at = now(),
          outcome = 'ok', note = excluded.note, updated_at = now();
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
    values (uid, 'handover.receive', 'leg', prev.id, r.org_id, note_,
      jsonb_build_object('request_id', r.id, 'leg_id', prev.id, 'next_leg_id', l.id));
  end if;
  update public.transport_legs set status = 'collected', collected_at = now(), version = version + 1, updated_at = now()
  where id = l.id;
  perform public.refresh_progress_status(r.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'leg.pickup', 'leg', l.id, r.org_id, note_, jsonb_build_object('request_id', r.id, 'leg_id', l.id));
  perform public.notify_coordinators(r.org_id, 'leg_collected', r.id, l.id, 'collected:' || l.id, null);
end;
$$;

create or replace function public.confirm_delivery(p_assignment_id uuid, p_note text)
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
  note_ text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if char_length(coalesce(note_, '')) > 500 then raise exception 'Note too long' using errcode = '22023'; end if;
  perform public.progress_lock_internal(uid, p_assignment_id);
  select * into a from public.transport_assignments where id = p_assignment_id;
  select * into l from public.transport_legs where id = a.leg_id;
  select * into r from public.transport_requests where id = l.request_id;
  if l.status <> 'collected' then raise exception 'Confirm pickup before delivery' using errcode = '55000'; end if;
  update public.transport_legs set status = 'delivered', delivered_at = now(), version = version + 1, updated_at = now()
  where id = l.id;
  update public.transport_assignments set status = 'completed', ended_at = now(), end_reason = 'delivered', updated_at = now()
  where id = a.id;
  perform public.refresh_progress_status(r.id);
  insert into public.handover_confirmations (leg_id, role, confirmed_by, outcome, note)
  values (l.id, 'giver', uid, 'ok', note_);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'leg.delivery', 'leg', l.id, r.org_id, note_, jsonb_build_object('request_id', r.id, 'leg_id', l.id));
  perform public.notify_coordinators(r.org_id, 'leg_delivered', r.id, l.id, 'delivered:' || l.id, null);
end;
$$;

-- ---------------------------------------------------------------- disputes and receipt

-- The next driver says the handover from the previous leg is not right. Opens a high-severity incident.
create or replace function public.dispute_handover(p_assignment_id uuid, p_description text)
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
  prev public.transport_legs;
  desc_ text := nullif(btrim(coalesce(p_description, '')), '');
  inc uuid;
begin
  if char_length(coalesce(desc_, '')) < 3 or char_length(desc_) > 1000 then
    raise exception 'Describe what is not right (3 to 1000 characters)' using errcode = '22023';
  end if;
  perform public.progress_lock_internal(uid, p_assignment_id);
  select * into a from public.transport_assignments where id = p_assignment_id;
  select * into l from public.transport_legs where id = a.leg_id;
  select * into r from public.transport_requests where id = l.request_id;
  if l.status <> 'en_route' then raise exception 'You can raise this once your trip has started' using errcode = '55000'; end if;
  select * into prev from public.transport_legs
    where request_id = r.id and status <> 'cancelled' and seq < l.seq order by seq desc limit 1;
  if not found then raise exception 'There is no earlier handover on this trip' using errcode = '55000'; end if;
  if prev.status <> 'delivered' then
    raise exception 'Wait for the previous driver to hand over the animal' using errcode = '55000';
  end if;
  insert into public.handover_confirmations (leg_id, role, confirmed_by, outcome, note)
  values (prev.id, 'receiver', uid, 'disputed', desc_)
  on conflict (leg_id, role) do update
    set confirmed_by = excluded.confirmed_by, on_behalf_of = null, confirmed_at = now(),
        outcome = 'disputed', note = excluded.note, updated_at = now();
  insert into public.incidents (request_id, leg_id, raised_by, type, severity, description)
  values (r.id, prev.id, uid, 'handover_dispute', 'high', desc_) returning id into inc;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'handover.dispute', 'incident', inc, r.org_id, desc_,
    jsonb_build_object('request_id', r.id, 'leg_id', prev.id, 'next_leg_id', l.id));
  perform public.notify_coordinators(r.org_id, 'handover_disputed', r.id, prev.id, 'dispute:' || inc, uid);
  return inc;
end;
$$;

-- Final-leg receipt. Coordinator of the owning org (on their behalf) or an approved foster carer at the destination.
create or replace function public.confirm_receipt(p_request_id uuid, p_outcome text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  last_leg public.transport_legs;
  as_coord boolean;
  as_foster boolean;
  note_ text := nullif(btrim(coalesce(p_note, '')), '');
  inc uuid;
begin
  if p_outcome is null or p_outcome not in ('ok','disputed') then
    raise exception 'Choose whether the animal arrived safely' using errcode = '22023';
  end if;
  if char_length(coalesce(note_, '')) > 1000 then raise exception 'Note too long' using errcode = '22023'; end if;
  if p_outcome = 'disputed' and char_length(coalesce(note_, '')) < 3 then
    raise exception 'Describe what is not right (3 to 1000 characters)' using errcode = '22023';
  end if;
  perform public.sweep_expired_assignments();
  select * into r from public.transport_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode = '42501'; end if;
  as_coord := public.is_active_coordinator(uid, r.org_id);
  as_foster := exists (
    select 1 from public.organisation_members m
    join public.locations d on d.id = r.destination_location_id
    where m.org_id = r.org_id and m.user_id = uid and m.status = 'active'
      and m.is_foster_carer and m.foster_approved_at is not null and m.foster_can_confirm_receipt
      and d.kind = 'foster_home' and d.linked_user_id = uid
  );
  if not (as_coord or as_foster) then raise exception 'Request not found' using errcode = '42501'; end if;
  if r.status <> 'delivered' then raise exception 'The animal has not been delivered yet' using errcode = '55000'; end if;
  select * into last_leg from public.transport_legs where request_id = r.id and status = 'delivered' order by seq desc limit 1;
  if exists (select 1 from public.incidents where request_id = r.id and type = 'handover_dispute' and status <> 'resolved') then
    raise exception 'Resolve the open handover problem first' using errcode = '55000';
  end if;
  insert into public.handover_confirmations (leg_id, role, confirmed_by, on_behalf_of, outcome, note)
  values (last_leg.id, 'receiver', uid, case when as_foster then null else uid end, p_outcome, note_)
  on conflict (leg_id, role) do update
    set confirmed_by = excluded.confirmed_by, on_behalf_of = excluded.on_behalf_of, confirmed_at = now(),
        outcome = excluded.outcome, note = excluded.note, updated_at = now();
  if p_outcome = 'disputed' then
    insert into public.incidents (request_id, leg_id, raised_by, type, severity, description)
    values (r.id, last_leg.id, uid, 'handover_dispute', 'high', note_) returning id into inc;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
    values (uid, 'receipt.dispute', 'incident', inc, r.org_id, note_, jsonb_build_object('request_id', r.id, 'leg_id', last_leg.id));
    perform public.notify_coordinators(r.org_id, 'handover_disputed', r.id, last_leg.id, 'dispute:' || inc, uid);
  else
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
    values (uid, 'receipt.confirm', 'request', r.id, r.org_id, note_,
      jsonb_build_object('request_id', r.id, 'leg_id', last_leg.id, 'by_foster', as_foster));
  end if;
end;
$$;

-- ---------------------------------------------------------------- completion

-- Unchanged rules (delivered, no open high incident); the receiver row is now insert-if-missing and
-- a disputed receipt blocks completion until it is re-confirmed.
create or replace function public.complete_request(p_request_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  lid uuid;
  note_ text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if char_length(coalesce(note_, '')) > 500 then raise exception 'Note too long' using errcode = '22023'; end if;
  perform public.sweep_expired_assignments();
  select * into r from public.transport_requests where id = p_request_id for update;
  if not found or not public.is_active_coordinator(uid, r.org_id) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if r.status <> 'delivered' then raise exception 'Only delivered transports can be completed' using errcode = '55000'; end if;
  if exists (select 1 from public.incidents where request_id = r.id and severity = 'high' and status <> 'resolved') then
    raise exception 'Resolve the open high-severity incident first' using errcode = '55000';
  end if;
  select id into lid from public.transport_legs where request_id = r.id and status = 'delivered' order by seq desc limit 1;
  if exists (select 1 from public.handover_confirmations where leg_id = lid and role = 'receiver' and outcome = 'disputed') then
    raise exception 'Confirm the animal arrived safely first' using errcode = '55000';
  end if;
  insert into public.handover_confirmations (leg_id, role, confirmed_by, on_behalf_of, outcome, note)
  values (lid, 'receiver', uid, uid, 'ok', note_)
  on conflict (leg_id, role) do nothing;
  update public.transport_requests set status = 'completed', completed_at = now(), version = version + 1, updated_at = now()
  where id = r.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'request.complete', 'request', r.id, r.org_id, note_, jsonb_build_object('request_id', r.id));
end;
$$;

-- ---------------------------------------------------------------- reads

create or replace function public.list_my_assignments()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select a.id as assignment_id, a.status as assignment_status, a.kind, a.created_at,
        a.reserved_until, a.offer_expires_at,
        l.id as leg_id, l.status as leg_status, l.window_start, l.window_end, l.seq,
        (select count(*) from public.transport_legs x where x.request_id = r.id and x.status <> 'cancelled') as leg_count,
        (select x.status from public.transport_legs x
          where x.request_id = r.id and x.status <> 'cancelled' and x.seq < l.seq order by x.seq desc limit 1) as previous_leg_status,
        exists (
          select 1 from public.incidents i join public.transport_legs dl on dl.id = i.leg_id
          where i.request_id = r.id and i.type = 'handover_dispute' and i.status <> 'resolved' and dl.seq < l.seq
        ) as handover_blocked,
        r.id as request_id, r.reference, r.animal_name, r.species, r.photo_path, r.urgency,
        r.status as request_status, r.is_demo, o.name as org_name,
        so.name as origin_suburb, sd.name as destination_suburb
      from public.transport_assignments a
      join public.transport_legs l on l.id = a.leg_id
      join public.transport_requests r on r.id = l.request_id
      join public.organisations o on o.id = r.org_id
      join public.locations lo on lo.id = l.from_location_id
      join public.suburbs so on so.id = lo.suburb_id
      join public.locations ld on ld.id = l.to_location_id
      join public.suburbs sd on sd.id = ld.suburb_id
      where a.volunteer_id = uid
      order by a.created_at desc
      limit 50
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_org_assignments(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_active_coordinator(uid, p_org_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.window_start, t.seq) from (
      select r.id as request_id, r.reference, r.animal_name, r.species, r.urgency, r.status as request_status,
        r.is_demo, r.completed_at,
        l.id as leg_id, l.seq, l.status as leg_status, l.window_start, l.window_end,
        not exists (select 1 from public.transport_legs x where x.request_id = r.id and x.status <> 'cancelled' and x.seq > l.seq) as is_last_leg,
        (select h.outcome from public.handover_confirmations h where h.leg_id = l.id and h.role = 'receiver') as receiver_outcome,
        a.id as assignment_id, a.status as assignment_status, a.reserved_until, a.offer_expires_at,
        a.volunteer_id, p.display_name as volunteer_name,
        so.name as origin_suburb, sd.name as destination_suburb,
        (select count(*) from public.incidents i where i.request_id = r.id and i.status <> 'resolved') as open_incidents
      from public.transport_requests r
      join public.transport_legs l on l.request_id = r.id and l.status <> 'cancelled'
      left join public.transport_assignments a on a.leg_id = l.id and a.status in ('offered','reserved','confirmed')
      left join public.profiles p on p.id = a.volunteer_id
      join public.locations lo on lo.id = l.from_location_id
      join public.suburbs so on so.id = lo.suburb_id
      join public.locations ld on ld.id = l.to_location_id
      join public.suburbs sd on sd.id = ld.suburb_id
      where r.org_id = p_org_id
        and (r.status in ('open','assigned','confirmed','en_route','collected','delivered')
             or (r.status = 'completed' and r.completed_at > now() - interval '30 days'))
    ) t
  ), '[]'::jsonb);
end;
$$;

-- Claim screen: show the leg the caller holds, else the first leg still open or offered (so later legs of a
-- relay can be claimed once earlier ones are filled), else the first live leg.
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
  select * into l from public.transport_legs x
    where x.request_id = r.id and x.status <> 'cancelled'
    order by
      (exists (select 1 from public.transport_assignments a
               where a.leg_id = x.id and a.volunteer_id = uid and a.status in ('offered','reserved','confirmed'))) desc,
      (x.status in ('open','offered')) desc,
      x.seq
    limit 1;
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

-- ---------------------------------------------------------------- grants

do $$
declare f text;
begin
  foreach f in array array[
    'start_leg(uuid)', 'confirm_pickup(uuid, text)', 'confirm_delivery(uuid, text)',
    'dispute_handover(uuid, text)', 'confirm_receipt(uuid, text, text)', 'complete_request(uuid, text)',
    'list_my_assignments()', 'list_org_assignments(uuid)', 'get_request_detail(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
