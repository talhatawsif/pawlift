-- Relays and volunteer-to-volunteer handovers are not part of the MVP (PLAN D37).
-- Undoes migrations 000019 (leg editor) and 000020 (handovers): the database now allows one leg per request,
-- relay functions are dropped, single-leg function bodies are restored (copied from their original migrations),
-- and the dead values (handover_point, handover_dispute, disputed outcome) are removed.
-- Keeps final-destination receipt confirmation (confirm_receipt, ok only).

-- ---------------------------------------------------------------- guard: refuse if relay data exists
do $$
begin
  if exists (select 1 from public.transport_legs group by request_id having count(*) > 1) then
    raise exception 'Cannot enforce one leg per request: a request has more than one leg';
  end if;
  if exists (select 1 from public.transport_legs where seq <> 1) then
    raise exception 'Cannot enforce one leg per request: a leg has seq <> 1';
  end if;
  if exists (select 1 from public.locations where kind = 'handover_point') then
    raise exception 'Handover point locations still exist';
  end if;
  if exists (select 1 from public.incidents where type = 'handover_dispute') then
    raise exception 'Handover dispute incidents still exist';
  end if;
  if exists (select 1 from public.handover_confirmations where outcome <> 'ok') then
    raise exception 'Disputed handover confirmations still exist';
  end if;
end $$;

-- ---------------------------------------------------------------- drop relay functions
drop function if exists public.split_leg(uuid, integer, integer, uuid, timestamptz, timestamptz);
drop function if exists public.merge_legs(uuid, integer, integer);
drop function if exists public.update_leg(uuid, integer, integer, timestamptz, timestamptz, uuid);
drop function if exists public.list_request_legs(uuid);
drop function if exists public.leg_edit_guard(uuid, integer);
drop function if exists public.validate_leg_chain(uuid);
drop function if exists public.dispute_handover(uuid, text);
drop function if exists public.confirm_receipt(uuid, text, text);
drop function if exists public.refresh_progress_status(uuid);

-- ---------------------------------------------------------------- database limit: one leg per request
alter table public.transport_legs drop constraint transport_legs_request_id_seq_key;
alter table public.transport_legs add constraint transport_legs_one_per_request unique (request_id);
alter table public.transport_legs add constraint transport_legs_seq_is_one check (seq = 1);

-- ---------------------------------------------------------------- remove dead values
alter table public.locations drop constraint locations_kind_check;
alter table public.locations add constraint locations_kind_check
  check (kind in ('pound','shelter','rescue_facility','vet','foster_home','other'));
alter table public.incidents drop constraint incidents_type_check;
alter table public.incidents add constraint incidents_type_check
  check (type in ('delay','animal_welfare','vehicle','late_withdrawal','no_show','other'));
alter table public.handover_confirmations drop constraint handover_confirmations_outcome_check;
alter table public.handover_confirmations add constraint handover_confirmations_outcome_check check (outcome = 'ok');

-- ---------------------------------------------------------------- single-leg function bodies (restored)
create or replace function public.create_location(
  p_org_id uuid,
  p_kind text,
  p_label_public text,
  p_suburb_id uuid,
  p_exact_address text,
  p_contact_name text,
  p_contact_phone text,
  p_instructions text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  org public.organisations;
  sub public.suburbs;
  loc_id uuid;
begin
  select * into org from public.organisations where id = p_org_id;
  if not found or not public.is_active_coordinator(uid, p_org_id) then
    raise exception 'Organisation not found' using errcode = '42501';
  end if;
  if org.verification_status <> 'verified' then
    raise exception 'Only a verified organisation can add locations' using errcode = '55000';
  end if;
  if p_kind not in ('pound','shelter','rescue_facility','vet','other') then
    raise exception 'Invalid location kind' using errcode = '22023';
  end if;
  select * into sub from public.suburbs where id = p_suburb_id;
  if not found then
    raise exception 'Choose a suburb' using errcode = '22023';
  end if;
  perform public.loc_check_text(p_label_public, p_exact_address, p_contact_name, p_contact_phone, p_instructions);
  if (select count(*) from public.locations where org_id = p_org_id) >= 50 then
    raise exception 'Too many locations' using errcode = '54000';
  end if;

  insert into public.locations (org_id, kind, label_public, suburb_id, approx_point, is_demo)
  values (p_org_id, p_kind, btrim(p_label_public), sub.id, sub.centroid, org.is_demo)
  returning id into loc_id;
  insert into public.location_private (location_id, exact_address, contact_name, contact_phone, instructions)
  values (loc_id, btrim(p_exact_address), nullif(btrim(coalesce(p_contact_name, '')), ''),
          nullif(btrim(coalesce(p_contact_phone, '')), ''), nullif(btrim(coalesce(p_instructions, '')), ''));

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'location.create', 'location', loc_id, p_org_id,
    jsonb_build_object('kind', p_kind, 'label', btrim(p_label_public), 'suburb_id', sub.id));
  return loc_id;
end;
$$;

