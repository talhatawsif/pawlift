-- 2a: organisation registration, admin verification, resubmission.
-- All state changes go through security-definer RPCs that audit in the same transaction.

-- Append-only guard for verification_records.
create or replace function public.block_verification_record_changes()
returns trigger
language plpgsql
as $$
begin
  -- Updates are never allowed. Deletes are allowed only for the service role (test cleanup in scripts/tests).
  if tg_op = 'DELETE' and coalesce(auth.role(), '') = 'service_role' then
    return old;
  end if;
  raise exception 'verification_records is append-only' using errcode = '42501';
end;
$$;

create trigger verification_records_append_only
  before update or delete on public.verification_records
  for each row execute function public.block_verification_record_changes();

-- Shared check: caller is signed in and active. Returns the caller id.
create or replace function public.require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  st text;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  select account_status into st from public.profiles where id = uid;
  if st is distinct from 'active' then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  return uid;
end;
$$;
revoke all on function public.require_active_user() from public, anon, authenticated;

create or replace function public.register_organisation(
  p_name text,
  p_type text,
  p_registration_details text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_operating_area text,
  p_website text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  oid uuid;
  name_ text := btrim(coalesce(p_name, ''));
begin
  if char_length(name_) < 2 or char_length(name_) > 120 then
    raise exception 'Organisation name must be 2 to 120 characters' using errcode = '22023';
  end if;
  if p_type not in ('rescue_group','charity','council_pound','shelter','vet_clinic','other') then
    raise exception 'Invalid organisation type' using errcode = '22023';
  end if;
  if char_length(coalesce(p_registration_details, '')) > 1000
     or char_length(coalesce(p_description, '')) > 2000
     or char_length(coalesce(p_operating_area, '')) > 200
     or char_length(coalesce(p_website, '')) > 300
     or char_length(coalesce(p_contact_name, '')) > 120
     or char_length(coalesce(p_contact_email, '')) > 200
     or char_length(coalesce(p_contact_phone, '')) > 40 then
    raise exception 'A field is too long' using errcode = '22023';
  end if;
  if (
    select count(*) from public.organisation_members m
    join public.organisations o on o.id = m.org_id
    where m.user_id = uid and m.is_coordinator and m.status = 'active'
      and o.verification_status = 'pending'
  ) >= 3 then
    raise exception 'Too many organisations awaiting verification' using errcode = '54000';
  end if;

  insert into public.organisations (
    name, type, registration_details, contact_name, contact_email, contact_phone,
    operating_area, website, description
  ) values (
    name_, p_type, nullif(btrim(p_registration_details), ''), nullif(btrim(p_contact_name), ''),
    nullif(btrim(p_contact_email), ''), nullif(btrim(p_contact_phone), ''),
    nullif(btrim(p_operating_area), ''), nullif(btrim(p_website), ''), nullif(btrim(p_description), '')
  ) returning id into oid;

  -- Bootstrap: the registrant is the first coordinator of their own pending organisation.
  insert into public.organisation_members (org_id, user_id, is_coordinator, status, approved_by, approved_at)
  values (oid, uid, true, 'active', uid, now());

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after, reason)
  values (uid, 'organisation.register', 'organisation', oid, oid,
    jsonb_build_object('name', name_, 'type', p_type, 'verification_status', 'pending'),
    'Registrant became first coordinator (bootstrap)');

  return oid;
end;
$$;

create or replace function public.resubmit_organisation(
  p_org_id uuid,
  p_name text,
  p_type text,
  p_registration_details text,
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
  org public.organisations;
  name_ text := btrim(coalesce(p_name, ''));
begin
  select * into org from public.organisations where id = p_org_id for update;
  if not found or not exists (
    select 1 from public.organisation_members m
    where m.org_id = p_org_id and m.user_id = uid and m.is_coordinator and m.status = 'active'
  ) then
    raise exception 'Organisation not found' using errcode = '42501';
  end if;
  if org.verification_status <> 'rejected' then
    raise exception 'Only a rejected organisation can be resubmitted' using errcode = '55000';
  end if;
  if char_length(name_) < 2 or char_length(name_) > 120 then
    raise exception 'Organisation name must be 2 to 120 characters' using errcode = '22023';
  end if;
  if p_type not in ('rescue_group','charity','council_pound','shelter','vet_clinic','other') then
    raise exception 'Invalid organisation type' using errcode = '22023';
  end if;
  if char_length(coalesce(p_registration_details, '')) > 1000
     or char_length(coalesce(p_description, '')) > 2000
     or char_length(coalesce(p_operating_area, '')) > 200
     or char_length(coalesce(p_website, '')) > 300
     or char_length(coalesce(p_contact_name, '')) > 120
     or char_length(coalesce(p_contact_email, '')) > 200
     or char_length(coalesce(p_contact_phone, '')) > 40 then
    raise exception 'A field is too long' using errcode = '22023';
  end if;

  update public.organisations set
    name = name_, type = p_type,
    registration_details = nullif(btrim(p_registration_details), ''),
    contact_name = nullif(btrim(p_contact_name), ''),
    contact_email = nullif(btrim(p_contact_email), ''),
    contact_phone = nullif(btrim(p_contact_phone), ''),
    operating_area = nullif(btrim(p_operating_area), ''),
    website = nullif(btrim(p_website), ''),
    description = nullif(btrim(p_description), ''),
    verification_status = 'pending'
  where id = p_org_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, before, after)
  values (uid, 'organisation.resubmit', 'organisation', p_org_id, p_org_id,
    jsonb_build_object('name', org.name, 'type', org.type, 'verification_status', org.verification_status),
    jsonb_build_object('name', name_, 'type', p_type, 'verification_status', 'pending'));
