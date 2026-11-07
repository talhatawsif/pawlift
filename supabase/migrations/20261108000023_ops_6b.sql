-- 6b: foster receiving workflow reads, transport history, organisation settings, admin oversight
-- and the logged private-access reader (D39, D40). Every function is security definer with explicit checks.

-- ---------------------------------------------------------------- private access log
create table public.private_access_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  org_id uuid references public.organisations (id) on delete set null,
  request_id uuid references public.transport_requests (id) on delete set null,
  subject text not null,
  reason text not null check (char_length(reason) between 10 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index private_access_log_created_idx on public.private_access_log (created_at desc);
create index private_access_log_actor_idx on public.private_access_log (actor_id);
alter table public.private_access_log enable row level security;
create trigger set_updated_at before update on public.private_access_log
  for each row execute function public.set_updated_at();
revoke all on public.private_access_log from anon, authenticated;

-- Internal: caller is an active signed-in platform admin. Returns the caller id.
create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
begin
  if not exists (select 1 from public.platform_admins where user_id = uid) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return uid;
end;
$$;
revoke all on function public.require_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------- foster receiving
-- Deliveries heading to the caller's own foster home. No exact origin address. The driver's first name and phone
-- are returned only while the assignment is confirmed and the animal is not yet delivered (D40).
create or replace function public.list_my_incoming_deliveries()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
begin
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.window_start) from (
      select r.id as request_id, r.reference, r.animal_name, r.species, r.photo_path, r.urgency,
        r.status as request_status, r.is_demo, o.name as org_name, so.name as origin_suburb,
        l.window_start, l.window_end, l.delivered_at,
        (hc.id is not null) as receipt_confirmed,
        (m.foster_can_confirm_receipt) as can_confirm_receipt,
        case when a.id is not null and l.status in ('confirmed','en_route','collected')
          then nullif(split_part(btrim(coalesce(dp.display_name, '')), ' ', 1), '') end as driver_first_name,
        case when a.id is not null and l.status in ('confirmed','en_route','collected')
          then dp.phone end as driver_phone
      from public.transport_requests r
      join public.transport_legs l on l.request_id = r.id
      join public.locations d on d.id = r.destination_location_id
        and d.kind = 'foster_home' and d.linked_user_id = uid
      join public.organisation_members m on m.org_id = r.org_id and m.user_id = uid
        and m.status = 'active' and m.is_foster_carer and m.foster_approved_at is not null
      join public.organisations o on o.id = r.org_id
      join public.locations lo on lo.id = l.from_location_id
      join public.suburbs so on so.id = lo.suburb_id
      left join public.transport_assignments a on a.leg_id = l.id and a.status = 'confirmed'
      left join public.profiles dp on dp.id = a.volunteer_id
      left join public.handover_confirmations hc on hc.leg_id = l.id and hc.role = 'receiver'
      where r.status in ('confirmed','en_route','collected','delivered')
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_my_foster_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
begin
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.completed_at desc) from (
      select r.id as request_id, r.reference, r.animal_name, r.species, r.is_demo, o.name as org_name,
        so.name as origin_suburb, r.completed_at,
        hc.confirmed_at as received_at, (hc.on_behalf_of is not null) as received_by_coordinator
      from public.transport_requests r
      join public.transport_legs l on l.request_id = r.id
      join public.locations d on d.id = r.destination_location_id
        and d.kind = 'foster_home' and d.linked_user_id = uid
      join public.organisation_members m on m.org_id = r.org_id and m.user_id = uid
        and m.status = 'active' and m.is_foster_carer
      join public.organisations o on o.id = r.org_id
      join public.locations lo on lo.id = l.from_location_id
      join public.suburbs so on so.id = lo.suburb_id
      left join public.handover_confirmations hc on hc.leg_id = l.id and hc.role = 'receiver'
      where r.status = 'completed'
      order by r.completed_at desc
      limit 50
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- transport history (coordinator)
create or replace function public.list_transport_history(p_org_id uuid, p_limit integer default 50, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
begin
  if not public.is_active_coordinator(uid, p_org_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.ended_at desc) from (
      select r.id as request_id, r.reference, r.animal_name, r.species, r.status, r.is_demo,
        so.name as origin_suburb, sd.name as destination_suburb,
        coalesce(r.completed_at, r.cancelled_at) as ended_at, r.cancel_reason,
        (select p.display_name from public.transport_legs l
           join public.transport_assignments a on a.leg_id = l.id and a.status in ('confirmed','completed')
           join public.profiles p on p.id = a.volunteer_id
          where l.request_id = r.id order by a.created_at desc limit 1) as driver_name
      from public.transport_requests r
      left join public.locations lo on lo.id = r.origin_location_id
      left join public.suburbs so on so.id = lo.suburb_id
      left join public.locations ld on ld.id = r.destination_location_id
      left join public.suburbs sd on sd.id = ld.suburb_id
      where r.org_id = p_org_id and r.status in ('completed','cancelled')
        and (p_before is null or coalesce(r.completed_at, r.cancelled_at) < p_before)
      order by coalesce(r.completed_at, r.cancelled_at) desc nulls last
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- organisation settings
create or replace function public.update_org_settings(
  p_org_id uuid,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_operating_area text,
  p_website text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  o public.organisations;
  cn text := nullif(btrim(coalesce(p_contact_name, '')), '');
  ce text := nullif(btrim(coalesce(p_contact_email, '')), '');
  cp text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  oa text := nullif(btrim(coalesce(p_operating_area, '')), '');
  ws text := nullif(btrim(coalesce(p_website, '')), '');
  ds text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if not public.is_active_coordinator(uid, p_org_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if char_length(coalesce(cn, '')) > 120 or char_length(coalesce(ce, '')) > 200 or char_length(coalesce(cp, '')) > 40
     or char_length(coalesce(oa, '')) > 200 or char_length(coalesce(ws, '')) > 200 or char_length(coalesce(ds, '')) > 1000 then
    raise exception 'A field is too long' using errcode = '22023';
  end if;
  if ce is not null and ce !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if ws is not null and ws !~* '^https?://[^\s]+$' then
    raise exception 'The website must start with http:// or https://' using errcode = '22023';
  end if;
  select * into o from public.organisations where id = p_org_id for update;
  if not found then raise exception 'Not permitted' using errcode = '42501'; end if;
  if o.verification_status not in ('pending', 'verified') then
    raise exception 'This organisation cannot change its settings' using errcode = '55000';
  end if;
  update public.organisations
     set contact_name = cn, contact_email = ce, contact_phone = cp,
         operating_area = oa, website = ws, description = ds
   where id = p_org_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, before, after)
  values (uid, 'organisation.settings', 'organisation', p_org_id, p_org_id,
    jsonb_build_object('operating_area', o.operating_area, 'website', o.website, 'description', o.description),
    jsonb_build_object('operating_area', oa, 'website', ws, 'description', ds));
end;
$$;

-- ---------------------------------------------------------------- admin oversight
create or replace function public.admin_list_incidents(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_admin();
begin
  if p_status not in ('open', 'acknowledged', 'resolved', 'all') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select i.id, i.request_id, r.reference, r.animal_name, r.is_demo, o.id as org_id, o.name as org_name,
        i.type, i.severity, i.status, i.description, i.resolution, i.created_at, i.resolved_at,
        rp.display_name as raised_by_name
      from public.incidents i
      join public.transport_requests r on r.id = i.request_id
      join public.organisations o on o.id = r.org_id
      left join public.profiles rp on rp.id = i.raised_by
      where p_status = 'all' or i.status = p_status
      order by i.created_at desc
      limit 100
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_list_audit(p_org_id uuid default null, p_limit integer default 100, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_admin();
begin
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select g.id, g.action, g.entity_type, g.entity_id, g.org_id, o.name as org_name,
        g.reason, g.created_at, p.display_name as actor_name
      from public.audit_logs g
      left join public.organisations o on o.id = g.org_id
      left join public.profiles p on p.id = g.actor_id
      where (p_org_id is null or g.org_id = p_org_id)
        and (p_before is null or g.created_at < p_before)
      order by g.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 200)
    ) t
  ), '[]'::jsonb);
end;
$$;

-- Reads exact addresses, contacts and medical notes for one request. Needs a written reason; logged twice
-- (private_access_log for admins, audit_logs so the owning organisation sees it on its own audit page).
create or replace function public.admin_view_private_details(p_request_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_admin();
  why text := btrim(coalesce(p_reason, ''));
  r public.transport_requests;
  result jsonb;
begin
  if char_length(why) < 10 or char_length(why) > 500 then
    raise exception 'Give a reason of 10 to 500 characters' using errcode = '22023';
  end if;
  select * into r from public.transport_requests where id = p_request_id;
  if not found then raise exception 'Request not found' using errcode = '42501'; end if;

  insert into public.private_access_log (actor_id, org_id, request_id, subject, reason)
  values (uid, r.org_id, r.id, 'request_private_details', why);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, reason, after)
  values (uid, 'admin.private_access', 'request', r.id, r.org_id, why, jsonb_build_object('request_id', r.id));

  select jsonb_build_object(
    'request_id', r.id, 'reference', r.reference, 'animal_name', r.animal_name, 'org_name', o.name,
    'medical_notes', rp.medical_notes, 'coordinator_instructions', rp.coordinator_instructions,
    'origin', jsonb_build_object('label', lo.label_public, 'exact_address', po.exact_address,
      'contact_name', po.contact_name, 'contact_phone', po.contact_phone, 'instructions', po.instructions),
    'destination', jsonb_build_object('label', ld.label_public, 'exact_address', pd.exact_address,
      'contact_name', pd.contact_name, 'contact_phone', pd.contact_phone, 'instructions', pd.instructions)
  ) into result
  from public.organisations o
  left join public.request_private rp on rp.request_id = r.id
  left join public.locations lo on lo.id = r.origin_location_id
  left join public.location_private po on po.location_id = lo.id
  left join public.locations ld on ld.id = r.destination_location_id
  left join public.location_private pd on pd.location_id = ld.id
  where o.id = r.org_id;
  return result;
end;
$$;

create or replace function public.admin_list_private_access(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_admin();
begin
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select l.id, l.subject, l.reason, l.created_at, p.display_name as actor_name,
        o.name as org_name, r.reference, r.animal_name
      from public.private_access_log l
      left join public.profiles p on p.id = l.actor_id
      left join public.organisations o on o.id = l.org_id
      left join public.transport_requests r on r.id = l.request_id
      order by l.created_at desc
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
    'list_my_incoming_deliveries()', 'list_my_foster_history()',
    'list_transport_history(uuid, integer, timestamptz)',
    'update_org_settings(uuid, text, text, text, text, text, text)',
    'admin_list_incidents(text)', 'admin_list_audit(uuid, integer, timestamptz)',
    'admin_view_private_details(uuid, text)', 'admin_list_private_access(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