create or replace function public.confirm_destination(p_location_id uuid, p_confirm boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  loc public.locations;
  org_status text;
begin
  select * into loc from public.locations where id = p_location_id for update;
  if not found or not public.is_active_coordinator(uid, loc.org_id) then
    raise exception 'Location not found' using errcode = '42501';
  end if;
  if p_confirm then
    select verification_status into org_status from public.organisations where id = loc.org_id;
    if org_status <> 'verified' then
      raise exception 'Organisation is not verified' using errcode = '55000';
    end if;
    if loc.kind = 'foster_home' and not exists (
      select 1 from public.organisation_members m
      where m.org_id = loc.org_id and m.user_id = loc.linked_user_id
        and m.status = 'active' and m.is_foster_carer
    ) then
      raise exception 'The foster carer is not approved' using errcode = '55000';
    end if;
  end if;
  update public.locations set
    is_confirmed_destination = p_confirm,
    confirmed_by = case when p_confirm then uid else null end,
    confirmed_at = case when p_confirm then now() else null end,
    updated_at = now()
  where id = loc.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, case when p_confirm then 'location.confirm' else 'location.unconfirm' end,
    'location', loc.id, loc.org_id, jsonb_build_object('kind', loc.kind));
end;
$$;

create or replace function public.publish_request(p_request_id uuid, p_attest boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  org public.organisations;
  leg public.transport_legs;
begin
  select * into r from public.transport_requests where id = p_request_id for update;
  if not found or not public.is_active_coordinator(uid, r.org_id) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'Only a draft can be published' using errcode = '55000';
  end if;
  select * into org from public.organisations where id = r.org_id;
  if org.verification_status <> 'verified' then
    raise exception 'Only a verified organisation can publish requests' using errcode = '55000';
  end if;
  if p_attest is distinct from true then
    raise exception 'Confirm your organisation is authorised to release and transport this animal' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.locations l
    where l.id = r.destination_location_id and l.org_id = r.org_id
      and l.is_confirmed_destination
  ) then
    raise exception 'The destination must be a confirmed destination' using errcode = '55000';
  end if;
  if r.origin_location_id is null or r.origin_location_id = r.destination_location_id then
    raise exception 'Pickup and destination are required' using errcode = '55000';
  end if;
  if coalesce(btrim(r.handling_requirements), '') = '' and coalesce(btrim(r.carrier_requirements), '') = '' then
    raise exception 'Add handling or carrier requirements before publishing' using errcode = '55000';
  end if;
  select * into leg from public.transport_legs where request_id = r.id and seq = 1;
  if not found or (select count(*) from public.transport_legs where request_id = r.id) <> 1
     or leg.from_location_id <> r.origin_location_id or leg.to_location_id <> r.destination_location_id then
    raise exception 'The leg does not match the pickup and destination' using errcode = '55000';
  end if;
  if leg.window_end <= now() then
    raise exception 'The pickup window must be in the future' using errcode = '22023';
  end if;
  if r.deadline is not null and r.deadline < leg.window_end then
    raise exception 'Delivery deadline cannot be before the end of the pickup window' using errcode = '22023';
  end if;

  update public.transport_requests set
    status = 'open', published_at = now(),
    release_authority_attested_by = uid, release_authority_attested_at = now(),
    version = version + 1, updated_at = now()
  where id = r.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'request.publish', 'request', r.id, r.org_id,
    jsonb_build_object('reference', r.reference, 'attested', true));
end;
$$;