end;
$$;

create or replace function public.admin_decide_organisation(
  p_org_id uuid,
  p_decision text,
  p_checks jsonb,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  org public.organisations;
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
  checks_ jsonb := coalesce(p_checks, '[]'::jsonb);
begin
  if not exists (select 1 from public.platform_admins where user_id = uid) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_decision not in ('verified','rejected','suspended') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if jsonb_typeof(checks_) <> 'array' or jsonb_array_length(checks_) > 20 then
    raise exception 'Checks must be a list of up to 20 items' using errcode = '22023';
  end if;
  if char_length(coalesce(reason_, '')) > 2000 or char_length(checks_::text) > 4000 then
    raise exception 'Reason or checks too long' using errcode = '22023';
  end if;

  select * into org from public.organisations where id = p_org_id for update;
  if not found then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  if not (
    (org.verification_status = 'pending' and p_decision in ('verified','rejected'))
    or (org.verification_status = 'verified' and p_decision = 'suspended')
    or (org.verification_status = 'suspended' and p_decision = 'verified')
  ) then
    raise exception 'That decision is not allowed from status %', org.verification_status using errcode = '55000';
  end if;
  if p_decision = 'verified' and jsonb_array_length(checks_) = 0 then
    raise exception 'Record the checks performed before verifying' using errcode = '22023';
  end if;
  if p_decision in ('rejected','suspended') and reason_ is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  insert into public.verification_records (subject_type, subject_id, decision, checks_performed, reason, decided_by)
  values ('organisation', p_org_id, p_decision, checks_, reason_, uid);

  update public.organisations set verification_status = p_decision where id = p_org_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, before, after, reason)
  values (uid, 'organisation.' || p_decision, 'organisation', p_org_id, p_org_id,
    jsonb_build_object('verification_status', org.verification_status),
    jsonb_build_object('verification_status', p_decision), reason_);
end;
$$;

create or replace function public.get_org_for_coordinator(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  is_admin boolean;
  result jsonb;
begin
  if uid is null then
    return null;
  end if;
  is_admin := exists (select 1 from public.platform_admins where user_id = uid);
  if not is_admin and not exists (
    select 1 from public.organisation_members m
    where m.org_id = p_org_id and m.user_id = uid and m.is_coordinator and m.status = 'active'
  ) then
    return null;
  end if;

  select to_jsonb(o) - 'is_demo' || jsonb_build_object(
    'is_demo', o.is_demo,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'decision', v.decision, 'checks', v.checks_performed,
        'reason', v.reason, 'decided_at', v.decided_at
      ) order by v.decided_at desc)
      from public.verification_records v
      where v.subject_type = 'organisation' and v.subject_id = o.id
    ), '[]'::jsonb)
  )
  into result
  from public.organisations o
  where o.id = p_org_id;

  return result;
end;
$$;

create or replace function public.admin_list_organisations(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from public.platform_admins where user_id = uid) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'type', o.type, 'operating_area', o.operating_area,
      'verification_status', o.verification_status, 'created_at', o.created_at,
      'updated_at', o.updated_at, 'is_demo', o.is_demo
    ) order by o.updated_at asc)
    from public.organisations o
    where p_status = 'all' or o.verification_status = p_status
  ), '[]'::jsonb);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'register_organisation(text,text,text,text,text,text,text,text,text)',
    'resubmit_organisation(uuid,text,text,text,text,text,text,text,text,text)',
    'admin_decide_organisation(uuid,text,jsonb,text)',
    'get_org_for_coordinator(uuid)',
    'admin_list_organisations(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
