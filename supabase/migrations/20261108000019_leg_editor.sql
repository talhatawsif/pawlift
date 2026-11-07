-- 5a: leg editor. Split/merge/re-time legs with PLAN §7 chain validation; publish and update_request become multi-leg aware.

-- ---------------------------------------------------------------- chain validation (internal)
create or replace function public.validate_leg_chain(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.transport_requests;
  n integer;
  i integer := 0;
  cur public.transport_legs;
  prev public.transport_legs;
begin
  select * into r from public.transport_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  select count(*) into n from public.transport_legs where request_id = r.id and status <> 'cancelled';
  if n < 1 then
    raise exception 'A request needs at least one leg' using errcode = '55000';
  end if;
  if n > 5 then
    raise exception 'A relay can have at most 5 legs' using errcode = '22023';
  end if;
  for cur in
    select * from public.transport_legs where request_id = r.id and status <> 'cancelled' order by seq
  loop
    i := i + 1;
    if cur.seq <> i then
      raise exception 'Legs must be numbered 1, 2, 3 in order' using errcode = '55000';
    end if;
    if cur.from_location_id = cur.to_location_id then
      raise exception 'Leg % must start and end at different places', i using errcode = '22023';
    end if;
    if cur.window_end <= cur.window_start then
      raise exception 'Leg %: the window must end after it starts', i using errcode = '22023';
    end if;
    if (select count(*) from public.locations
        where id in (cur.from_location_id, cur.to_location_id) and org_id = r.org_id)
       <> 2 then
      raise exception 'Leg %: locations must belong to your organisation', i using errcode = '22023';
    end if;
    if i = 1 then
      if cur.from_location_id <> r.origin_location_id then
        raise exception 'The first leg must start at the pickup location' using errcode = '22023';
      end if;
    else
      if prev.to_location_id <> cur.from_location_id then
        raise exception 'Leg % must start where leg % ends', i, i - 1 using errcode = '22023';
      end if;
      if prev.window_start > cur.window_start or prev.window_end > cur.window_end then
        raise exception 'Leg % cannot start or end before leg %', i, i - 1 using errcode = '22023';
      end if;
      if not exists (select 1 from public.locations where id = cur.from_location_id and kind = 'handover_point') then
        raise exception 'Legs hand over at a handover point' using errcode = '22023';
      end if;
    end if;
    prev := cur;
  end loop;
  if prev.to_location_id <> r.destination_location_id then
    raise exception 'The last leg must end at the destination' using errcode = '22023';
  end if;
  if r.deadline is not null and prev.window_end > r.deadline then
    raise exception 'The last leg cannot end after the delivery deadline' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.validate_leg_chain(uuid) from public, anon, authenticated;

-- Shared guard: locks the request and returns it; coordinator only, editable, every leg open.
create or replace function public.leg_edit_guard(p_request_id uuid, p_expected_version integer)
returns public.transport_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
begin
  select * into r from public.transport_requests where id = p_request_id for update;
  if not found or not public.is_active_coordinator(uid, r.org_id) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if r.status not in ('draft','open') then
    raise exception 'This request can no longer be edited' using errcode = '55000';
  end if;
  if exists (select 1 from public.transport_legs where request_id = r.id and status <> 'open') then
    raise exception 'A volunteer is already involved; leg edits are not available' using errcode = '55000';
  end if;
  if r.version <> p_expected_version then
    raise exception 'This request was changed elsewhere; reload and try again' using errcode = '55006';
  end if;
  return r;
end;
$$;
revoke all on function public.leg_edit_guard(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- split_leg
create or replace function public.split_leg(
  p_request_id uuid,
  p_expected_version integer,
  p_seq integer,
  p_handover_location_id uuid,
  p_first_end timestamptz,
  p_second_start timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  g public.transport_legs;
  newv integer;
begin
  r := public.leg_edit_guard(p_request_id, p_expected_version);
  select * into g from public.transport_legs where request_id = r.id and seq = p_seq;
  if not found then
    raise exception 'Leg not found' using errcode = '22023';
  end if;
  if (select count(*) from public.transport_legs where request_id = r.id) >= 5 then
    raise exception 'A relay can have at most 5 legs' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations
    where id = p_handover_location_id and org_id = r.org_id and kind = 'handover_point'
  ) then
    raise exception 'Choose one of your organisation''s handover points' using errcode = '22023';
  end if;
  if p_handover_location_id in (g.from_location_id, g.to_location_id) then
    raise exception 'The handover point must differ from the leg''s ends' using errcode = '22023';
  end if;
  if p_first_end is null or p_second_start is null
     or p_first_end <= g.window_start or p_second_start >= g.window_end then
    raise exception 'Handover times must fall inside the leg''s window' using errcode = '22023';
  end if;

  -- shift later legs up by one (two passes avoid transient unique collisions)
  update public.transport_legs set seq = seq + 1000 where request_id = r.id and seq > p_seq;
  update public.transport_legs set seq = seq - 999, version = version + 1, updated_at = now()
    where request_id = r.id and seq > 1000;
  update public.transport_legs set
    to_location_id = p_handover_location_id, window_end = p_first_end,
    version = version + 1, updated_at = now()
  where id = g.id;
  insert into public.transport_legs (request_id, seq, from_location_id, to_location_id, window_start, window_end)
  values (r.id, p_seq + 1, p_handover_location_id, g.to_location_id, p_second_start, g.window_end);

  perform public.validate_leg_chain(r.id);
  update public.transport_requests set version = version + 1, updated_at = now()
    where id = r.id returning version into newv;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'leg.split', 'request', r.id, r.org_id,
    jsonb_build_object('seq', p_seq, 'handover_location_id', p_handover_location_id));
  return newv;
end;
$$;

-- ---------------------------------------------------------------- merge_legs
create or replace function public.merge_legs(p_request_id uuid, p_expected_version integer, p_seq integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  a public.transport_legs;
  b public.transport_legs;
  newv integer;
begin
  r := public.leg_edit_guard(p_request_id, p_expected_version);
  select * into a from public.transport_legs where request_id = r.id and seq = p_seq;
  select * into b from public.transport_legs where request_id = r.id and seq = p_seq + 1;
  if a.id is null or b.id is null then
    raise exception 'There is no next leg to merge with' using errcode = '22023';
  end if;
  update public.transport_legs set
    to_location_id = b.to_location_id, window_end = b.window_end,
    version = version + 1, updated_at = now()
  where id = a.id;
  delete from public.transport_legs where id = b.id;
  update public.transport_legs set seq = seq + 1000 where request_id = r.id and seq > p_seq;
  update public.transport_legs set seq = seq - 1001, version = version + 1, updated_at = now()
    where request_id = r.id and seq > 1000;

  perform public.validate_leg_chain(r.id);
  update public.transport_requests set version = version + 1, updated_at = now()
    where id = r.id returning version into newv;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'leg.merge', 'request', r.id, r.org_id, jsonb_build_object('seq', p_seq));
  return newv;
end;
$$;

-- ---------------------------------------------------------------- update_leg
-- Re-time a leg and/or move the handover point at its end (also moves the next leg's start).
create or replace function public.update_leg(
  p_request_id uuid,
  p_expected_version integer,
  p_seq integer,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_to_location_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.transport_requests;
  g public.transport_legs;
  has_next boolean;
  newv integer;
begin
  r := public.leg_edit_guard(p_request_id, p_expected_version);
  select * into g from public.transport_legs where request_id = r.id and seq = p_seq;
  if not found then
    raise exception 'Leg not found' using errcode = '22023';
  end if;
  if p_window_start is null or p_window_end is null or p_window_end <= p_window_start then
    raise exception 'The window must end after it starts' using errcode = '22023';
  end if;
  if r.status = 'open' and p_window_end <= now() then
    raise exception 'The pickup window must be in the future' using errcode = '22023';
  end if;
  select exists (select 1 from public.transport_legs where request_id = r.id and seq = p_seq + 1) into has_next;
  if p_to_location_id is not null and p_to_location_id <> g.to_location_id then
    if not has_next then
      raise exception 'The last leg always ends at the destination' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.locations
      where id = p_to_location_id and org_id = r.org_id and kind = 'handover_point'
    ) then
      raise exception 'Choose one of your organisation''s handover points' using errcode = '22023';
    end if;
    update public.transport_legs set from_location_id = p_to_location_id, version = version + 1, updated_at = now()
      where request_id = r.id and seq = p_seq + 1;
  end if;
  update public.transport_legs set
    window_start = p_window_start, window_end = p_window_end,
    to_location_id = coalesce(p_to_location_id, to_location_id),
    version = version + 1, updated_at = now()
  where id = g.id;

  perform public.validate_leg_chain(r.id);
  update public.transport_requests set version = version + 1, updated_at = now()
    where id = r.id returning version into newv;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'leg.update', 'request', r.id, r.org_id, jsonb_build_object('seq', p_seq));
  return newv;
end;
$$;

-- ---------------------------------------------------------------- list_request_legs
create or replace function public.list_request_legs(p_request_id uuid)
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'seq', g.seq, 'status', g.status,
      'from_id', g.from_location_id, 'from_label', lf.label_public, 'from_suburb', sf.name, 'from_kind', lf.kind,
      'to_id', g.to_location_id, 'to_label', lt.label_public, 'to_suburb', st.name, 'to_kind', lt.kind,
      'window_start', g.window_start, 'window_end', g.window_end
    ) order by g.seq)
    from public.transport_legs g
    join public.locations lf on lf.id = g.from_location_id
    join public.suburbs sf on sf.id = lf.suburb_id
    join public.locations lt on lt.id = g.to_location_id
    join public.suburbs st on st.id = lt.suburb_id
    where g.request_id = r.id and g.status <> 'cancelled'
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- publish_request: multi-leg chain
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
      and l.is_confirmed_destination and l.kind <> 'handover_point'
  ) then
    raise exception 'The destination must be a confirmed destination' using errcode = '55000';
  end if;
  if r.origin_location_id is null or r.origin_location_id = r.destination_location_id then
    raise exception 'Pickup and destination are required' using errcode = '55000';
  end if;
  if coalesce(btrim(r.handling_requirements), '') = '' and coalesce(btrim(r.carrier_requirements), '') = '' then
    raise exception 'Add handling or carrier requirements before publishing' using errcode = '55000';
  end if;
  perform public.validate_leg_chain(r.id);
  if exists (select 1 from public.transport_legs where request_id = r.id and status <> 'cancelled' and window_end <= now()) then
    raise exception 'The pickup window must be in the future' using errcode = '22023';
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

