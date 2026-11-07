-- 2d: transport requests (single auto-created leg), publish guards, photo storage, demo isolation in the public view.
-- All writes go through security definer RPCs that check auth.uid(), role and state, and write audit_logs.

-- ---------------------------------------------------------------- helpers

create or replace function public.req_check_text(
  p_name text, p_handling text, p_carrier text, p_medical text, p_instr text
)
returns void
language plpgsql
immutable
as $$
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Animal name must be 1 to 80 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(p_handling, '')) > 1000 or char_length(coalesce(p_carrier, '')) > 1000
     or char_length(coalesce(p_medical, '')) > 2000 or char_length(coalesce(p_instr, '')) > 1000 then
    raise exception 'Text too long' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.req_check_text(text,text,text,text,text) from public, anon, authenticated;

-- Org folder of a storage object name ("<org uuid>/<file>"); null when malformed.
create or replace function public.photo_org(p_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid else null end;
$$;

-- May the caller put this object in the public bucket? Only coordinators, only for the photo of an open request.
create or replace function public.can_publish_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.is_active_coordinator(auth.uid(), public.photo_org(p_name))
    and exists (
      select 1 from public.transport_requests r
      where r.org_id = public.photo_org(p_name) and r.photo_path = p_name
        and r.status = 'open' and r.published_at is not null
    );
$$;

create or replace function public.can_use_draft_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.photo_org(p_name) is not null
    and public.is_active_coordinator(auth.uid(), public.photo_org(p_name));
$$;
revoke all on function public.can_publish_photo(text) from public, anon;
revoke all on function public.can_use_draft_photo(text) from public, anon;
grant execute on function public.can_publish_photo(text) to authenticated;
grant execute on function public.can_use_draft_photo(text) to authenticated;
revoke all on function public.photo_org(text) from public, anon;
grant execute on function public.photo_org(text) to authenticated;

-- ---------------------------------------------------------------- requests

create or replace function public.create_request(
  p_org_id uuid,
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
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  org public.organisations;
  rid uuid;
  ref text;
begin
  select * into org from public.organisations where id = p_org_id;
  if not found or not public.is_active_coordinator(uid, p_org_id) then
    raise exception 'Organisation not found' using errcode = '42501';
  end if;
  if org.verification_status = 'suspended' then
    raise exception 'Organisation is suspended' using errcode = '55000';
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
  if (select count(*) from public.locations where id in (p_origin_location_id, p_destination_location_id) and org_id = p_org_id) <> 2 then
    raise exception 'Locations must belong to your organisation' using errcode = '22023';
  end if;
  if (select count(*) from public.transport_requests where org_id = p_org_id and status = 'draft') >= 50 then
    raise exception 'Too many drafts' using errcode = '54000';
  end if;

  ref := 'PL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.transport_requests (
    org_id, reference, animal_name, species, urgency, required_date, deadline,
    handling_requirements, carrier_requirements, origin_location_id, destination_location_id, is_demo
  ) values (
    p_org_id, ref, btrim(p_animal_name), p_species, p_urgency, p_required_date, p_deadline,
    nullif(btrim(coalesce(p_handling, '')), ''), nullif(btrim(coalesce(p_carrier, '')), ''),
    p_origin_location_id, p_destination_location_id, org.is_demo
  ) returning id into rid;
  insert into public.request_private (request_id, medical_notes, coordinator_instructions)
  values (rid, nullif(btrim(coalesce(p_medical_notes, '')), ''), nullif(btrim(coalesce(p_coordinator_instructions, '')), ''));
  insert into public.transport_legs (request_id, seq, from_location_id, to_location_id, window_start, window_end)
  values (rid, 1, p_origin_location_id, p_destination_location_id, p_window_start, p_window_end);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'request.create', 'request', rid, p_org_id,
    jsonb_build_object('reference', ref, 'species', p_species, 'urgency', p_urgency));
  return rid;
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
    raise exception 'This request was changed elsewhere; reload and try again' using errcode = '40001';
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

create or replace function public.set_request_photo(p_request_id uuid, p_path text)
returns void
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
  if p_path is not null and p_path !~ ('^' || r.org_id::text || '/[0-9a-f-]{36}\.webp$') then
    raise exception 'Invalid photo path' using errcode = '22023';
  end if;
  update public.transport_requests set photo_path = p_path, version = version + 1, updated_at = now() where id = r.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, case when p_path is null then 'request.photo_clear' else 'request.photo_set' end,
    'request', r.id, r.org_id, '{}'::jsonb);
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