create or replace function public.get_request_for_coordinator(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r public.transport_requests;
begin
  select * into r from public.transport_requests where id = p_request_id;
  if uid is null or not found or not public.is_active_coordinator(uid, r.org_id) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  return (
    select to_jsonb(r) - 'release_authority_attested_by' || jsonb_build_object(
      'medical_notes', p.medical_notes,
      'coordinator_instructions', p.coordinator_instructions,
      'origin_label', lo.label_public, 'origin_suburb', so.name,
      'destination_label', ld.label_public, 'destination_suburb', sd.name,
      'window_start', g.window_start, 'window_end', g.window_end, 'leg_status', g.status
    )
    from public.request_private p
    join public.transport_legs g on g.request_id = r.id and g.seq = 1
    join public.locations lo on lo.id = r.origin_location_id
    join public.suburbs so on so.id = lo.suburb_id
    join public.locations ld on ld.id = r.destination_location_id
    join public.suburbs sd on sd.id = ld.suburb_id
    where p.request_id = r.id
  );
end;
$$;

create or replace function public.update_request(
  p_request_id uuid,
  p_expected_version integer,
  p_animal_name text,
  p_species text,
  p_urgency text,
  p_required_date date,
  p_deadline timestamptz,
  p_handling text,
  p_carrier text,
  p_medical_notes text,
  p_coordinator_instructions text,
  p_origin_location_id uuid,
  p_destination_location_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  newv integer;
begin
  select * into r from public.transport_requests where id = p_request_id for update;
  if not found or not public.is_active_coordinator(uid, r.org_id) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if r.status not in ('draft','open') then
    raise exception 'This request can no longer be edited' using errcode = '55000';
  end if;
  if exists (select 1 from public.transport_legs where request_id = r.id and status <> 'open') then
    raise exception 'A volunteer is already involved; edits are not available' using errcode = '55000';
  end if;
  if r.version <> p_expected_version then
    raise exception 'This request was changed elsewhere; reload and try again' using errcode = '55006';
  end if;
  if p_species not in ('cat','dog','other') then
    raise exception 'Invalid species' using errcode = '22023';
  end if;
  if p_urgency not in ('routine','soon','urgent') then
    raise exception 'Invalid urgency' using errcode = '22023';
  end if;
  perform public.req_check_text(p_animal_name, p_handling, p_carrier, p_medical_notes, p_coordinator_instructions);
  if p_window_start is null or p_window_end is null or p_window_end <= p_window_start then
    raise exception 'Pickup window must end after it starts' using errcode = '22023';
  end if;
  if p_deadline is not null and p_deadline < p_window_end then
    raise exception 'Delivery deadline cannot be before the end of the pickup window' using errcode = '22023';
  end if;
  if p_origin_location_id is null or p_destination_location_id is null
     or p_origin_location_id = p_destination_location_id then
    raise exception 'Choose different pickup and destination locations' using errcode = '22023';
  end if;
  if (select count(*) from public.locations where id in (p_origin_location_id, p_destination_location_id) and org_id = r.org_id) <> 2 then
    raise exception 'Locations must belong to your organisation' using errcode = '22023';
  end if;
  if r.status = 'open' and not exists (
    select 1 from public.locations where id = p_destination_location_id and is_confirmed_destination
  ) then
    raise exception 'A published request needs a confirmed destination' using errcode = '55000';
  end if;
  if r.status = 'open' and p_window_end <= now() then
    raise exception 'The pickup window must be in the future' using errcode = '22023';
  end if;

  update public.transport_requests set
    animal_name = btrim(p_animal_name), species = p_species, urgency = p_urgency,
    required_date = p_required_date, deadline = p_deadline,
    handling_requirements = nullif(btrim(coalesce(p_handling, '')), ''),
    carrier_requirements = nullif(btrim(coalesce(p_carrier, '')), ''),
    origin_location_id = p_origin_location_id, destination_location_id = p_destination_location_id,
    version = version + 1, updated_at = now()
  where id = r.id returning version into newv;
  update public.request_private set
    medical_notes = nullif(btrim(coalesce(p_medical_notes, '')), ''),
    coordinator_instructions = nullif(btrim(coalesce(p_coordinator_instructions, '')), ''),
    updated_at = now()
  where request_id = r.id;
  update public.transport_legs set
    from_location_id = p_origin_location_id, to_location_id = p_destination_location_id,
    window_start = p_window_start, window_end = p_window_end,
    version = version + 1, updated_at = now()
  where request_id = r.id and seq = 1;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'request.update', 'request', r.id, r.org_id,
    jsonb_build_object('status', r.status, 'version', newv));
  return newv;
end;
$$;

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
end;
$$;

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

-- Completion: unchanged rules; the receiver row is recorded on the coordinator's behalf only if confirm_receipt has not already.
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
  values (lid, 'receiver', uid, uid, 'ok', note_)
  on conflict (leg_id, role) do nothing;
  update public.transport_requests set status = 'completed', completed_at = now(), version = version + 1, updated_at = now()
  where id = r.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'request.complete', 'request', r.id, r.org_id, note_, jsonb_build_object('request_id', r.id));
end;
$$;

-- ---------------------------------------------------------------- final-destination receipt
-- The owning organisation's coordinator (on their behalf) or an approved foster carer with the receipt right,
-- linked to the destination home, confirms the animal arrived. No incident is raised here; problems use report_incident.
create or replace function public.confirm_receipt(p_request_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  lid uuid;
  as_coord boolean;
  as_foster boolean;
  note_ text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if char_length(coalesce(note_, '')) > 500 then raise exception 'Note too long' using errcode = '22023'; end if;
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
  select id into lid from public.transport_legs where request_id = r.id and status = 'delivered';
  if exists (select 1 from public.handover_confirmations where leg_id = lid and role = 'receiver') then
    raise exception 'Arrival has already been confirmed' using errcode = '55000';
  end if;
  insert into public.handover_confirmations (leg_id, role, confirmed_by, on_behalf_of, outcome, note)
  values (lid, 'receiver', uid, case when as_foster then null else uid end, 'ok', note_);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'receipt.confirm', 'request', r.id, r.org_id, note_,
    jsonb_build_object('request_id', r.id, 'leg_id', lid, 'by_foster', as_foster));
end;
$$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array[
    'create_location(uuid, text, text, uuid, text, text, text, text)',
    'confirm_destination(uuid, boolean)',
    'publish_request(uuid, boolean)',
    'get_request_for_coordinator(uuid)',
    'update_request(uuid,integer,text,text,text,date,timestamptz,text,text,text,text,uuid,uuid,timestamptz,timestamptz)',
    'start_leg(uuid)', 'confirm_pickup(uuid, text)', 'confirm_delivery(uuid, text)',
    'complete_request(uuid, text)', 'confirm_receipt(uuid, text)',
    'list_my_assignments()', 'list_org_assignments(uuid)', 'get_request_detail(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
