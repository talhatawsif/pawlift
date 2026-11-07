-- 4c: leg progress (start, pickup, delivery), completion, incidents, private-details reader,
-- and the read functions the volunteer and coordinator screens need.
-- Single-leg requests only; relay legs are refused until Batch 5.
-- Lock order as before: leg row, then assignment row.

-- ---------------------------------------------------------------- helpers

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
  if (select count(*) from public.transport_legs where request_id = rr.id and status <> 'cancelled') > 1 then
    raise exception 'Multi-driver relays are not available yet' using errcode = '55000';
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
  update public.transport_requests set status = 'en_route', version = version + 1, updated_at = now() where id = r.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'leg.start', 'leg', l.id, r.org_id, jsonb_build_object('request_id', r.id, 'leg_id', l.id));
  perform public.notify_coordinators(r.org_id, 'leg_started', r.id, l.id, 'started:' || l.id, null);
end;
$$;

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
  note_ text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if char_length(coalesce(note_, '')) > 500 then raise exception 'Note too long' using errcode = '22023'; end if;
  perform public.progress_lock_internal(uid, p_assignment_id);
  select * into a from public.transport_assignments where id = p_assignment_id;
  select * into l from public.transport_legs where id = a.leg_id;
  select * into r from public.transport_requests where id = l.request_id;
  if l.status <> 'en_route' then raise exception 'Start the trip before confirming pickup' using errcode = '55000'; end if;
  update public.transport_legs set status = 'collected', collected_at = now(), version = version + 1, updated_at = now()
  where id = l.id;
  update public.transport_requests set status = 'collected', version = version + 1, updated_at = now() where id = r.id;
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
  update public.transport_requests set status = 'delivered', version = version + 1, updated_at = now() where id = r.id;
  insert into public.handover_confirmations (leg_id, role, confirmed_by, outcome, note)
  values (l.id, 'giver', uid, 'ok', note_);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'leg.delivery', 'leg', l.id, r.org_id, note_, jsonb_build_object('request_id', r.id, 'leg_id', l.id));
  perform public.notify_coordinators(r.org_id, 'leg_delivered', r.id, l.id, 'delivered:' || l.id, null);
end;
$$;

-- ---------------------------------------------------------------- completion

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
  insert into public.handover_confirmations (leg_id, role, confirmed_by, on_behalf_of, outcome, note)
  values (lid, 'receiver', uid, uid, 'ok', note_);
  update public.transport_requests set status = 'completed', completed_at = now(), version = version + 1, updated_at = now()
  where id = r.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'request.complete', 'request', r.id, r.org_id, note_, jsonb_build_object('request_id', r.id));
end;
$$;

-- ---------------------------------------------------------------- incidents

create or replace function public.report_incident(
  p_request_id uuid, p_leg_id uuid, p_type text, p_severity text, p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  desc_ text := nullif(btrim(coalesce(p_description, '')), '');
  inc uuid;
begin
  if p_type is null or p_type not in ('delay','animal_welfare','vehicle','no_show','other') then
    raise exception 'Choose what happened' using errcode = '22023';
  end if;
  if p_severity is null or p_severity not in ('low','high') then
    raise exception 'Choose how serious it is' using errcode = '22023';
  end if;
  if char_length(coalesce(desc_, '')) < 3 or char_length(desc_) > 1000 then
    raise exception 'Describe what happened (3 to 1000 characters)' using errcode = '22023';
  end if;
  select * into r from public.transport_requests where id = p_request_id;
  if not found then raise exception 'Request not found' using errcode = '42501'; end if;
  if p_leg_id is not null and not exists (select 1 from public.transport_legs where id = p_leg_id and request_id = r.id) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if not (
    public.is_active_coordinator(uid, r.org_id)
    or exists (
      select 1 from public.transport_assignments a
      join public.transport_legs l on l.id = a.leg_id
      where l.request_id = r.id and a.volunteer_id = uid and a.status in ('confirmed','completed')
    )
  ) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  insert into public.incidents (request_id, leg_id, raised_by, type, severity, description)
  values (r.id, p_leg_id, uid, p_type, p_severity, desc_) returning id into inc;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'incident.report', 'incident', inc, r.org_id,
    jsonb_build_object('request_id', r.id, 'leg_id', p_leg_id, 'type', p_type, 'severity', p_severity));
  perform public.notify_coordinators(r.org_id, 'incident', r.id, p_leg_id, 'incident:' || inc, uid);
  return inc;
end;
$$;

create or replace function public.resolve_incident(p_incident_id uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  i public.incidents;
  r public.transport_requests;
  res text := nullif(btrim(coalesce(p_resolution, '')), '');
begin
  if char_length(coalesce(res, '')) < 3 or char_length(res) > 1000 then
    raise exception 'Say how it was resolved' using errcode = '22023';
  end if;
  select * into i from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode = '42501'; end if;
  select * into r from public.transport_requests where id = i.request_id;
  if not public.is_active_coordinator(uid, r.org_id) then raise exception 'Incident not found' using errcode = '42501'; end if;
  if i.status = 'resolved' then raise exception 'Already resolved' using errcode = '55000'; end if;
  update public.incidents set status = 'resolved', resolution = res, resolved_by = uid, resolved_at = now(), updated_at = now()
  where id = i.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'incident.resolve', 'incident', i.id, r.org_id, res, jsonb_build_object('request_id', r.id));