create or replace function public.cancel_request(p_request_id uuid, p_reason text)
returns void
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
    raise exception 'This request cannot be cancelled here' using errcode = '55000';
  end if;
  if exists (select 1 from public.transport_legs where request_id = r.id and status <> 'open') then
    raise exception 'A volunteer is already involved; cancellation is not available yet' using errcode = '55000';
  end if;
  if r.status = 'open' and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for cancelling a published request' using errcode = '22023';
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then
    raise exception 'Reason too long' using errcode = '22023';
  end if;
  update public.transport_requests set
    status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    version = version + 1, updated_at = now()
  where id = r.id;
  update public.transport_legs set status = 'cancelled', cancelled_at = now(), version = version + 1, updated_at = now()
  where request_id = r.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason)
  values (uid, 'request.cancel', 'request', r.id, r.org_id, nullif(btrim(coalesce(p_reason, '')), ''));
end;
$$;

-- Coordinator reads (drafts and private notes). Exact addresses are not included.
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

create or replace function public.list_org_requests(p_org_id uuid)
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
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'reference', r.reference, 'animal_name', r.animal_name, 'species', r.species,
      'urgency', r.urgency, 'status', r.status, 'published_at', r.published_at, 'photo_path', r.photo_path,
      'origin_suburb', so.name, 'destination_suburb', sd.name,
      'window_start', g.window_start, 'window_end', g.window_end, 'created_at', r.created_at
    ) order by r.created_at desc)
    from public.transport_requests r
    join public.transport_legs g on g.request_id = r.id and g.seq = 1
    join public.locations lo on lo.id = r.origin_location_id
    join public.suburbs so on so.id = lo.suburb_id
    join public.locations ld on ld.id = r.destination_location_id
    join public.suburbs sd on sd.id = ld.suburb_id
    where r.org_id = p_org_id
  ), '[]'::jsonb);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_request(uuid,text,text,text,date,timestamptz,text,text,text,text,uuid,uuid,timestamptz,timestamptz)',
    'update_request(uuid,integer,text,text,text,date,timestamptz,text,text,text,text,uuid,uuid,timestamptz,timestamptz)',
    'set_request_photo(uuid,text)',
    'publish_request(uuid,boolean)',
    'cancel_request(uuid,text)',
    'get_request_for_coordinator(uuid)',
    'list_org_requests(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- public view: demo/real isolation
-- Same columns as before. Callers only see rows whose is_demo matches their own profile (anon = real).
create or replace view public.public_requests with (security_invoker = false) as
select
  r.id, r.reference, r.animal_name, r.species, r.photo_path, r.urgency, r.required_date, r.deadline,
  r.handling_requirements, r.carrier_requirements, r.is_demo,
  o.name as org_name,
  o.verification_status as org_verification_status,
  lo.label_public as origin_label,
  so.name as origin_suburb,
  st_y(lo.approx_point::geometry) as origin_lat,
  st_x(lo.approx_point::geometry) as origin_lng,
  ld.label_public as destination_label,
  sd.name as destination_suburb,
  st_y(ld.approx_point::geometry) as destination_lat,
  st_x(ld.approx_point::geometry) as destination_lng,
  (select min(l.window_start) from public.transport_legs l where l.request_id = r.id) as window_start,
  (select max(l.window_end) from public.transport_legs l where l.request_id = r.id) as window_end
from public.transport_requests r
join public.organisations o on o.id = r.org_id
join public.locations lo on lo.id = r.origin_location_id
join public.suburbs so on so.id = lo.suburb_id
join public.locations ld on ld.id = r.destination_location_id
join public.suburbs sd on sd.id = ld.suburb_id
where r.status = 'open' and r.published_at is not null
  and r.is_demo = coalesce((select p.is_demo from public.profiles p where p.id = auth.uid()), false);

-- ---------------------------------------------------------------- storage
-- request-photos: private, sanitised drafts. animal-photos: public, filled only after publish.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('request-photos', 'request-photos', false, 1048576, array['image/webp']),
  ('animal-photos', 'animal-photos', true, 1048576, array['image/webp'])
on conflict (id) do nothing;

create policy request_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and public.can_use_draft_photo(name));
create policy request_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'request-photos' and public.can_use_draft_photo(name));
create policy request_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'request-photos' and public.can_use_draft_photo(name));
create policy animal_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'animal-photos' and public.can_publish_photo(name));
