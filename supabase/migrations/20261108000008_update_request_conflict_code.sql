-- 2d fix: a stale-version conflict must not use 40001 (serialization_failure), which the API layer retries.
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