end;
$$;

-- ---------------------------------------------------------------- private details reader

-- Exact addresses, contacts, instructions and medical notes for the caller's own leg.
-- Checked on every call: confirmed assignment, leg confirmed / en_route / collected (not yet delivered).
create or replace function public.get_leg_private_details(p_leg_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  l public.transport_legs;
  r public.transport_requests;
begin
  if uid is null or (select account_status from public.profiles where id = uid) is distinct from 'active' then
    raise exception 'You no longer have access to these details' using errcode = '42501';
  end if;
  select * into l from public.transport_legs where id = p_leg_id;
  if not found or l.status not in ('confirmed','en_route','collected')
     or not exists (
       select 1 from public.transport_assignments a
       where a.leg_id = l.id and a.volunteer_id = uid and a.status = 'confirmed'
     ) then
    raise exception 'You no longer have access to these details' using errcode = '42501';
  end if;
  select * into r from public.transport_requests where id = l.request_id;
  return (
    select jsonb_build_object(
      'animal_name', r.animal_name, 'species', r.species,
      'handling_requirements', r.handling_requirements, 'carrier_requirements', r.carrier_requirements,
      'medical_notes', rp.medical_notes, 'coordinator_instructions', rp.coordinator_instructions,
      'pickup', jsonb_build_object(
        'label', lf.label_public, 'suburb', sf.name, 'address', pf.exact_address,
        'contact_name', pf.contact_name, 'contact_phone', pf.contact_phone, 'instructions', pf.instructions,
        'lat', st_y(pf.exact_point::geometry), 'lng', st_x(pf.exact_point::geometry)),
      'dropoff', jsonb_build_object(
        'label', lt.label_public, 'suburb', st_.name, 'address', pt.exact_address,
        'contact_name', pt.contact_name, 'contact_phone', pt.contact_phone, 'instructions', pt.instructions,
        'lat', st_y(pt.exact_point::geometry), 'lng', st_x(pt.exact_point::geometry))
    )
    from public.request_private rp
    join public.locations lf on lf.id = l.from_location_id
    join public.suburbs sf on sf.id = lf.suburb_id
    left join public.location_private pf on pf.location_id = lf.id
    join public.locations lt on lt.id = l.to_location_id
    join public.suburbs st_ on st_.id = lt.suburb_id
    left join public.location_private pt on pt.location_id = lt.id
    where rp.request_id = r.id
  );
end;
$$;

-- ---------------------------------------------------------------- volunteer reads (no private fields)

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
        l.id as leg_id, l.status as leg_status, l.window_start, l.window_end,
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

-- Card-level detail for the claim screen. Visible when the request is open (and demo flags match),
-- or the caller has an assignment on it, or is a coordinator of the owning org.
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
  elsif l.window_start <= now() then
    block := 'The pickup window has already started. Ask the coordinator.';
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

-- ---------------------------------------------------------------- coordinator reads

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
    select jsonb_agg(row_to_json(t) order by t.window_start) from (
      select r.id as request_id, r.reference, r.animal_name, r.species, r.urgency, r.status as request_status,
        r.is_demo, r.completed_at,
        l.id as leg_id, l.seq, l.status as leg_status, l.window_start, l.window_end,
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

create or replace function public.list_org_incidents(p_org_id uuid)
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
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select i.id, i.request_id, r.reference, r.animal_name, i.type, i.severity, i.description,
        i.status, i.resolution, i.created_at, p.display_name as raised_by_name
      from public.incidents i
      join public.transport_requests r on r.id = i.request_id
      left join public.profiles p on p.id = i.raised_by
      where r.org_id = p_org_id and (i.status <> 'resolved' or i.resolved_at > now() - interval '7 days')
      limit 50
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_org_audit(p_org_id uuid, p_request_id uuid default null, p_limit integer default 100)
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
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select g.id, g.action, g.entity_type, g.entity_id, g.created_at, g.reason,
        p.display_name as actor_name,
        g.after ->> 'request_id' as request_id
      from public.audit_logs g
      left join public.profiles p on p.id = g.actor_id
      where g.org_id = p_org_id
        and (p_request_id is null or g.after ->> 'request_id' = p_request_id::text or g.entity_id = p_request_id)
      order by g.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 200)
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- grants

do $$
declare f text;
begin
  foreach f in array array[
    'start_leg(uuid)', 'confirm_pickup(uuid, text)', 'confirm_delivery(uuid, text)',
    'complete_request(uuid, text)', 'report_incident(uuid, uuid, text, text, text)',
    'resolve_incident(uuid, text)', 'get_leg_private_details(uuid)', 'list_my_assignments()',
    'get_request_detail(uuid)', 'list_org_assignments(uuid)', 'list_org_incidents(uuid)',
    'list_org_audit(uuid, uuid, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