-- ---------------------------------------------------------------- update_request: multi-leg aware
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
  nlegs integer;
  first_leg public.transport_legs;
  last_leg public.transport_legs;
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

  select count(*) into nlegs from public.transport_legs where request_id = r.id;
  if nlegs > 1 then
    -- Relay: places and times belong to the leg editor.
    select * into first_leg from public.transport_legs where request_id = r.id order by seq limit 1;
    select * into last_leg from public.transport_legs where request_id = r.id order by seq desc limit 1;
    if p_origin_location_id is distinct from r.origin_location_id
       or p_destination_location_id is distinct from r.destination_location_id
       or p_window_start is distinct from first_leg.window_start
       or p_window_end is distinct from first_leg.window_end then
      raise exception 'This request has several legs; edit pickup, destination and times in the leg editor' using errcode = '55000';
    end if;
    if p_deadline is not null and p_deadline < last_leg.window_end then
      raise exception 'Delivery deadline cannot be before the end of the last leg' using errcode = '22023';
    end if;
  else
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
  end if;
  if r.status = 'open' and not exists (
    select 1 from public.locations where id = p_destination_location_id and is_confirmed_destination
  ) then
    raise exception 'A published request needs a confirmed destination' using errcode = '55000';
  end if;
  if r.status = 'open' and nlegs = 1 and p_window_end <= now() then
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
  if nlegs = 1 then
    update public.transport_legs set
      from_location_id = p_origin_location_id, to_location_id = p_destination_location_id,
      window_start = p_window_start, window_end = p_window_end,
      version = version + 1, updated_at = now()
    where request_id = r.id and seq = 1;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'request.update', 'request', r.id, r.org_id,
    jsonb_build_object('status', r.status, 'version', newv));
  return newv;
end;
$$;

-- ---------------------------------------------------------------- get_request_for_coordinator: add leg_count
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
      'window_start', g.window_start, 'window_end', g.window_end, 'leg_status', g.status,
      'leg_count', (select count(*) from public.transport_legs x where x.request_id = r.id and x.status <> 'cancelled')
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

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array[
    'split_leg(uuid,integer,integer,uuid,timestamptz,timestamptz)',
    'merge_legs(uuid,integer,integer)',
    'update_leg(uuid,integer,integer,timestamptz,timestamptz,uuid)',
    'list_request_legs(uuid)',
    'publish_request(uuid,boolean)',
    'update_request(uuid,integer,text,text,text,date,timestamptz,text,text,text,text,uuid,uuid,timestamptz,timestamptz)',
    'get_request_for_coordinator(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
